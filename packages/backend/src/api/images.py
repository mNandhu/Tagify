from fastapi import APIRouter, HTTPException, Query, Request, Header, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
import mimetypes
import anyio  # type: ignore[import-not-found]
import os
from urllib.parse import quote

import sqlalchemy as sa

from ..database.db import async_conn, async_tx
from ..database import schema as t
from ..services.storage_fs import thumb_path, delete_thumb
from ..services import gen_metadata, image_tags
from ..services.image_tags import find_image as _find_image_doc  # type: ignore


router = APIRouter()


class RatingPatch(BaseModel):
    rating: str


class ScorePatch(BaseModel):
    score: int


class QuarantinePatch(BaseModel):
    quarantined: bool


class PurgeBody(BaseModel):
    confirm: bool = False


def _tag_group_exists(ids: list[str]):
    """An EXISTS clause: the image carries at least one tag from ``ids``."""
    return sa.exists(
        sa.select(1).where(
            t.image_tags.c.image_id == t.images.c._id,
            t.image_tags.c.tag.in_(ids),
        )
    )


def _build_feed_where(
    *,
    tags: list[str] | None,
    logic: str,
    library_id: str | None,
    no_tags: int | None,
    no_ai_tags: int | None,
    quarantined: int | None,
    needs_mapping: int | None,
    pterms: list[str] | None,
    plogic: str,
    model: list[str] | None,
    min_w: int | None,
    max_w: int | None,
    min_h: int | None,
    max_h: int | None,
    group_id: str | None = None,
):
    """Build the SQL WHERE clause shared by the feed and the grouped view, so the
    two can never drift. Raises HTTPException on invalid input."""
    if logic not in ("and", "or"):
        raise HTTPException(status_code=422, detail="logic must be 'and' or 'or'")
    if plogic not in ("and", "or"):
        raise HTTPException(status_code=422, detail="plogic must be 'and' or 'or'")
    if tags:
        if len(tags) > 100:
            raise HTTPException(status_code=422, detail="too many tags (max 100)")
        for tag in tags:
            if not isinstance(tag, str) or len(tag) == 0:
                raise HTTPException(status_code=422, detail="tags must be non-empty")
            if len(tag) > 128:
                raise HTTPException(status_code=422, detail="tag too long (max 128)")

    conds: list = []
    if tags:
        if no_tags == 1:
            raise HTTPException(
                status_code=422,
                detail="no_tags=1 cannot be combined with tags filter",
            )
        # `any:<base>` entries fan out to all sources; exact tags stay precise.
        # AND across groups, OR within each group — one EXISTS per group.
        for group in image_tags.tag_match_groups(tags, logic):
            conds.append(_tag_group_exists(group))
        if no_ai_tags == 1:
            conds.append(t.images.c.has_ai_tags.is_(False))
    else:
        if no_tags == 1:
            conds.append(t.images.c.has_tags.is_(False))
        if no_ai_tags == 1:
            conds.append(t.images.c.has_ai_tags.is_(False))
    if library_id:
        conds.append(t.images.c.library_id == library_id)
    # Quarantined images leave the default feed. Treat missing/NULL as not
    # quarantined so legacy rows still appear.
    if quarantined == 1:
        conds.append(t.images.c.quarantined.is_(True))
    else:
        conds.append(sa.func.coalesce(t.images.c.quarantined, False).is_(False))
    if needs_mapping == 1:
        conds.append(t.images.c.gen_workflow_sig.isnot(None))
        conds.append(t.images.c.gen_prompt.is_(None))
    if pterms:
        terms = [p.strip().lower() for p in pterms if p and p.strip()]
        if terms:
            if plogic == "or":
                conds.append(
                    sa.exists(
                        sa.select(1).where(
                            t.image_gen_terms.c.image_id == t.images.c._id,
                            t.image_gen_terms.c.term.in_(terms),
                        )
                    )
                )
            else:
                # $all: the image must carry every term.
                for term in terms:
                    conds.append(
                        sa.exists(
                            sa.select(1).where(
                                t.image_gen_terms.c.image_id == t.images.c._id,
                                t.image_gen_terms.c.term == term,
                            )
                        )
                    )
    if model:
        models = [m for m in model if m]
        if models:
            conds.append(t.images.c.gen_model.in_(models))
    if min_w is not None:
        conds.append(t.images.c.width >= min_w)
    if max_w is not None:
        conds.append(t.images.c.width <= max_w)
    if min_h is not None:
        conds.append(t.images.c.height >= min_h)
    if max_h is not None:
        conds.append(t.images.c.height <= max_h)
    # Drill into one batch's members (used by the grouped view's expand).
    if group_id:
        conds.append(t.images.c.gen_group_id == group_id)
    return sa.and_(*conds) if conds else sa.true()


# Columns the grid needs (kept minimal for payload size).
_FEED_COLS = (
    t.images.c._id,
    t.images.c.path,
    t.images.c.width,
    t.images.c.height,
    t.images.c.thumb_key,
    t.images.c.blurhash,
    t.images.c.score,
)


def _attach_thumb_url(it: dict) -> None:
    """Replace the row's thumb_key with the streaming thumb route."""
    it.pop("thumb_key", None)
    it["thumb_url"] = f"/api/images/{quote(it['_id'], safe='')}/thumb"


@router.get("")
async def list_images(
    response: Response,
    tags: list[str] | None = Query(default=None),
    logic: str = Query(default="and"),
    library_id: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    no_tags: int | None = Query(default=None, alias="no_tags"),
    no_ai_tags: int | None = Query(default=None, alias="no_ai_tags"),
    quarantined: int | None = Query(default=None),
    needs_mapping: int | None = Query(default=None),
    pterms: list[str] | None = Query(default=None),
    plogic: str = Query(default="and"),
    model: list[str] | None = Query(default=None),
    min_w: int | None = Query(default=None, ge=0),
    max_w: int | None = Query(default=None, ge=0),
    min_h: int | None = Query(default=None, ge=0),
    max_h: int | None = Query(default=None, ge=0),
    group_id: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
):
    if cursor and len(cursor) > 1024:
        raise HTTPException(status_code=422, detail="cursor too long")

    where = _build_feed_where(
        tags=tags,
        logic=logic,
        library_id=library_id,
        no_tags=no_tags,
        no_ai_tags=no_ai_tags,
        quarantined=quarantined,
        needs_mapping=needs_mapping,
        pterms=pterms,
        plogic=plogic,
        model=model,
        min_w=min_w,
        max_w=max_w,
        min_h=min_h,
        max_h=max_h,
        group_id=group_id,
    )
    stmt = sa.select(*_FEED_COLS).where(where)
    # Cursor-based pagination: fetch items with _id < cursor (descending order).
    if cursor:
        stmt = stmt.where(t.images.c._id < cursor)
    stmt = stmt.order_by(t.images.c._id.desc()).limit(limit)
    if not cursor and offset:
        response.headers["X-Tagify-Warn"] = (
            "offset pagination is deprecated; prefer cursor-based pagination"
        )
        stmt = stmt.offset(offset)

    async with async_conn() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    items = [dict(r._mapping) for r in rows]
    for it in items:
        _attach_thumb_url(it)
    return items


@router.get("/{image_id:path}/file")
async def get_image_file(
    image_id: str,
    request: Request,
    range: str | None = Header(default=None, alias="Range"),
):
    """Serve the original image file directly from the local filesystem."""
    img = await _find_image_doc(image_id, {"path": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    path = img.get("path")
    if not path:
        raise HTTPException(status_code=404, detail="File path not available")

    # Verify the file still exists on disk
    if not await anyio.to_thread.run_sync(lambda: os.path.isfile(path)):  # type: ignore[attr-defined]
        raise HTTPException(status_code=404, detail="Original file not found on disk")

    media_type, _ = mimetypes.guess_type(path)
    # FileResponse handles Range headers, ETag, Content-Length natively
    return FileResponse(
        path,
        media_type=media_type or "application/octet-stream",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "Accept-Ranges": "bytes",
        },
    )


@router.head("/{image_id:path}/file")
async def head_image_file(image_id: str):
    """HEAD for the original image file — stat from the local filesystem."""
    img = await _find_image_doc(image_id, {"path": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    path = img.get("path")
    if not path:
        raise HTTPException(status_code=404, detail="File path not available")

    if not await anyio.to_thread.run_sync(lambda: os.path.isfile(path)):  # type: ignore[attr-defined]
        raise HTTPException(status_code=404, detail="Original file not found on disk")

    media_type, _ = mimetypes.guess_type(path)
    st = await anyio.to_thread.run_sync(lambda: os.stat(path))  # type: ignore[attr-defined]
    headers: dict[str, str] = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(st.st_size),
    }
    return Response(
        status_code=200,
        headers=headers,
        media_type=media_type or "application/octet-stream",
    )


@router.get("/{image_id:path}/thumb")
async def get_image_thumb(image_id: str):
    img = await _find_image_doc(image_id, {"thumb_key": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    thumb_key = img.get("thumb_key")
    if not thumb_key:
        raise HTTPException(status_code=404, detail="Thumbnail not available")

    # Determine media type from the key extension
    media_type = "image/webp" if thumb_key.endswith(".webp") else "image/jpeg"

    path = await anyio.to_thread.run_sync(lambda: thumb_path(thumb_key))  # type: ignore[attr-defined]
    if path is None:
        raise HTTPException(status_code=404, detail="Thumbnail not found on disk")
    # FileResponse handles ETag/Content-Length/sendfile natively.
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.head("/{image_id:path}/thumb")
async def head_image_thumb(image_id: str):
    img = await _find_image_doc(image_id, {"thumb_key": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    thumb_key = img.get("thumb_key", "") or ""
    media_type = "image/webp" if thumb_key.endswith(".webp") else "image/jpeg"
    headers = {"Accept-Ranges": "bytes"}
    return Response(status_code=200, headers=headers, media_type=media_type)


@router.get("/models")
async def list_models(library_id: str | None = Query(default=None)):
    """Distinct extracted checkpoints with image counts, for the model filter
    dropdown. Sorted by frequency."""
    stmt = (
        sa.select(t.images.c.gen_model, sa.func.count().label("count"))
        .where(t.images.c.gen_model.isnot(None))
        .group_by(t.images.c.gen_model)
        .order_by(sa.func.count().desc())
    )
    if library_id:
        stmt = stmt.where(t.images.c.library_id == library_id)
    async with async_conn() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    return [{"model": r.gen_model, "count": r.count} for r in rows]


@router.get("/groups")
async def list_groups(
    tags: list[str] | None = Query(default=None),
    logic: str = Query(default="and"),
    library_id: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    no_tags: int | None = Query(default=None, alias="no_tags"),
    no_ai_tags: int | None = Query(default=None, alias="no_ai_tags"),
    quarantined: int | None = Query(default=None),
    needs_mapping: int | None = Query(default=None),
    pterms: list[str] | None = Query(default=None),
    plogic: str = Query(default="and"),
    model: list[str] | None = Query(default=None),
    min_w: int | None = Query(default=None, ge=0),
    max_w: int | None = Query(default=None, ge=0),
    min_h: int | None = Query(default=None, ge=0),
    max_h: int | None = Query(default=None, ge=0),
):
    """Batch-collapsed view of the same feed: images sharing a gen_group_id fold
    into one entry (the newest member is the representative, plus a count).
    Prompt-less / ungrouped images stand alone. Grouping spans page boundaries
    because it's a full aggregation, not a paged-then-grouped pass."""
    where = _build_feed_where(
        tags=tags,
        logic=logic,
        library_id=library_id,
        no_tags=no_tags,
        no_ai_tags=no_ai_tags,
        quarantined=quarantined,
        needs_mapping=needs_mapping,
        pterms=pterms,
        plogic=plogic,
        model=model,
        min_w=min_w,
        max_w=max_w,
        min_h=min_h,
        max_h=max_h,
    )
    # Ungrouped images key on their own _id so each stands alone (never a single
    # giant "null" bucket). The representative is the newest member; window
    # functions count + pick it in one pass, spanning page boundaries.
    gkey = sa.func.coalesce(t.images.c.gen_group_id, t.images.c._id)
    sub = (
        sa.select(
            t.images.c._id,
            t.images.c.path,
            t.images.c.width,
            t.images.c.height,
            t.images.c.thumb_key,
            t.images.c.blurhash,
            t.images.c.score,
            t.images.c.gen_group_id.label("group_id"),
            sa.func.row_number()
            .over(partition_by=gkey, order_by=t.images.c._id.desc())
            .label("rn"),
            sa.func.count().over(partition_by=gkey).label("group_count"),
        )
        .where(where)
        .subquery()
    )
    stmt = (
        sa.select(sub)
        .where(sub.c.rn == 1)
        .order_by(sub.c._id.desc())
        .offset(offset)
        .limit(limit)
    )
    async with async_conn() as conn:
        rows = (await conn.execute(stmt)).fetchall()
    out = []
    for r in rows:
        it = {
            "_id": r._id,
            "path": r.path,
            "width": r.width,
            "height": r.height,
            "blurhash": r.blurhash,
            "score": r.score,
            "group_id": r.group_id,
            "group_count": r.group_count,
        }
        it["thumb_key"] = r.thumb_key
        _attach_thumb_url(it)
        out.append(it)
    return out


@router.get("/{image_id:path}/workflow")
async def get_image_workflow(image_id: str):
    """Generation data for copy-workflow / remix.

    Format-aware: ComfyUI returns the `workflow` (UI graph, drops onto canvas)
    plus the `prompt` (API graph); A1111 returns the `parameters` string.
    """
    async with async_conn() as conn:
        raw = None
        for candidate in (image_id, *image_tags.id_variants(image_id)):
            row = (
                await conn.execute(
                    sa.select(t.image_gen_raw.c.raw).where(
                        t.image_gen_raw.c._id == candidate
                    )
                )
            ).first()
            if row is not None:
                raw = row.raw
                break
    if not raw:
        raise HTTPException(status_code=404, detail="No generation data for image")

    # Sanitize on the way out: the stored graph can carry NaN/Infinity (ComfyUI's
    # `is_changed`) which Starlette's strict JSON renderer 500s on.
    source = raw.get("source")
    if source == "comfyui":
        return gen_metadata.sanitize_json(
            {
                "source": "comfyui",
                "workflow": raw.get("workflow"),
                "prompt": raw.get("prompt"),
            }
        )
    if source == "a1111":
        return {"source": "a1111", "parameters": raw.get("parameters")}
    return {"source": source}


@router.get("/{image_id:path}")
async def get_image(image_id: str):
    img = await _find_image_doc(image_id)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    return img


async def _resolve_id(conn, image_id: str) -> str | None:
    for candidate in (image_id, *image_tags.id_variants(image_id)):
        found = (
            await conn.execute(
                sa.select(t.images.c._id).where(t.images.c._id == candidate)
            )
        ).scalar()
        if found is not None:
            return found
    return None


@router.post("/{image_id:path}/rating")
async def set_image_rating(image_id: str, body: RatingPatch):
    rating = image_tags.normalize_rating(body.rating)
    if rating is None:
        raise HTTPException(
            status_code=422,
            detail="rating must be one of '-', 'general', 'sensitive', 'questionable', 'explicit'",
        )
    async with async_tx() as conn:
        rid = await _resolve_id(conn, image_id)
        if rid is None:
            raise HTTPException(status_code=404, detail="Image not found")
        await conn.execute(
            sa.update(t.images).where(t.images.c._id == rid).values(rating=rating)
        )
    return {"_id": rid, "rating": rating}


@router.post("/{image_id:path}/score")
async def set_image_score(image_id: str, body: ScorePatch):
    """Set the 0-5 quality score (distinct from the content-safety `rating`)."""
    if not (0 <= body.score <= 5):
        raise HTTPException(status_code=422, detail="score must be 0-5")
    async with async_tx() as conn:
        rid = await _resolve_id(conn, image_id)
        if rid is None:
            raise HTTPException(status_code=404, detail="Image not found")
        await conn.execute(
            sa.update(t.images).where(t.images.c._id == rid).values(score=body.score)
        )
    return {"_id": rid, "score": body.score}


@router.post("/{image_id:path}/quarantine")
async def set_image_quarantine(image_id: str, body: QuarantinePatch):
    """Toggle the DB-only quarantine flag (hides from default feed; no disk I/O)."""
    async with async_tx() as conn:
        rid = await _resolve_id(conn, image_id)
        if rid is None:
            raise HTTPException(status_code=404, detail="Image not found")
        await conn.execute(
            sa.update(t.images)
            .where(t.images.c._id == rid)
            .values(quarantined=bool(body.quarantined))
        )
    return {"_id": rid, "quarantined": bool(body.quarantined)}


@router.post("/{image_id:path}/purge")
async def purge_image(image_id: str, body: PurgeBody):
    """Permanently delete the original file from disk + all DB/thumb records.

    Irreversible. A DB-only delete would resurrect on the next scan (the file is
    rediscovered), so purge must remove the file itself. Guarded by `confirm`.
    """
    if not body.confirm:
        raise HTTPException(status_code=400, detail="purge requires confirm=true")
    img = await _find_image_doc(image_id, {"path": 1, "thumb_key": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    rid = img["_id"]
    path = img.get("path")
    if path:

        def _unlink():
            try:
                os.remove(path)
            except FileNotFoundError:
                pass

        await anyio.to_thread.run_sync(_unlink)  # type: ignore[attr-defined]

    async with async_tx() as conn:
        # image_tags / image_gen_terms rows cascade via the FK.
        await conn.execute(sa.delete(t.images).where(t.images.c._id == rid))
        await conn.execute(
            sa.delete(t.image_gen_raw).where(t.image_gen_raw.c._id == rid)
        )

    thumb_key = img.get("thumb_key")
    if thumb_key:
        try:
            await anyio.to_thread.run_sync(  # type: ignore[attr-defined]
                lambda: delete_thumb(thumb_key)
            )
        except Exception:
            pass

    return {"_id": rid, "purged": True}
