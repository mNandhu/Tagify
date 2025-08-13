from fastapi import APIRouter, HTTPException
from ..database.mongo import col
from ..core.config import AI_TAGGING_URL
import httpx

router = APIRouter()


@router.get("")
async def list_tags():
    pipeline = [
        {"$unwind": {"path": "$tags", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": "$tags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    return list(col("images").aggregate(pipeline))


@router.post("/apply/{image_id}")
async def apply_tags(image_id: str, tags: list[str]):
    col("images").update_one(
        {"_id": image_id}, {"$addToSet": {"tags": {"$each": tags}}}
    )
    return {"image_id": image_id, "added": tags}


@router.post("/remove/{image_id}")
async def remove_tags(image_id: str, tags: list[str]):
    col("images").update_one({"_id": image_id}, {"$pull": {"tags": {"$in": tags}}})
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
    return {"image_id": image_id, "suggested": tags}
