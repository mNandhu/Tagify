from fastapi import APIRouter, HTTPException, Query, Request, Header, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import mimetypes
import anyio
import os
from urllib.parse import quote

from ..database.motor import acol
from ..services.storage_minio import (
    get_thumb,
    presign_thumb,
)
from ..services import image_tags
from ..services.image_tags import find_image as _find_image_doc
from ..core.config import settings


router = APIRouter()


class RatingPatch(BaseModel):
    rating: str


class ScorePatch(BaseModel):
    score: int


class QuarantinePatch(BaseModel):
    quarantined: bool


class PurgeBody(BaseModel):
    confirm: bool = False


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
    cursor: str | None = Query(default=None),
):
    # Lightweight input validation / abuse guards
    if logic not in ("and", "or"):
        raise HTTPException(status_code=422, detail="logic must be 'and' or 'or'")
    if plogic not in ("and", "or"):
        raise HTTPException(status_code=422, detail="plogic must be 'and' or 'or'")
    if tags:
        if len(tags) > 100:
            raise HTTPException(status_code=422, detail="too many tags (max 100)")
        for t in tags:
            if not isinstance(t, str) or len(t) == 0:
                raise HTTPException(status_code=422, detail="tags must be non-empty")
            if len(t) > 128:
                raise HTTPException(status_code=422, detail="tag too long (max 128)")
    if cursor and len(cursor) > 1024:
        raise HTTPException(status_code=422, detail="cursor too long")

    q: dict = {}
    if tags:
        if no_tags == 1:
            # Asking for specific tags and also "no tags" is contradictory.
            raise HTTPException(
                status_code=422,
                detail="no_tags=1 cannot be combined with tags filter",
            )
        # Tag filters: OR uses $in, AND uses $all
        q = {"tags": {"$in": tags}} if logic == "or" else {"tags": {"$all": tags}}
        if no_ai_tags == 1:
            # Combineable: "images that have these tags" AND "no AI tags".
            q["has_ai_tags"] = False
    else:
        if no_tags == 1:
            # Fast-path: use has_tags boolean set at write time
            q["has_tags"] = False
        if no_ai_tags == 1:
            # Images without any AI-generated tags (manual tags do not count).
            q["has_ai_tags"] = False
    if library_id:
        q["library_id"] = library_id
    # Curation: quarantined images leave the default feed. `$ne True` (not
    # `== False`) so pre-existing docs without the field still appear.
    if quarantined == 1:
        q["quarantined"] = True
    else:
        q["quarantined"] = {"$ne": True}
    # "Needs mapping": ComfyUI images whose structured prompt extraction failed
    # (a signature is present but no positive prompt was resolved). Derived, not
    # stored — clears automatically once a reproject extracts a prompt.
    if needs_mapping == 1:
        q["gen.workflow_sig"] = {"$ne": None}
        q["gen.prompt"] = None
    # Generation-metadata filters. Prompt terms reuse the tokenized index; AND
    # uses $all, OR uses $in. Model is an equality/$in over the checkpoint.
    if pterms:
        terms = [t.strip().lower() for t in pterms if t and t.strip()]
        if terms:
            q["gen.prompt_terms"] = (
                {"$in": terms} if plogic == "or" else {"$all": terms}
            )
    if model:
        models = [m for m in model if m]
        if models:
            q["gen.model"] = {"$in": models}
    # Dimension ranges reuse the existing width/height fields.
    for field, lo, hi in (("width", min_w, max_w), ("height", min_h, max_h)):
        rng: dict = {}
        if lo is not None:
            rng["$gte"] = lo
        if hi is not None:
            rng["$lte"] = hi
        if rng:
            q[field] = rng
    # Projection keeps payload small for the grid. thumb_key is included so we
    # can hand the grid a ready-to-use thumb_url and skip the per-tile round
    # trip through /thumb (a 307 redirect or a resolve request).
    projection = {
        "_id": 1,
        "path": 1,
        "width": 1,
        "height": 1,
        "thumb_key": 1,
        "blurhash": 1,
        "score": 1,
    }
    # Cursor-based pagination: when cursor is provided, fetch items with _id < cursor (descending order)
    if cursor:
        q["_id"] = {"$lt": cursor}
    cur = acol("images").find(q, projection).sort("_id", -1).limit(limit)
    if not cursor and offset:
        response.headers["X-Tagify-Warn"] = (
            "offset pagination is deprecated; prefer cursor-based pagination"
        )
        cur = cur.skip(offset)
    items = await cur.to_list(length=limit)
    presign_mode = settings.media_presigned_mode in ("redirect", "url")
    for it in items:
        it["_id"] = str(it["_id"])  # string id
        # Embed a directly-usable thumbnail URL so the grid renders <img src>
        # without a second request. In presigned modes this is the MinIO URL
        # (presign is local HMAC, no I/O); otherwise it's the streaming route.
        thumb_key = it.pop("thumb_key", None)
        if thumb_key and presign_mode:
            it["thumb_url"] = presign_thumb(thumb_key)
        else:
            it["thumb_url"] = f"/api/images/{quote(it['_id'], safe='')}/thumb"
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
    if not await anyio.to_thread.run_sync(lambda: os.path.isfile(path)):
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

    if not await anyio.to_thread.run_sync(lambda: os.path.isfile(path)):
        raise HTTPException(status_code=404, detail="Original file not found on disk")

    media_type, _ = mimetypes.guess_type(path)
    st = await anyio.to_thread.run_sync(lambda: os.stat(path))
    headers: dict[str, str] = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(st.st_size),
    }
    return Response(
        status_code=200, headers=headers, media_type=media_type or "application/octet-stream"
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

    if settings.media_presigned_mode in ("redirect", "url"):
        url = presign_thumb(thumb_key)
        if settings.media_presigned_mode == "redirect":
            resp = Response(status_code=307)
            resp.headers["Location"] = url
            return resp
        else:
            return {"url": url}
    obj = await anyio.to_thread.run_sync(lambda: get_thumb(thumb_key))
    headers = {}
    etag = obj.headers.get("ETag")
    if etag:
        headers["ETag"] = etag
        headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return StreamingResponse(
        obj.stream(32 * 1024), media_type=media_type, headers=headers
    )


@router.head("/{image_id:path}/thumb")
async def head_image_thumb(image_id: str):
    img = await _find_image_doc(image_id, {"thumb_key": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    if settings.media_presigned_mode == "url":
        return Response(status_code=200, media_type="application/json")
    thumb_key = img.get("thumb_key", "")
    media_type = "image/webp" if thumb_key.endswith(".webp") else "image/jpeg"
    headers = {"Accept-Ranges": "bytes"}
    return Response(status_code=200, headers=headers, media_type=media_type)


@router.get("/models")
async def list_models(library_id: str | None = Query(default=None)):
    """Distinct extracted checkpoints with image counts, for the model filter
    dropdown. Sorted by frequency."""
    match: dict = {"gen.model": {"$ne": None}}
    if library_id:
        match["library_id"] = library_id
    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$gen.model", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    rows = await acol("images").aggregate(pipeline).to_list(length=10000)
    return [{"model": r["_id"], "count": r["count"]} for r in rows]


@router.get("/{image_id:path}/workflow")
async def get_image_workflow(image_id: str):
    """Generation data for copy-workflow / remix.

    Format-aware: ComfyUI returns the `workflow` (UI graph, drops onto canvas)
    plus the `prompt` (API graph); A1111 returns the `parameters` string.
    """
    raw = await acol("image_gen_raw").find_one({"_id": image_id})
    if not raw:
        # Tolerate slash/backslash id variants like find_image does.
        from ..services.image_tags import id_variants

        for alt in id_variants(image_id):
            raw = await acol("image_gen_raw").find_one({"_id": alt})
            if raw:
                break
    if not raw:
        raise HTTPException(status_code=404, detail="No generation data for image")

    source = raw.get("source")
    if source == "comfyui":
        return {
            "source": "comfyui",
            "workflow": raw.get("workflow"),
            "prompt": raw.get("prompt"),
        }
    if source == "a1111":
        return {"source": "a1111", "parameters": raw.get("parameters")}
    return {"source": source}


@router.get("/{image_id:path}")
async def get_image(image_id: str):
    img = await _find_image_doc(image_id)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    img["_id"] = str(img["_id"])
    return img


@router.post("/{image_id:path}/rating")
async def set_image_rating(image_id: str, body: RatingPatch):
    img = await _find_image_doc(image_id, {"_id": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    rating = image_tags.normalize_rating(body.rating)
    if rating is None:
        raise HTTPException(
            status_code=422,
            detail="rating must be one of '-', 'general', 'sensitive', 'questionable', 'explicit'",
        )

    await acol("images").update_one({"_id": img["_id"]}, {"$set": {"rating": rating}})
    return {"_id": str(img["_id"]), "rating": rating}


@router.post("/{image_id:path}/score")
async def set_image_score(image_id: str, body: ScorePatch):
    """Set the 0-5 quality score (distinct from the content-safety `rating`)."""
    if not (0 <= body.score <= 5):
        raise HTTPException(status_code=422, detail="score must be 0-5")
    img = await _find_image_doc(image_id, {"_id": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    await acol("images").update_one(
        {"_id": img["_id"]}, {"$set": {"score": body.score}}
    )
    return {"_id": str(img["_id"]), "score": body.score}


@router.post("/{image_id:path}/quarantine")
async def set_image_quarantine(image_id: str, body: QuarantinePatch):
    """Toggle the DB-only quarantine flag (hides from default feed; no disk I/O)."""
    img = await _find_image_doc(image_id, {"_id": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    await acol("images").update_one(
        {"_id": img["_id"]}, {"$set": {"quarantined": bool(body.quarantined)}}
    )
    return {"_id": str(img["_id"]), "quarantined": bool(body.quarantined)}


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

    path = img.get("path")
    if path:
        def _unlink():
            try:
                os.remove(path)
            except FileNotFoundError:
                pass

        await anyio.to_thread.run_sync(_unlink)

    await acol("images").delete_one({"_id": img["_id"]})
    await acol("image_gen_raw").delete_one({"_id": img["_id"]})

    thumb_key = img.get("thumb_key")
    if thumb_key:
        try:
            from ..services.storage_minio import get_minio

            client = get_minio()
            await anyio.to_thread.run_sync(
                lambda: client.remove_object(settings.minio_bucket_thumbs, thumb_key)
            )
        except Exception:
            pass

    return {"_id": str(img["_id"]), "purged": True}
