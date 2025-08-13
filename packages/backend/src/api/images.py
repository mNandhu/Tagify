from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
import mimetypes

from ..database.mongo import col

router = APIRouter()


@router.get("")
async def list_images(
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
    cursor = col("images").find(q).skip(offset).limit(limit)
    items = list(cursor)
    for it in items:
        it["_id"] = str(it["_id"])  # string id
    return items


@router.get("/{image_id}")
async def get_image(image_id: str):
    img = col("images").find_one({"_id": image_id})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    img["_id"] = str(img["_id"])
    return img


@router.get("/{image_id}/file")
async def get_image_file(image_id: str):
    img = col("images").find_one({"_id": image_id}, {"path": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    path = img.get("path")
    if not path:
        raise HTTPException(status_code=404, detail="File path not available")
    media_type, _ = mimetypes.guess_type(path)
    return FileResponse(path, media_type=media_type)
