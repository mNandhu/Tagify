from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from urllib.parse import quote
import time
import asyncio

import sqlalchemy as sa
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from ..database.db import async_conn, async_tx
from ..database import schema as t
from ._utils import validate_tags
from ..services import image_tags

_TAGS_CACHE: dict[str, tuple[float, list[dict]]] = {}
_TAGS_TTL_SECONDS = 30.0
_CACHE_LOCK = asyncio.Lock()

# Per-tag mosaic samples: small, short-lived cache keyed by (tag, per).
_SAMPLES_CACHE: dict[tuple[str, int], tuple[float, list[dict]]] = {}
_SAMPLES_TTL_SECONDS = 60.0
_SAMPLES_LOCK = asyncio.Lock()

router = APIRouter()


def _thumb_url(image_id: str, thumb_key: str | None = None) -> str:
    """The streaming /thumb route. Lets the grid render <img src> with no extra
    hop. `thumb_key` is accepted for call-site parity but no longer needed."""
    return f"/api/images/{quote(image_id, safe='')}/thumb"


async def _samples_for_tag(tag: str, per: int) -> list[dict]:
    now = time.time()
    cache_key = (tag, per)
    async with _SAMPLES_LOCK:
        cached = _SAMPLES_CACHE.get(cache_key)
        if cached and (now - cached[0]) < _SAMPLES_TTL_SECONDS:
            return cached[1]

    cols = (
        t.images.c._id,
        t.images.c.thumb_key,
        t.images.c.width,
        t.images.c.height,
        t.images.c.blurhash,
    )
    out: list[dict] = []
    seen: set[str] = set()

    async with async_conn() as conn:
        # A pinned thumbnail (tag_meta) leads the mosaic when present.
        pinned = (
            await conn.execute(
                sa.select(t.tag_meta.c.thumb_image_id).where(t.tag_meta.c.tag == tag)
            )
        ).scalar()
        if pinned:
            row = (
                await conn.execute(
                    sa.select(*cols).where(
                        t.images.c._id == pinned,
                        sa.exists(
                            sa.select(1).where(
                                t.image_tags.c.image_id == t.images.c._id,
                                t.image_tags.c.tag == tag,
                            )
                        ),
                    )
                )
            ).first()
            if row is not None:
                seen.add(row._id)
                out.append(dict(row._mapping))

        # ORDER BY RANDOM() gives varied, non-duplicated images across tags — fixes
        # common tags all showing the same most-recent image. Full scan + sort of
        # the matching rows, but the result is cached (TTL) and per-tag match sets
        # are small. Over-fetch to backfill any collision with the pinned image.
        remaining = per - len(out)
        if remaining > 0:
            rows = (
                await conn.execute(
                    sa.select(*cols)
                    .select_from(
                        t.images.join(
                            t.image_tags, t.image_tags.c.image_id == t.images.c._id
                        )
                    )
                    .where(t.image_tags.c.tag == tag)
                    .order_by(sa.func.random())
                    .limit(remaining + (1 if pinned else 0))
                )
            ).fetchall()
            for row in rows:
                if row._id in seen:
                    continue
                seen.add(row._id)
                out.append(dict(row._mapping))
                if len(out) >= per:
                    break

    samples = [
        {
            "_id": d["_id"],
            "thumb_url": _thumb_url(d["_id"]),
            "width": d.get("width"),
            "height": d.get("height"),
            "blurhash": d.get("blurhash"),
        }
        for d in out
    ]
    async with _SAMPLES_LOCK:
        _SAMPLES_CACHE[cache_key] = (now, samples)
    return samples


class TagThumbnailSet(BaseModel):
    image_id: str


@router.get("")
async def list_tags(
    include_manual: bool = False,
    include_prompt: bool = False,
    merge_sources: bool = False,
):
    now = time.time()
    cache_key = f"m{int(include_manual)}:p{int(include_prompt)}:s{int(merge_sources)}"
    async with _CACHE_LOCK:
        cached = _TAGS_CACHE.get(cache_key)
        if cached and (now - cached[0]) < _TAGS_TTL_SECONDS:
            return cached[1]

    # Merge mode (gallery search): collapse the three sources of each tag into
    # one cross-source `any:<base>` entry counting *distinct images*, so a tag
    # the user both prompt- and manual-tagged isn't double-counted. No thumbs —
    # the autocomplete only needs id + count.
    if merge_sources:
        stmt = (
            sa.select(
                t.image_tags.c.base,
                sa.func.count(sa.distinct(t.image_tags.c.image_id)).label("count"),
            )
            .group_by(t.image_tags.c.base)
            .order_by(sa.text("count DESC"))
        )
        async with async_conn() as conn:
            rows = (await conn.execute(stmt)).fetchall()
        merged = [
            {"_id": f"{image_tags.ANY_PREFIX}{r.base}", "count": r.count}
            for r in rows
            if r.base
        ]
        async with _CACHE_LOCK:
            _TAGS_CACHE[cache_key] = (now, merged)
        return merged

    # AI tags are primary (no prefix). Manual tags are `manual:<tag>`, prompt-
    # extracted tags are `prompt:<term>`. By default the browser is AI-only; the
    # Tags view opts into the other kinds.
    stmt = sa.select(
        t.image_tags.c.tag,
        sa.func.count().label("count"),
        # MAX picks the newest image id (ids sort like _id desc) for the default
        # mosaic thumbnail.
        sa.func.max(t.image_tags.c.image_id).label("sample_image_id"),
    )
    for prefix in image_tags.excluded_prefixes(
        include_manual=include_manual, include_prompt=include_prompt
    ):
        stmt = stmt.where(~t.image_tags.c.tag.like(f"{prefix}%"))
    stmt = stmt.group_by(t.image_tags.c.tag).order_by(sa.text("count DESC"))

    async with async_conn() as conn:
        rows = (await conn.execute(stmt)).fetchall()
        tag_ids = [r.tag for r in rows]
        overrides: dict[str, str] = {}
        if tag_ids:
            ov_rows = (
                await conn.execute(
                    sa.select(t.tag_meta.c.tag, t.tag_meta.c.thumb_image_id).where(
                        t.tag_meta.c.tag.in_(tag_ids)
                    )
                )
            ).fetchall()
            overrides = {r.tag: r.thumb_image_id for r in ov_rows if r.thumb_image_id}

    result = [
        {
            "_id": r.tag,
            "count": r.count,
            "thumb_image_id": overrides.get(r.tag) or r.sample_image_id,
        }
        for r in rows
    ]
    async with _CACHE_LOCK:
        _TAGS_CACHE[cache_key] = (now, result)
    return result


@router.get("/samples")
async def tag_samples(
    tags: list[str] = Query(default=[]),
    per: int = Query(default=4, ge=1, le=6),
):
    """Up to `per` distinct, randomly-sampled images per tag for the mosaic
    cards. Bounded (caller passes only the visible tags) and cached."""
    if not tags:
        return {}
    if len(tags) > 200:
        raise HTTPException(status_code=422, detail="too many tags (max 200)")
    tags = validate_tags(tags, max_count=200)
    results = await asyncio.gather(*[_samples_for_tag(tag, per) for tag in tags])
    return {tag: samples for tag, samples in zip(tags, results)}


@router.post("/thumbnail/{tag:path}")
async def set_tag_thumbnail(tag: str, body: TagThumbnailSet):
    tag = validate_tags([tag])[0]
    image_id = body.image_id

    async with async_tx() as conn:
        exists = (
            await conn.execute(
                sa.select(t.images.c._id).where(
                    t.images.c._id == image_id,
                    sa.exists(
                        sa.select(1).where(
                            t.image_tags.c.image_id == t.images.c._id,
                            t.image_tags.c.tag == tag,
                        )
                    ),
                )
            )
        ).scalar()
        if not exists:
            raise HTTPException(
                status_code=404, detail="Image not found for tag thumbnail"
            )
        stmt = sqlite_insert(t.tag_meta).values(
            tag=tag, thumb_image_id=image_id, updated_at=time.time()
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[t.tag_meta.c.tag],
            set_={
                "thumb_image_id": stmt.excluded.thumb_image_id,
                "updated_at": stmt.excluded.updated_at,
            },
        )
        await conn.execute(stmt)

    async with _CACHE_LOCK:
        _TAGS_CACHE.clear()
        _SAMPLES_CACHE.clear()
    return {"tag": tag, "thumb_image_id": image_id}


@router.delete("/thumbnail/{tag:path}")
async def clear_tag_thumbnail(tag: str):
    tag = validate_tags([tag])[0]
    async with async_tx() as conn:
        await conn.execute(sa.delete(t.tag_meta).where(t.tag_meta.c.tag == tag))
    async with _CACHE_LOCK:
        _TAGS_CACHE.clear()
        _SAMPLES_CACHE.clear()
    return {"tag": tag, "cleared": True}


@router.post("/apply/{image_id}")
async def apply_tags(image_id: str, tags: list[str]):
    added = [image_tags.to_manual(tag) for tag in validate_tags(tags)]
    await image_tags.apply_manual(image_id, validate_tags(tags))
    async with _CACHE_LOCK:
        _TAGS_CACHE.clear()
        _SAMPLES_CACHE.clear()
    return {"image_id": image_id, "added": added}


@router.post("/remove/{image_id}")
async def remove_tags(image_id: str, tags: list[str]):
    tags = validate_tags(tags)
    await image_tags.remove_tags(image_id, tags)
    async with _CACHE_LOCK:
        _TAGS_CACHE.clear()
        _SAMPLES_CACHE.clear()
    return {"image_id": image_id, "removed": tags}


@router.post("/ai/{image_id}")
async def ai_tag(image_id: str):
    # Deprecated route retained for convenience.
    # Internal AI tagging is implemented under /ai/*.
    from ..services.ai_jobs import get_ai_job_manager

    jm = get_ai_job_manager()
    job = await jm.enqueue(ids=[image_id])
    return {"job_id": job.id}
