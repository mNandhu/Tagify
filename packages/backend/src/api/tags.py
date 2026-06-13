from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..database.motor import acol
import time
import asyncio

from ._utils import validate_tags
from ..services import image_tags

_TAGS_CACHE: dict[str, tuple[float, list[dict]]] = {}
_TAGS_TTL_SECONDS = 30.0
_CACHE_LOCK = asyncio.Lock()

router = APIRouter()


class TagThumbnailSet(BaseModel):
    image_id: str


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
        *([] if include_manual else [{"$match": image_tags.exclude_manual_match()}]),
        {"$sort": {"_id": -1}},
        {
            "$group": {
                "_id": "$tags",
                "count": {"$sum": 1},
                "sample_image_id": {"$first": "$_id"},
            }
        },
        {"$sort": {"count": -1}},
    ]
    result = await acol("images").aggregate(pipeline).to_list(length=None)

    tag_ids = [r.get("_id") for r in result if r.get("_id")]
    overrides: dict[str, str] = {}
    if tag_ids:
        override_docs = (
            await acol("tag_meta")
            .find({"_id": {"$in": tag_ids}}, {"thumb_image_id": 1})
            .to_list(length=None)
        )
        overrides = {
            d.get("_id"): d.get("thumb_image_id")
            for d in override_docs
            if d.get("thumb_image_id")
        }

    for r in result:
        tag = r.get("_id")
        thumb_id = overrides.get(tag) or r.get("sample_image_id")
        r["thumb_image_id"] = thumb_id
        r.pop("sample_image_id", None)
    async with _CACHE_LOCK:
        _TAGS_CACHE[cache_key] = (now, result)
    return result


@router.post("/thumbnail/{tag:path}")
async def set_tag_thumbnail(tag: str, body: TagThumbnailSet):
    tag = validate_tags([tag])[0]
    image_id = body.image_id

    img = await acol("images").find_one({"_id": image_id, "tags": tag}, {"_id": 1})
    if not img:
        raise HTTPException(status_code=404, detail="Image not found for tag thumbnail")

    await acol("tag_meta").update_one(
        {"_id": tag},
        {"$set": {"thumb_image_id": image_id, "updated_at": time.time()}},
        upsert=True,
    )
    async with _CACHE_LOCK:
        _TAGS_CACHE.clear()
    return {"tag": tag, "thumb_image_id": image_id}


@router.delete("/thumbnail/{tag:path}")
async def clear_tag_thumbnail(tag: str):
    tag = validate_tags([tag])[0]
    await acol("tag_meta").delete_one({"_id": tag})
    async with _CACHE_LOCK:
        _TAGS_CACHE.clear()
    return {"tag": tag, "cleared": True}


@router.post("/apply/{image_id}")
async def apply_tags(image_id: str, tags: list[str]):
    added = [image_tags.to_manual(t) for t in validate_tags(tags)]
    await image_tags.apply_manual(image_id, validate_tags(tags))
    # Invalidate cache
    async with _CACHE_LOCK:
        _TAGS_CACHE.clear()
    return {"image_id": image_id, "added": added}


@router.post("/remove/{image_id}")
async def remove_tags(image_id: str, tags: list[str]):
    tags = validate_tags(tags)
    await image_tags.remove_tags(image_id, tags)
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
