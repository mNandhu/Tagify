from fastapi import APIRouter, HTTPException
from ..database.mongo import col
from ..core.config import AI_TAGGING_URL
import httpx
import time

_TAGS_CACHE: dict[str, tuple[float, list[dict]]] = {}
_TAGS_TTL_SECONDS = 30.0

router = APIRouter()


@router.get("")
async def list_tags():
    now = time.time()
    cached = _TAGS_CACHE.get("all")
    if cached and (now - cached[0]) < _TAGS_TTL_SECONDS:
        return cached[1]
    pipeline = [
        {"$unwind": {"path": "$tags", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": "$tags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    result = list(col("images").aggregate(pipeline))
    _TAGS_CACHE["all"] = (now, result)
    return result


@router.post("/apply/{image_id}")
async def apply_tags(image_id: str, tags: list[str]):
    col("images").update_one(
        {"_id": image_id}, {"$addToSet": {"tags": {"$each": tags}}}
    )
    # Invalidate cache
    _TAGS_CACHE.clear()
    return {"image_id": image_id, "added": tags}


@router.post("/remove/{image_id}")
async def remove_tags(image_id: str, tags: list[str]):
    col("images").update_one({"_id": image_id}, {"$pull": {"tags": {"$in": tags}}})
    _TAGS_CACHE.clear()
    return {"image_id": image_id, "removed": tags}


@router.post("/ai/{image_id}")
async def ai_tag(image_id: str):
    if not AI_TAGGING_URL:
        raise HTTPException(status_code=400, detail="AI_TAGGING_URL not configured")
    img = col("images").find_one({"_id": image_id})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(AI_TAGGING_URL, json={"path": img["path"]})
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict) and "tags" in data:
            tags = data["tags"]
        elif isinstance(data, str):
            tags = [t.strip() for t in data.split(",") if t.strip()]
        else:
            tags = []
    if tags:
        col("images").update_one(
            {"_id": image_id}, {"$addToSet": {"tags": {"$each": tags}}}
        )
    _TAGS_CACHE.clear()
    return {"image_id": image_id, "suggested": tags}
