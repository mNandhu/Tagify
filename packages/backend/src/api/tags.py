from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from urllib.parse import quote
from ..database.motor import acol
from ..services.storage_minio import presign_thumb
from ..core.config import settings
import time
import asyncio

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


def _thumb_url(image_id: str, thumb_key: str | None) -> str:
    """Mirror images.list: a presigned MinIO URL when enabled, else the
    streaming /thumb route. Lets the grid render <img src> with no extra hop."""
    presign_mode = settings.media_presigned_mode in ("redirect", "url")
    if thumb_key and presign_mode:
        return presign_thumb(thumb_key)
    return f"/api/images/{quote(image_id, safe='')}/thumb"


async def _samples_for_tag(tag: str, per: int) -> list[dict]:
    now = time.time()
    cache_key = (tag, per)
    async with _SAMPLES_LOCK:
        cached = _SAMPLES_CACHE.get(cache_key)
        if cached and (now - cached[0]) < _SAMPLES_TTL_SECONDS:
            return cached[1]

    proj = {"thumb_key": 1, "width": 1, "height": 1, "blurhash": 1}
    out: list[dict] = []
    seen: set[str] = set()

    # A pinned thumbnail (tag_meta) leads the mosaic when present.
    meta = await acol("tag_meta").find_one({"_id": tag}, {"thumb_image_id": 1})
    pinned = meta.get("thumb_image_id") if meta else None
    if pinned:
        doc = await acol("images").find_one({"_id": pinned, "tags": tag}, proj)
        if doc:
            seen.add(doc["_id"])
            out.append(doc)

    # $sample gives varied, non-duplicated images across tags — fixes common
    # tags all showing the same most-recent image. Over-fetch to backfill any
    # collision with the pinned image.
    remaining = per - len(out)
    if remaining > 0:
        pipeline = [
            {"$match": {"tags": tag}},
            {"$sample": {"size": remaining + (1 if pinned else 0)}},
            {"$project": proj},
        ]
        async for doc in acol("images").aggregate(pipeline):
            if doc["_id"] in seen:
                continue
            seen.add(doc["_id"])
            out.append(doc)
            if len(out) >= per:
                break

    samples = [
        {
            "_id": str(d["_id"]),
            "thumb_url": _thumb_url(str(d["_id"]), d.get("thumb_key")),
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
        rows = (
            await acol("images")
            .aggregate(image_tags.merged_tag_counts_pipeline())
            .to_list(length=None)
        )
        merged = [
            {"_id": f"{image_tags.ANY_PREFIX}{r['_id']}", "count": r["count"]}
            for r in rows
            if r.get("_id")
        ]
        async with _CACHE_LOCK:
            _TAGS_CACHE[cache_key] = (now, merged)
        return merged

    # AI tags are primary (no prefix). Manual tags are `manual:<tag>`, prompt-
    # extracted tags are `prompt:<term>`. By default the browser is AI-only; the
    # Tags view opts into the other kinds. Prompt vocabularies are large, so they
    # stay off unless explicitly requested.
    exclude = image_tags.browse_exclude_match(
        include_manual=include_manual, include_prompt=include_prompt
    )
    pipeline = [
        {"$unwind": {"path": "$tags", "preserveNullAndEmptyArrays": False}},
        *([] if exclude is None else [{"$match": exclude}]),
        # $max picks the newest image id (ids sort like _id desc) without a
        # blocking pre-group $sort over every unwound tag occurrence.
        {
            "$group": {
                "_id": "$tags",
                "count": {"$sum": 1},
                "sample_image_id": {"$max": "$_id"},
            }
        },
        {"$sort": {"count": -1}},
    ]
    result = await acol("images").aggregate(pipeline).to_list(length=None)

    tag_ids = [r.get("_id") for r in result if r.get("_id")]
    overrides: dict[str, str] = {}
    if tag_ids:
        override_docs = (
            await acol("tag_meta")
            .find({"_id": {"$in": tag_ids}}, {"thumb_image_id": 1})
            .to_list(length=None)
        )
        overrides = {
            d.get("_id"): d.get("thumb_image_id")
            for d in override_docs
            if d.get("thumb_image_id")
        }

    for r in result:
        tag = r.get("_id")
        thumb_id = overrides.get(tag) or r.get("sample_image_id")
        r["thumb_image_id"] = thumb_id
        r.pop("sample_image_id", None)
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
    results = await asyncio.gather(*[_samples_for_tag(t, per) for t in tags])
    return {tag: samples for tag, samples in zip(tags, results)}


@router.post("/thumbnail/{tag:path}")
async def set_tag_thumbnail(tag: str, body: TagThumbnailSet):
    tag = validate_tags([tag])[0]
    image_id = body.image_id

    img = await acol("images").find_one({"_id": image_id, "tags": tag}, {"_id": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found for tag thumbnail")

    await acol("tag_meta").update_one(
        {"_id": tag},
        {"$set": {"thumb_image_id": image_id, "updated_at": time.time()}},
        upsert=True,
    )
    async with _CACHE_LOCK:
        _TAGS_CACHE.clear()
        _SAMPLES_CACHE.clear()
    return {"tag": tag, "thumb_image_id": image_id}


@router.delete("/thumbnail/{tag:path}")
async def clear_tag_thumbnail(tag: str):
    tag = validate_tags([tag])[0]
    await acol("tag_meta").delete_one({"_id": tag})
    async with _CACHE_LOCK:
        _TAGS_CACHE.clear()
        _SAMPLES_CACHE.clear()
    return {"tag": tag, "cleared": True}


@router.post("/apply/{image_id}")
async def apply_tags(image_id: str, tags: list[str]):
    added = [image_tags.to_manual(t) for t in validate_tags(tags)]
    await image_tags.apply_manual(image_id, validate_tags(tags))
    # Invalidate cache
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
