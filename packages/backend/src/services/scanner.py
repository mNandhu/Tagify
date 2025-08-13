from __future__ import annotations
import os
from pathlib import Path
from io import BytesIO
from PIL import Image as PILImage
from ..database.mongo import col
from .storage_minio import put_thumb, put_original
import hashlib
import mimetypes
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from multiprocessing import cpu_count
from threading import Lock
from ..core import config

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def _make_thumb_bytes(path: Path) -> bytes | None:
    try:
        with PILImage.open(path) as img:
            img.thumbnail((512, 512))
            buf = BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=85)
            return buf.getvalue()
    except Exception:
        return None


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
                # Upload to MinIO
                thumb_bytes = _make_thumb_bytes(p)
                original_key = None
                thumb_key = None
                try:
                    mt, _ = mimetypes.guess_type(str(p))
                    with open(p, "rb") as f:
                        original_key = put_original(
                            library_id, f"{library_id}:{rel}", f, stat.st_size, mt
                        )
                except Exception:
                    original_key = None
                if thumb_bytes is not None:
                    try:
                        thumb_key = put_thumb(
                            library_id, f"{library_id}:{rel}", thumb_bytes
                        )
                    except Exception:
                        thumb_key = None
                doc = {
                    "_id": f"{library_id}:{rel}",
                    "library_id": library_id,
                    "path": str(p),
                    "size": stat.st_size,
                    "width": width,
                    "height": height,
                    "ctime": stat.st_ctime,
                    "mtime": stat.st_mtime,
                    "original_key": original_key,
                    "thumb_key": thumb_key,
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


# --- Async scanning with progress tracking ---
_scan_lock = Lock()
_current_scans: set[str] = set()


def _process_image(library_id: str, root_path: Path, p: Path) -> bool:
    """Process a single image file. Returns True if indexed, False otherwise."""
    try:
        stat = p.stat()
        width = height = 0
        try:
            with PILImage.open(p) as img:
                width, height = img.size
        except Exception:
            pass
        rel = str(p.relative_to(root_path))
        # Generate a thumbnail in-memory for MinIO
        thumb_bytes: bytes | None = _make_thumb_bytes(p)

        original_key = None
        thumb_key = None
        # Upload original
        try:
            mt, _ = mimetypes.guess_type(str(p))
            with open(p, "rb") as f:
                original_key = put_original(
                    library_id, f"{library_id}:{rel}", f, stat.st_size, mt
                )
        except Exception:
            original_key = None
        # Upload thumbnail if generated
        if thumb_bytes is not None:
            try:
                thumb_key = put_thumb(library_id, f"{library_id}:{rel}", thumb_bytes)
            except Exception:
                thumb_key = None

        doc = {
            "_id": f"{library_id}:{rel}",
            "library_id": library_id,
            "path": str(p),
            "size": stat.st_size,
            "width": width,
            "height": height,
            "ctime": stat.st_ctime,
            "mtime": stat.st_mtime,
            "original_key": original_key,
            "thumb_key": thumb_key,
        }
        col("images").update_one(
            {"_id": doc["_id"]},
            {"$set": doc, "$setOnInsert": {"tags": []}},
            upsert=True,
        )
        return True
    except Exception:
        return False


def scan_library_async(library_id: str, root: str) -> dict:
    """Kick off a background multithreaded scan with progress. Returns status."""
    root_path = Path(root)
    libraries = col("libraries")
    with _scan_lock:
        if library_id in _current_scans:
            return {"started": False, "status": "already_running"}
        _current_scans.add(library_id)

    # Initialize progress fields
    libraries.update_one(
        {"_id": ObjectId_or_str(library_id)},
        {
            "$set": {
                "scanning": True,
                "scan_total": 0,
                "scan_done": 0,
                "scan_error": None,
            }
        },
    )

    def _run():
        nonlocal library_id
        total = 0
        done = 0
        try:
            # Discover image files
            files: list[Path] = []
            for dirpath, _, filenames in os.walk(root_path):
                for fname in filenames:
                    p = Path(dirpath) / fname
                    if is_image(p):
                        files.append(p)
            total = len(files)
            libraries.update_one(
                {"_id": ObjectId_or_str(library_id)},
                {"$set": {"scan_total": total, "scan_done": 0}},
            )

            # Multithreaded processing (cap via config if provided)
            default_workers = max(2, min(32, (cpu_count() or 4) * 2))
            cap = config.SCANNER_MAX_WORKERS
            workers = (
                default_workers if not cap or cap <= 0 else min(default_workers, cap)
            )
            batch = 0
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futures = [
                    ex.submit(_process_image, library_id, root_path, p) for p in files
                ]
                for fut in as_completed(futures):
                    try:
                        ok = fut.result()
                        if ok:
                            done += 1
                    except Exception:
                        pass
                    batch += 1
                    if batch >= 25:
                        batch = 0
                        libraries.update_one(
                            {"_id": ObjectId_or_str(library_id)},
                            {"$set": {"scan_done": done}},
                        )

            # Finalize
            libraries.update_one(
                {"_id": ObjectId_or_str(library_id)},
                {
                    "$set": {
                        "scanning": False,
                        "scan_done": done,
                        "indexed_count": done,
                        "last_scanned": datetime.utcnow(),
                    }
                },
            )
        except Exception as e:
            libraries.update_one(
                {"_id": ObjectId_or_str(library_id)},
                {"$set": {"scanning": False, "scan_error": str(e)}},
            )
        finally:
            with _scan_lock:
                _current_scans.discard(library_id)

    # Start background thread
    import threading

    t = threading.Thread(target=_run, name=f"scan-{library_id}", daemon=True)
    t.start()
    return {"started": True}


def ObjectId_or_str(id_str: str):
    """Helper to use ObjectId if valid, else assume stored as string."""
    try:
        from bson.objectid import ObjectId

        return ObjectId(id_str)
    except Exception:
        return id_str
