from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .api import libraries, images, tags
from .core import config

app = FastAPI(title="Tagify API", version="0.1.0")

# CORS: allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve thumbnails statically
app.mount("/thumbs", StaticFiles(directory=str(config.THUMBS_DIR)), name="thumbs")


@app.get("/health")
def health():
    return {"status": "ok"}


# Include routers (placeholders for now)
app.include_router(libraries.router, prefix="/libraries", tags=["libraries"])
app.include_router(images.router, prefix="/images", tags=["images"])
app.include_router(tags.router, prefix="/tags", tags=["tags"])
