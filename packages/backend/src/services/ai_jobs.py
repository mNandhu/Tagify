from __future__ import annotations

import asyncio
from collections import deque
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from ..database.motor import acol
from .ai_tagger import get_tagger_manager
from .storage_minio import get_original


DEFAULT_AI_SETTINGS: dict[str, Any] = {
    "model_repo": "SmilingWolf/wd-vit-tagger-v3",
    "general_thresh": 0.35,
    "character_thresh": 0.85,
    "general_mcut": False,
    "character_mcut": False,
    "max_general": 80,
    "max_character": 40,
    "idle_unload_s": 300,
    "cache_dir": ".cache/tagify/models",
}


async def get_ai_settings() -> dict[str, Any]:
    settings = acol("settings")
    doc = await settings.find_one({"_id": "ai"})
    if not doc:
        await settings.insert_one({"_id": "ai", **DEFAULT_AI_SETTINGS})
        return dict(DEFAULT_AI_SETTINGS)

    merged = dict(DEFAULT_AI_SETTINGS)
    for k, v in doc.items():
        if k == "_id":
            continue
        merged[k] = v
    return merged


async def update_ai_settings(patch: dict[str, Any]) -> dict[str, Any]:
    allowed = set(DEFAULT_AI_SETTINGS.keys())
    clean: dict[str, Any] = {k: v for k, v in patch.items() if k in allowed}

    if "idle_unload_s" in clean:
        try:
            clean["idle_unload_s"] = max(0, int(clean["idle_unload_s"]))
        except Exception:
            clean.pop("idle_unload_s", None)

    if "general_thresh" in clean:
        clean["general_thresh"] = float(clean["general_thresh"])
    if "character_thresh" in clean:
        clean["character_thresh"] = float(clean["character_thresh"])

    if "max_general" in clean:
        clean["max_general"] = max(0, int(clean["max_general"]))
    if "max_character" in clean:
        clean["max_character"] = max(0, int(clean["max_character"]))

    if "model_repo" in clean:
        clean["model_repo"] = str(clean["model_repo"]).strip()

    settings = acol("settings")

    # IMPORTANT: MongoDB rejects updates that try to modify the same field in
    # multiple operators (e.g. $set and $setOnInsert). Since DEFAULT_AI_SETTINGS
    # contains all fields, we must omit any keys present in $set from $setOnInsert.
    on_insert_defaults = {
        k: v for k, v in DEFAULT_AI_SETTINGS.items() if k not in clean
    }
    update_doc: dict[str, Any] = {"$setOnInsert": {"_id": "ai", **on_insert_defaults}}
    if clean:
        update_doc["$set"] = clean

    await settings.update_one({"_id": "ai"}, update_doc, upsert=True)

    # Apply runtime knobs immediately.
    if "idle_unload_s" in clean:
        get_tagger_manager().set_idle_unload_s(int(clean["idle_unload_s"]))

    return await get_ai_settings()


@dataclass
class AIJob:
    id: str
    created_at: float
    status: str = "queued"  # queued|running|cancelling|cancelled|done|error
    total: int = 0
    done: int = 0
    failed: int = 0
    skipped: int = 0
    current: str | None = None
    errors: list[dict[str, Any]] = field(default_factory=list)
    cancel_requested: bool = False


class _JobQueue:
    """A tiny cancellable async queue.

    asyncio.Queue doesn't support removing queued items (needed for cancel).
    """

    def __init__(self) -> None:
        self._dq: deque[AIJob] = deque()
        self._cv = asyncio.Condition()

    def qsize(self) -> int:
        return len(self._dq)

    async def put(self, job: AIJob) -> None:
        async with self._cv:
            self._dq.append(job)
            self._cv.notify(1)

    async def get(self) -> AIJob:
        async with self._cv:
            while not self._dq:
                await self._cv.wait()
            return self._dq.popleft()

    async def remove(self, job_id: str) -> bool:
        async with self._cv:
            for i, j in enumerate(self._dq):
                if j.id == job_id:
                    del self._dq[i]
                    return True
            return False


class AIJobManager:
    def __init__(self) -> None:
        self._queue = _JobQueue()
        self._jobs: dict[str, AIJob] = {}
        self._worker_task: asyncio.Task | None = None
        # Prevent queueing the same image many times across jobs.
        self._in_flight: set[str] = set()

    def start(self) -> None:
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._worker_loop())
            # Start idle unload loop (uses manager-configured timeout)
            asyncio.create_task(get_tagger_manager().idle_unload_loop())

    def queue_depth(self) -> int:
        return self._queue.qsize()

    def list_jobs(self, limit: int = 20) -> list[AIJob]:
        jobs = sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)
        return jobs[: max(1, int(limit))]

    def get_job(self, job_id: str) -> AIJob | None:
        return self._jobs.get(job_id)

    async def enqueue(self, *, ids: list[str], force: bool = False) -> AIJob:
        job_id = uuid.uuid4().hex

        # De-dupe within the job while preserving order.
        unique_ids = list(dict.fromkeys([i for i in ids if i]))

        # De-dupe across jobs (optional).
        skipped = 0
        if force:
            accepted = unique_ids
        else:
            accepted = []
            for image_id in unique_ids:
                if image_id in self._in_flight:
                    skipped += 1
                    continue
                accepted.append(image_id)

        job = AIJob(
            id=job_id, created_at=time.time(), total=len(accepted), skipped=skipped
        )
        self._jobs[job_id] = job

        # Store ids on the job object (private field via attribute)
        setattr(job, "_ids", list(accepted))
        # Track in-flight ids so we don't queue duplicates across jobs.
        for image_id in accepted:
            self._in_flight.add(image_id)

        if accepted:
            await self._queue.put(job)
        else:
            # Nothing to do; mark as done so UI doesn't show it as queued forever.
            job.status = "done"
        return job

    async def enqueue_untagged(
        self, *, limit: int = 200, library_id: str | None = None
    ) -> AIJob | None:
        q: dict[str, Any] = {"has_ai_tags": False}
        if library_id:
            q["library_id"] = library_id

        cur = acol("images").find(q, {"_id": 1}).sort("_id", -1).limit(int(limit))
        items = await cur.to_list(length=int(limit))
        ids = [it["_id"] for it in items]
        if not ids:
            return None
        return await self.enqueue(ids=ids)

    async def cancel(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        if not job:
            return False

        # If queued, remove from queue immediately.
        if job.status == "queued":
            removed = await self._queue.remove(job_id)
            job.status = "cancelled"
            # Release in-flight ids.
            ids: list[str] = getattr(job, "_ids", [])
            for image_id in ids:
                self._in_flight.discard(image_id)
            return removed

        # If running, request cancellation (best-effort).
        if job.status in ("running", "cancelling"):
            job.cancel_requested = True
            job.status = "cancelling"
            return True

        # done/error/cancelled -> can't cancel
        return False

    async def _worker_loop(self) -> None:
        while True:
            job = await self._queue.get()
            # Job might have been cancelled before worker picked it up.
            if job.status == "cancelled":
                continue

            job.status = "running"
            ids: list[str] = getattr(job, "_ids", [])
            try:
                settings = await get_ai_settings()
                # Keep runtime idle timeout in sync
                get_tagger_manager().set_idle_unload_s(
                    int(settings.get("idle_unload_s", 0) or 0)
                )

                for image_id in ids:
                    if job.cancel_requested:
                        job.status = "cancelled"
                        break
                    job.current = image_id
                    try:
                        await self._tag_one(image_id=image_id, settings=settings)
                        job.done += 1
                    except Exception as e:
                        job.failed += 1
                        job.errors.append({"image_id": image_id, "error": str(e)})

                if job.status != "cancelled":
                    job.status = "done" if job.failed == 0 else "error"
            finally:
                job.current = None
                # Release in-flight ids
                for image_id in ids:
                    self._in_flight.discard(image_id)

    async def _read_original_bytes(self, original_key: str) -> bytes:
        def _read() -> bytes:
            obj = get_original(original_key)
            try:
                return obj.read()
            finally:
                try:
                    obj.close()
                except Exception:
                    pass
                try:
                    obj.release_conn()
                except Exception:
                    pass

        return await asyncio.to_thread(_read)

    async def _tag_one(self, *, image_id: str, settings: dict[str, Any]) -> None:
        images = acol("images")
        doc = await images.find_one({"_id": image_id}, {"original_key": 1})
        if not doc:
            raise RuntimeError("image not found")
        key = doc.get("original_key")
        if not key:
            raise RuntimeError("image has no original_key")

        img_bytes = await self._read_original_bytes(str(key))

        model_repo = str(
            settings.get("model_repo") or DEFAULT_AI_SETTINGS["model_repo"]
        )
        cache_dir = str(settings.get("cache_dir") or DEFAULT_AI_SETTINGS["cache_dir"])

        result = await get_tagger_manager().predict_bytes(
            image_bytes=img_bytes,
            model_repo=model_repo,
            cache_dir=cache_dir,
            general_thresh=float(settings.get("general_thresh", 0.35)),
            character_thresh=float(settings.get("character_thresh", 0.85)),
            general_mcut=bool(settings.get("general_mcut", False)),
            character_mcut=bool(settings.get("character_mcut", False)),
            max_general=int(settings.get("max_general", 80)),
            max_character=int(settings.get("max_character", 40)),
        )

        general_tags = [t for (t, _p) in (result.get("general_tags") or [])]
        character_tags = [t for (t, _p) in (result.get("character_tags") or [])]
        ai_tags = list(dict.fromkeys([*general_tags, *character_tags]))

        # Pick rating with highest probability.
        rating_map = result.get("rating") or {}
        rating_label = "-"
        if isinstance(rating_map, dict) and rating_map:
            try:
                rating_label = max(
                    rating_map.items(), key=lambda kv: float(kv[1] or 0.0)
                )[0]
            except Exception:
                rating_label = "-"

        # Persist AI meta + merge tags (AI tags are primary, unprefixed)
        update: dict[str, Any] = {
            "$set": {
                "ai": {
                    "model_repo": model_repo,
                    "caption": result.get("caption") or "",
                    "rating": result.get("rating") or {},
                    "general_tags": result.get("general_tags") or [],
                    "character_tags": result.get("character_tags") or [],
                    "general_thresh": float(settings.get("general_thresh", 0.35)),
                    "character_thresh": float(settings.get("character_thresh", 0.85)),
                    "updated_at": time.time(),
                },
                "rating": str(rating_label),
                "has_ai_tags": bool(ai_tags),
                "has_tags": True if ai_tags else None,
            }
        }
        # Avoid writing has_tags=None; build $set cleanly
        if update["$set"]["has_tags"] is None:
            del update["$set"]["has_tags"]

        if ai_tags:
            update["$addToSet"] = {"tags": {"$each": ai_tags}}
            update["$set"]["has_tags"] = True

        await images.update_one({"_id": image_id}, update)


_ai_job_manager: AIJobManager | None = None


def get_ai_job_manager() -> AIJobManager:
    global _ai_job_manager
    if _ai_job_manager is None:
        _ai_job_manager = AIJobManager()
    return _ai_job_manager
