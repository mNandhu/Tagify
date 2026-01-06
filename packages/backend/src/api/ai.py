from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..database.motor import acol

from ..services.ai_jobs import (
    get_ai_job_manager,
    get_ai_settings,
    update_ai_settings,
)
from ..services.ai_tagger import get_download_manager, get_tagger_manager

router = APIRouter()


class SettingsPatch(BaseModel):
    model_repo: str | None = None
    general_thresh: float | None = None
    character_thresh: float | None = None
    general_mcut: bool | None = None
    character_mcut: bool | None = None
    max_general: int | None = None
    max_character: int | None = None
    idle_unload_s: int | None = None
    cache_dir: str | None = None


class TagRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)
    force: bool = False


class TagUntaggedRequest(BaseModel):
    limit: int = 200
    library_id: str | None = None


@router.get("/settings")
async def ai_get_settings():
    return await get_ai_settings()


@router.post("/settings")
async def ai_set_settings(patch: SettingsPatch):
    return await update_ai_settings(patch.model_dump(exclude_none=True))


@router.get("/status")
async def ai_status():
    jm = get_ai_job_manager()
    s = await get_ai_settings()
    repo = str(s.get("model_repo") or "")
    cache_dir = str(s.get("cache_dir") or ".cache/tagify/models")
    dl = (
        get_download_manager().get_state(model_repo=repo, cache_dir=cache_dir).as_dict()
    )

    return {
        "model": get_tagger_manager().status(),
        "model_load": get_tagger_manager().load_status(),
        "model_download": dl,
        "jobs": {
            "recent": [j.__dict__ for j in jm.list_jobs(limit=10)],
            "queue_depth": jm.queue_depth(),
        },
        "settings": s,
    }


@router.post("/model/load")
async def ai_model_load():
    s = await get_ai_settings()
    started = get_tagger_manager().start_load(
        model_repo=str(s["model_repo"]),
        cache_dir=str(s.get("cache_dir") or ".cache/tagify/models"),
    )
    return {
        "ok": True,
        "started": started,
        "model": get_tagger_manager().status(),
        "model_load": get_tagger_manager().load_status(),
    }


@router.get("/model/load-status")
async def ai_model_load_status():
    return get_tagger_manager().load_status()


@router.post("/model/load-cancel")
async def ai_model_load_cancel():
    ok = await get_tagger_manager().cancel_load()
    return {"ok": ok, "model_load": get_tagger_manager().load_status()}


@router.get("/model/download-status")
async def ai_model_download_status():
    s = await get_ai_settings()
    repo = str(s.get("model_repo") or "")
    cache_dir = str(s.get("cache_dir") or ".cache/tagify/models")
    return (
        get_download_manager().get_state(model_repo=repo, cache_dir=cache_dir).as_dict()
    )


@router.post("/model/download-cancel")
async def ai_model_download_cancel():
    s = await get_ai_settings()
    repo = str(s.get("model_repo") or "")
    cache_dir = str(s.get("cache_dir") or ".cache/tagify/models")
    ok = await get_download_manager().cancel(model_repo=repo, cache_dir=cache_dir)
    return {
        "ok": ok,
        "download": get_download_manager()
        .get_state(model_repo=repo, cache_dir=cache_dir)
        .as_dict(),
    }


@router.post("/model/unload")
async def ai_model_unload():
    await get_tagger_manager().unload()
    return {"ok": True, "model": get_tagger_manager().status()}


@router.post("/tag")
async def ai_tag(req: TagRequest):
    jm = get_ai_job_manager()
    job = await jm.enqueue(ids=req.ids, force=bool(req.force))
    return {"job_id": job.id, "queued": job.total, "skipped": job.skipped}


@router.post("/tag-untagged")
async def ai_tag_untagged(req: TagUntaggedRequest):
    jm = get_ai_job_manager()
    job = await jm.enqueue_untagged(limit=req.limit, library_id=req.library_id)
    if job is None:
        return {"job_id": None, "queued": 0}
    return {"job_id": job.id, "queued": job.total}


@router.post("/clear-ai-tags")
async def ai_clear_all_ai_tags():
    """Remove AI-generated tags and AI metadata from ALL images.

    Keeps manual tags (manual: prefix).
    """
    images = acol("images")
    # Pipeline update so we can filter tags + recompute has_tags based on remaining manual tags.
    update_pipeline = [
        {
            "$set": {
                "tags": {
                    "$filter": {
                        "input": "$tags",
                        "as": "t",
                        "cond": {
                            "$regexMatch": {
                                "input": "$$t",
                                "regex": r"^manual:",
                            }
                        },
                    }
                }
            }
        },
        {
            "$set": {
                "has_ai_tags": False,
                "has_tags": {"$gt": [{"$size": "$tags"}, 0]},
                "rating": "-",
            }
        },
        {"$unset": "ai"},
    ]

    res = await images.update_many({}, update_pipeline)
    return {"matched": res.matched_count, "modified": res.modified_count}


@router.get("/jobs")
async def ai_list_jobs(limit: int = 20):
    jm = get_ai_job_manager()
    return [j.__dict__ for j in jm.list_jobs(limit=limit)]


@router.get("/jobs/{job_id}")
async def ai_get_job(job_id: str):
    jm = get_ai_job_manager()
    j = jm.get_job(job_id)
    if j is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return j.__dict__


@router.post("/jobs/{job_id}/cancel")
async def ai_cancel_job(job_id: str):
    jm = get_ai_job_manager()
    ok = await jm.cancel(job_id)
    return {
        "ok": ok,
        "job": (jm.get_job(job_id).__dict__ if jm.get_job(job_id) else None),
    }
