from fastapi import APIRouter
from ..database.motor import acol
import time
import asyncio

from ._utils import validate_tags

_TAGS_CACHE: dict[str, tuple[float, list[dict]]] = {}
_TAGS_TTL_SECONDS = 30.0
_CACHE_LOCK = asyncio.Lock()

router = APIRouter()


@router.get("")
async def list_tags(include_manual: bool = False):
    now = time.time()
    cache_key = "all_with_manual" if include_manual else "all"
    async with _CACHE_LOCK:
        cached = _TAGS_CACHE.get(cache_key)
        if cached and (now - cached[0]) < _TAGS_TTL_SECONDS:
            return cached[1]

    # AI tags are primary (no prefix). Manual tags are stored as `manual:<tag>`.
    # By default we exclude manual tags from the tag browser; Tags view can opt-in.
    pipeline = [
        {"$unwind": {"path": "$tags", "preserveNullAndEmptyArrays": False}},
        *(
            []
            if include_manual
            else [{"$match": {"tags": {"$not": {"$regex": r"^manual:"}}}}]
        ),
        {"$group": {"_id": "$tags", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    result = await acol("images").aggregate(pipeline).to_list(length=None)
    async with _CACHE_LOCK:
        _TAGS_CACHE[cache_key] = (now, result)
    return result


@router.post("/apply/{image_id}")
async def apply_tags(image_id: str, tags: list[str]):
    # Manual tags are stored with a `manual:` prefix so they can be distinguished
    # from AI-generated (primary) tags.
    tags = [
        (t if t.startswith("manual:") else f"manual:{t}") for t in validate_tags(tags)
    ]
    await acol("images").update_one(
        {"_id": image_id},
        {
            "$addToSet": {"tags": {"$each": tags}},
            "$set": {"has_tags": True},
        },
    )
    # Invalidate cache
    async with _CACHE_LOCK:
        _TAGS_CACHE.clear()
    return {"image_id": image_id, "added": tags}


@router.post("/remove/{image_id}")
async def remove_tags(image_id: str, tags: list[str]):
    tags = validate_tags(tags)
    # Pull tags; if array becomes empty, set has_tags False
    images = acol("images")
    await images.update_one({"_id": image_id}, {"$pull": {"tags": {"$in": tags}}})
    doc = await images.find_one({"_id": image_id}, {"tags": 1})
    if doc is not None:
        t = doc.get("tags") or []
        await images.update_one({"_id": image_id}, {"$set": {"has_tags": bool(t)}})
    async with _CACHE_LOCK:
        _TAGS_CACHE.clear()
    return {"image_id": image_id, "removed": tags}


@router.post("/ai/{image_id}")
async def ai_tag(image_id: str):
    # Deprecated route retained for convenience.
    # Internal AI tagging is implemented under /ai/*.
    from ..services.ai_jobs import get_ai_job_manager

    jm = get_ai_job_manager()
    job = await jm.enqueue(ids=[image_id])
    return {"job_id": job.id}
