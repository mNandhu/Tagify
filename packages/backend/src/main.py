from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from .api import libraries, images, tags, ai, rules
from .database.motor import acol, ensure_indexes_async
from .core.config import settings
from .services.storage_fs import ensure_thumb_root
from .services.ai_jobs import get_ai_job_manager, get_ai_settings
from .services.ai_tagger import get_tagger_manager

import logging
import time
import anyio  # type: ignore[import-not-found]

logger = logging.getLogger("tagify")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Ensure required MongoDB indexes exist
    await ensure_indexes_async()
    # Ensure the thumbnail root dir exists (run off the event loop)
    await anyio.to_thread.run_sync(ensure_thumb_root)  # type: ignore[attr-defined]

    # Backfill fields introduced after initial releases.
    # This keeps filters like `no_ai_tags=1` working for older DBs.
    try:
        await acol("images").update_many(
            {"has_ai_tags": {"$exists": False}}, {"$set": {"has_ai_tags": False}}
        )
        # `has_prompt_tags` (third tag-kind axis) ships after `has_ai_tags`; seed
        # it false on older docs so browse/filters never hit a missing field.
        await acol("images").update_many(
            {"has_prompt_tags": {"$exists": False}},
            {"$set": {"has_prompt_tags": False}},
        )
    except Exception:
        logger.exception("Failed to backfill image tag-state flags during startup")

    # Start internal AI job worker
    jm = get_ai_job_manager()
    jm.start()
    try:
        s = await get_ai_settings()
        get_tagger_manager().set_idle_unload_s(int(s.get("idle_unload_s", 0) or 0))
    except Exception:
        # Best-effort; AI can still run with defaults, but log failures for operators.
        logger.exception("Failed to load AI settings during startup; continuing")

    yield

    # Shutdown: add cleanup if needed in the future


app = FastAPI(title="Tagify API", version="0.1.0", lifespan=lifespan)

# GZip compression for JSON responses
app.add_middleware(GZipMiddleware, minimum_size=1000)

# CORS: allow frontend dev server and Docker frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8080",
        "http://frontend",
        "http://frontend:80",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static thumbnails mount removed; thumbnails served via API from the FS (THUMB_ROOT)


_rl_state: dict[tuple[str, str], tuple[float, int]] = {}


@app.middleware("http")
async def _timing_and_rate_limit(request: Request, call_next):
    start = time.perf_counter()

    # Optional: per-process rate limiting for high-impact endpoints.
    if settings.rate_limit_enabled:
        path = request.url.path
        if (
            request.method.upper() == "POST"
            and path.endswith("/rescan")
            and path.startswith("/libraries/")
        ):
            ip = request.client.host if request.client else "unknown"
            key = (ip, "libraries:rescan")
            now = time.time()
            window_start, count = _rl_state.get(key, (now, 0))
            if now - window_start >= 60:
                window_start, count = now, 0
            count += 1
            _rl_state[key] = (window_start, count)

            limit = max(1, settings.rate_limit_rescan_per_minute)
            if count > limit:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded"},
                    headers={"Retry-After": "60"},
                )

    try:
        response = await call_next(request)
        return response
    finally:
        dur_ms = (time.perf_counter() - start) * 1000.0
        slow_ms = settings.log_slow_requests_ms
        if dur_ms >= slow_ms:
            # Keep logs lightweight; uvicorn already logs access lines.
            logger.warning(
                "slow request method=%s path=%s duration_ms=%.1f",
                request.method,
                request.url.path,
                dur_ms,
            )


@app.get("/health")
def health():
    return {"status": "ok"}


# Include routers (placeholders for now)
# TODO(nginx): group all API routes under a common `/api/v1` prefix so a reverse
# proxy can route media vs. JSON cleanly (e.g. a dedicated `location ~ ^/api/v1/
# images/.+/file$` for Range/originals, separate from the small-thumb traffic).
# Today routes mount at bare prefixes (/images, /tags, ...) and the Vite dev
# proxy strips `/api`; unifying on `/api/v1` removes that asymmetry. Coordinate
# the frontend base URL + Vite proxy when implementing. Deferred.
app.include_router(libraries.router, prefix="/libraries", tags=["libraries"])
app.include_router(images.router, prefix="/images", tags=["images"])
app.include_router(tags.router, prefix="/tags", tags=["tags"])
app.include_router(ai.router, prefix="/ai", tags=["ai"])
app.include_router(rules.router, prefix="/rules", tags=["rules"])
