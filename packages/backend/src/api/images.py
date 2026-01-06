from fastapi import APIRouter, HTTPException, Query, Request, Header, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import mimetypes
import anyio

from ..database.motor import acol
from ..services.storage_minio import (
    get_original,
    get_thumb,
    stat_original,
    presign_original,
    presign_thumb,
)
from ..core import config


async def _find_image_doc(image_id: str, projection: dict | None = None):
    images = acol("images")
    doc = await images.find_one({"_id": image_id}, projection)
    if doc:
        return doc
    # Tolerate Windows backslash vs forward slash mismatches
    if "/" in image_id:
        alt = image_id.replace("/", "\\")
        doc = await images.find_one({"_id": alt}, projection)
        if doc:
            return doc
    if "\\" in image_id:
        alt = image_id.replace("\\", "/")
        doc = await images.find_one({"_id": alt}, projection)
        if doc:
            return doc
    return None


router = APIRouter()


class RatingPatch(BaseModel):
    rating: str


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
    cursor: str | None = Query(default=None),
):
    # Lightweight input validation / abuse guards
    if logic not in ("and", "or"):
        raise HTTPException(status_code=422, detail="logic must be 'and' or 'or'")
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
    # Projection keeps payload small for the grid
    projection = {"_id": 1, "path": 1, "width": 1, "height": 1}
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
    for it in items:
        it["_id"] = str(it["_id"])  # string id
    return items


@router.get("/{image_id:path}/file")
async def get_image_file(
    image_id: str,
    request: Request,
    range: str | None = Header(default=None, alias="Range"),
):
    img = await _find_image_doc(image_id, {"path": 1, "original_key": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    original_key = img.get("original_key")
    if original_key:
        # If presigned mode is enabled and no Range requested, offload via redirect or return URL
        if not range and config.MEDIA_PRESIGNED_MODE in ("redirect", "url"):
            url = presign_original(original_key)
            if config.MEDIA_PRESIGNED_MODE == "redirect":
                resp = Response(status_code=307)
                resp.headers["Location"] = url
                return resp
            else:
                return {"url": url}
        # Support HTTP Range for partial content
        if range:
            # Parse bytes=start-end
            try:
                unit, rng = range.split("=", 1)
                if unit.strip().lower() != "bytes":
                    raise ValueError
                start_str, end_str = rng.split("-", 1)
                start = int(start_str) if start_str else 0
                end = int(end_str) if end_str else None
            except Exception:
                raise HTTPException(status_code=416, detail="Invalid Range header")

            # Stat object to get total size and etag
            st = await anyio.to_thread.run_sync(stat_original, original_key)
            total_len = getattr(st, "size", None)
            # Compute readable range
            if end is None and total_len is not None:
                end = total_len - 1
            length = None if end is None else (end - start + 1)
            # Fetch ranged stream
            stream_obj = await anyio.to_thread.run_sync(
                lambda: get_original(original_key, offset=start, length=length)
            )
            headers = {"Accept-Ranges": "bytes"}
            if total_len is not None and end is not None:
                headers["Content-Range"] = f"bytes {start}-{end}/{int(total_len)}"
            et = getattr(st, "etag", None)
            if isinstance(et, str) and et:
                headers["ETag"] = et
            headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return StreamingResponse(
                stream_obj.stream(32 * 1024),
                status_code=206,
                media_type=getattr(st, "content_type", None)
                or "application/octet-stream",
                headers=headers,
            )
        # Full object
        obj = await anyio.to_thread.run_sync(lambda: get_original(original_key))
        headers = {"Accept-Ranges": "bytes"}
        etag = obj.headers.get("ETag")
        if etag:
            headers["ETag"] = etag
        headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return StreamingResponse(
            obj.stream(32 * 1024),
            media_type=obj.headers.get("Content-Type", "application/octet-stream"),
            headers=headers,
        )
    # Fallback: serve from filesystem for pre-migration records
    path = img.get("path")
    if not path:
        raise HTTPException(status_code=404, detail="File path not available")
    media_type, _ = mimetypes.guess_type(path)
    return FileResponse(path, media_type=media_type)


@router.get("/{image_id:path}/thumb")
async def get_image_thumb(image_id: str):
    img = await _find_image_doc(image_id, {"thumb_key": 1, "thumb_rel": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    thumb_key = img.get("thumb_key")
    if thumb_key:
        if config.MEDIA_PRESIGNED_MODE in ("redirect", "url"):
            url = presign_thumb(thumb_key)
            if config.MEDIA_PRESIGNED_MODE == "redirect":
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
            obj.stream(32 * 1024), media_type="image/jpeg", headers=headers
        )
    # Fallback to filesystem thumbs during migration if rel exists
    rel = img.get("thumb_rel")
    if not rel:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    # Legacy static path under /thumbs is removed in new setup; return 404 if not migrated
    raise HTTPException(status_code=404, detail="Thumbnail not migrated yet")


@router.head("/{image_id:path}/thumb")
async def head_image_thumb(image_id: str):
    img = await _find_image_doc(image_id, {"thumb_key": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    if config.MEDIA_PRESIGNED_MODE == "url":
        return Response(status_code=200, media_type="application/json")
    headers = {"Accept-Ranges": "bytes"}
    return Response(status_code=200, headers=headers, media_type="image/jpeg")


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

    raw = (body.rating or "").strip().lower()
    # Accept a few aliases; store canonical values.
    if raw in ("", "-", "none"):
        rating = "-"
    elif raw in ("general", "safe"):
        rating = "general"
    elif raw in ("sensitive", "questionable", "explicit"):
        rating = raw
    else:
        raise HTTPException(
            status_code=422,
            detail="rating must be one of '-', 'general', 'sensitive', 'questionable', 'explicit'",
        )

    await acol("images").update_one({"_id": img["_id"]}, {"$set": {"rating": rating}})
    return {"_id": str(img["_id"]), "rating": rating}


@router.head("/{image_id:path}/file")
async def head_image_file(image_id: str):
    img = await _find_image_doc(image_id, {"original_key": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    if config.MEDIA_PRESIGNED_MODE == "url":
        return Response(status_code=200, media_type="application/json")
    original_key = img.get("original_key")
    media_type = "application/octet-stream"
    headers: dict[str, str] = {"Accept-Ranges": "bytes"}
    if original_key:
        try:
            st = await anyio.to_thread.run_sync(stat_original, original_key)
            mt = getattr(st, "content_type", None)
            if isinstance(mt, str) and mt:
                media_type = mt
        except Exception:
            # Best-effort: HEAD should still succeed even if stat fails transiently.
            pass
    return Response(status_code=200, headers=headers, media_type=media_type)
