from __future__ import annotations
import os
from pathlib import Path
from PIL import Image as PILImage
from ..database.mongo import col
from .thumbnails import generate_thumbnail
import hashlib
import mimetypes

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def is_image(path: Path) -> bool:
    if path.suffix.lower() in IMAGE_EXTS:
        return True
    mt, _ = mimetypes.guess_type(str(path))
    return mt is not None and mt.startswith("image/")


def file_hash(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def scan_library(library_id: str, root: str) -> int:
    root_path = Path(root)
    count = 0
    images_col = col("images")
    for dirpath, _, filenames in os.walk(root_path):
        for fname in filenames:
            p = Path(dirpath) / fname
            if not is_image(p):
                continue
            try:
                stat = p.stat()
                width = height = 0
                try:
                    with PILImage.open(p) as img:
                        width, height = img.size
                except Exception:
                    pass
                # relative path within library
                rel = str(p.relative_to(root_path))
                # generate thumbnail and store relative path for serving via /thumbs
                thumb_rel = generate_thumbnail(library_id, str(p), rel)
                doc = {
                    "_id": f"{library_id}:{rel}",
                    "library_id": library_id,
                    "path": str(p),
                    "size": stat.st_size,
                    "width": width,
                    "height": height,
                    "ctime": stat.st_ctime,
                    "mtime": stat.st_mtime,
                    "thumb_rel": thumb_rel,
                }
                images_col.update_one(
                    {"_id": doc["_id"]},
                    {"$set": doc, "$setOnInsert": {"tags": []}},
                    upsert=True,
                )
                count += 1
            except Exception:
                # continue on corrupt files
                continue
    return count
