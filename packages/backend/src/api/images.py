from fastapi import APIRouter, HTTPException, Query

from ..database.mongo import col

router = APIRouter()


@router.get("")
async def list_images(
    tags: list[str] | None = Query(default=None), logic: str = Query(default="and")
):
    q = {}
    if tags:
        q = {"tags": {"$in": tags}} if logic == "or" else {"tags": {"$all": tags}}
    items = list(col("images").find(q).limit(200))
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
