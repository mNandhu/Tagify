from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
import mimetypes

from ..database.mongo import col
from ..services.storage_minio import get_original, get_thumb

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


@router.get("/{image_id}")
def get_image(image_id: str):
    img = col("images").find_one({"_id": image_id})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    img["_id"] = str(img["_id"])
    return img


@router.get("/{image_id}/file")
def get_image_file(image_id: str):
    img = col("images").find_one({"_id": image_id}, {"path": 1, "original_key": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    original_key = img.get("original_key")
    if original_key:
        obj = get_original(original_key)
        headers = {}
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


@router.get("/{image_id}/thumb")
def get_image_thumb(image_id: str):
    img = col("images").find_one({"_id": image_id}, {"thumb_key": 1, "thumb_rel": 1})
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
