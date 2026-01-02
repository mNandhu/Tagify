from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from .api import libraries, images, tags
from .database.motor import ensure_indexes_async
from .core import config
from .services.storage_minio import ensure_buckets

import logging
import time
import anyio

app = FastAPI(title="Tagify API", version="0.1.0")

logger = logging.getLogger("tagify")

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

# Static thumbnails mount removed; images served via API backed by MinIO


@app.on_event("startup")
async def _on_startup():
    # Ensure required MongoDB indexes exist
    await ensure_indexes_async()
    # Ensure MinIO buckets exist (run off the event loop)
    await anyio.to_thread.run_sync(ensure_buckets)


_rl_state: dict[tuple[str, str], tuple[float, int]] = {}


@app.middleware("http")
async def _timing_and_rate_limit(request: Request, call_next):
    start = time.perf_counter()

    # Optional: per-process rate limiting for high-impact endpoints.
    if config.RATE_LIMIT_ENABLED:
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

            limit = max(1, int(getattr(config, "RATE_LIMIT_RESCAN_PER_MINUTE", 1)))
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
        slow_ms = int(getattr(config, "LOG_SLOW_REQUESTS_MS", 1000) or 1000)
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
app.include_router(libraries.router, prefix="/libraries", tags=["libraries"])
app.include_router(images.router, prefix="/images", tags=["images"])
app.include_router(tags.router, prefix="/tags", tags=["tags"])
