from fastapi import APIRouter, HTTPException, Query, Request, Header
from fastapi.responses import FileResponse, StreamingResponse
import mimetypes

from ..database.mongo import col
from ..services.storage_minio import get_original, get_thumb, stat_original


def _find_image_doc(image_id: str, projection: dict | None = None):
    images = col("images")
    doc = images.find_one({"_id": image_id}, projection)
    if doc:
        return doc
    # Tolerate Windows backslash vs forward slash mismatches
    if "/" in image_id:
        alt = image_id.replace("/", "\\")
        doc = images.find_one({"_id": alt}, projection)
        if doc:
            return doc
    if "\\" in image_id:
        alt = image_id.replace("\\", "/")
        doc = images.find_one({"_id": alt}, projection)
        if doc:
            return doc
    return None


router = APIRouter()


@router.get("")
def list_images(
    tags: list[str] | None = Query(default=None),
    logic: str = Query(default="and"),
    library_id: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    no_tags: int | None = Query(default=None, alias="no_tags"),
):
    q: dict = {}
    if no_tags == 1:
        # Only "no tags" filter: images with no tags (missing or empty)
        q["$or"] = [{"tags": {"$exists": False}}, {"tags": {"$size": 0}}]
    elif tags:
        # Tag filters: OR uses $in, AND uses $all
        q = {"tags": {"$in": tags}} if logic == "or" else {"tags": {"$all": tags}}
    if library_id:
        q["library_id"] = library_id
    # Projection keeps payload small for the grid
    projection = {"_id": 1, "path": 1, "width": 1, "height": 1}
    cursor = col("images").find(q, projection).sort("_id", -1).skip(offset).limit(limit)
    items = list(cursor)
    for it in items:
        it["_id"] = str(it["_id"])  # string id
    return items


@router.get("/{image_id:path}/file")
def get_image_file(
    image_id: str,
    request: Request,
    range: str | None = Header(default=None, alias="Range"),
):
    img = _find_image_doc(image_id, {"path": 1, "original_key": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    original_key = img.get("original_key")
    if original_key:
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
            st = stat_original(original_key)
            total_len = getattr(st, "size", None)
            # Compute readable range
            if end is None and total_len is not None:
                end = total_len - 1
            length = None if end is None else (end - start + 1)
            # Fetch ranged stream
            stream_obj = get_original(original_key, offset=start, length=length)
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
        obj = get_original(original_key)
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
def get_image_thumb(image_id: str):
    img = _find_image_doc(image_id, {"thumb_key": 1, "thumb_rel": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    thumb_key = img.get("thumb_key")
    if thumb_key:
        obj = get_thumb(thumb_key)
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


@router.get("/{image_id:path}")
def get_image(image_id: str):
    img = _find_image_doc(image_id)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    img["_id"] = str(img["_id"])
    return img
