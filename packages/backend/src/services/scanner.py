from __future__ import annotations
import os
from pathlib import Path
from io import BytesIO
from PIL import Image as PILImage
from ..database.mongo import col
from .storage_minio import put_thumb, put_original
import hashlib
import mimetypes
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime
from multiprocessing import cpu_count
from threading import Lock
import time

from pymongo import UpdateOne
from pymongo.errors import AutoReconnect, NetworkTimeout, PyMongoError
from ..core import config

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def _make_thumb_bytes(path: Path) -> bytes | None:
    try:
        with PILImage.open(path) as img:
            # Resize in-place while preserving aspect ratio. Longest edge = config.THUMB_MAX_SIZE
            size = max(
                16,
                int(config.THUMB_MAX_SIZE)
                if getattr(config, "THUMB_MAX_SIZE", 0)
                else 512,
            )
            img.thumbnail((size, size))
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


def _retry(
    fn,
    *,
    attempts: int = 3,
    base_delay_s: float = 0.2,
    retry_exceptions: tuple[type[BaseException], ...] = (Exception,),
):
    last: BaseException | None = None
    for i in range(max(1, int(attempts))):
        try:
            return fn()
        except retry_exceptions as e:  # type: ignore[misc]
            last = e
            if i >= attempts - 1:
                break
            # Exponential backoff with a small cap
            delay = min(2.0, base_delay_s * (2**i))
            time.sleep(delay)
    assert last is not None
    raise last


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
                    {"$set": doc, "$setOnInsert": {"tags": [], "has_tags": False}},
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
_cancel_scans: set[str] = set()
_scan_threads: dict[str, "threading.Thread"] = {}


@dataclass
class _ScanResult:
    image_id: str
    ok: bool
    doc: dict | None = None
    error: str | None = None
    stage: str | None = None


def _process_image(library_id: str, root_path: Path, p: Path) -> _ScanResult:
    """Process a single image file.

    This function performs file inspection + MinIO uploads only.
    Mongo writes are performed in batches by the scan coordinator thread.
    """
    try:
        stat = p.stat()
        width = height = 0
        try:
            with PILImage.open(p) as img:
                width, height = img.size
        except Exception:
            pass
        rel = str(p.relative_to(root_path))
        image_id = f"{library_id}:{rel}"
        # Generate a thumbnail in-memory for MinIO
        thumb_bytes: bytes | None = _make_thumb_bytes(p)

        # Upload original (required)
        mt, _ = mimetypes.guess_type(str(p))

        def _upload_original():
            with open(p, "rb") as f:
                return put_original(library_id, image_id, f, stat.st_size, mt)

        try:
            original_key = _retry(
                _upload_original,
                attempts=3,
                base_delay_s=0.2,
            )
        except Exception as e:
            return _ScanResult(
                image_id=image_id,
                ok=False,
                error=str(e),
                stage="upload_original",
            )

        # Upload thumbnail if generated (optional)
        thumb_key = None
        if thumb_bytes is not None:

            def _upload_thumb():
                return put_thumb(library_id, image_id, thumb_bytes)

            try:
                thumb_key = _retry(
                    _upload_thumb,
                    attempts=3,
                    base_delay_s=0.2,
                )
            except Exception:
                # Best-effort: keep original indexed even if thumb failed.
                thumb_key = None

        doc = {
            "_id": image_id,
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
        return _ScanResult(image_id=image_id, ok=True, doc=doc)
    except Exception as e:
        # Includes stat/path errors
        return _ScanResult(
            image_id=f"{library_id}:<unknown>",
            ok=False,
            error=str(e),
            stage="process",
        )


def scan_library_async(library_id: str, root: str) -> dict:
    """Kick off a background multithreaded scan with progress. Returns status."""
    root_path = Path(root)
    libraries = col("libraries")
    with _scan_lock:
        if library_id in _current_scans:
            return {"started": False, "status": "already_running"}
        _current_scans.add(library_id)
        _cancel_scans.discard(library_id)

    # Initialize progress fields
    libraries.update_one(
        {"_id": ObjectId_or_str(library_id)},
        {
            "$set": {
                "scanning": True,
                "scan_total": 0,
                "scan_done": 0,
                "scan_error": None,
                "scan_failed_count": 0,
                "scan_failed_samples": [],
            }
        },
    )

    def _run():
        nonlocal library_id
        total = 0
        processed = 0
        indexed = 0
        failed = 0
        failed_samples: list[dict] = []
        discovered_image_ids: set[str] = set()
        try:
            with _scan_lock:
                if library_id in _cancel_scans:
                    raise RuntimeError("cancelled")

            # Discover image files
            files: list[Path] = []
            for dirpath, _, filenames in os.walk(root_path):
                for fname in filenames:
                    p = Path(dirpath) / fname
                    if is_image(p):
                        files.append(p)
                        try:
                            rel = str(p.relative_to(root_path))
                            discovered_image_ids.add(f"{library_id}:{rel}")
                        except Exception:
                            # Best-effort; path math can fail on unusual inputs
                            pass
            total = len(files)
            libraries.update_one(
                {"_id": ObjectId_or_str(library_id)},
                {"$set": {"scan_total": total, "scan_done": 0}},
            )

            with _scan_lock:
                if library_id in _cancel_scans:
                    raise RuntimeError("cancelled")

            # Multithreaded processing (cap via config if provided)
            # Scanning is I/O + CPU heavy and competes with API traffic and Mongo/MinIO pools,
            # so keep auto-concurrency conservative.
            default_workers = max(2, min(16, (cpu_count() or 4)))
            cap = config.SCANNER_MAX_WORKERS
            workers = (
                default_workers if not cap or cap <= 0 else min(default_workers, cap)
            )
            progress_interval_s = max(
                0.1,
                float(getattr(config, "SCAN_PROGRESS_UPDATE_MS", 500) or 500) / 1000.0,
            )
            last_progress_write = time.monotonic()
            mongo_ops: list[UpdateOne] = []
            batch_size = 200

            def _flush_ops():
                nonlocal indexed
                if not mongo_ops:
                    return

                ops = list(mongo_ops)
                mongo_ops.clear()

                def _do_bulk():
                    return col("images").bulk_write(ops, ordered=False)

                _retry(
                    _do_bulk,
                    attempts=3,
                    base_delay_s=0.2,
                    retry_exceptions=(AutoReconnect, NetworkTimeout, PyMongoError),
                )
                indexed += len(ops)

            with ThreadPoolExecutor(max_workers=workers) as ex:
                # Avoid submitting all tasks at once (can balloon memory on huge libraries).
                max_pending = max(1, workers * 2)
                it = iter(files)
                pending: set = set()

                # Prime the queue.
                while len(pending) < max_pending:
                    try:
                        p = next(it)
                    except StopIteration:
                        break
                    pending.add(ex.submit(_process_image, library_id, root_path, p))

                while pending:
                    with _scan_lock:
                        if library_id in _cancel_scans:
                            # Cancel futures that haven't started yet.
                            for fut in list(pending):
                                fut.cancel()
                            pending.clear()
                            break

                    done_set, pending = wait(pending, return_when=FIRST_COMPLETED)
                    for fut in done_set:
                        try:
                            res = fut.result()
                            if isinstance(res, _ScanResult) and res.ok and res.doc:
                                mongo_ops.append(
                                    UpdateOne(
                                        {"_id": res.doc["_id"]},
                                        {
                                            "$set": res.doc,
                                            "$setOnInsert": {
                                                "tags": [],
                                                "has_tags": False,
                                            },
                                        },
                                        upsert=True,
                                    )
                                )

                                # Flush periodically to keep memory bounded
                                if len(mongo_ops) >= batch_size:
                                    _flush_ops()
                            else:
                                failed += 1
                                if (
                                    isinstance(res, _ScanResult)
                                    and len(failed_samples) < 20
                                ):
                                    failed_samples.append(
                                        {
                                            "image_id": res.image_id,
                                            "stage": res.stage,
                                            "error": res.error,
                                        }
                                    )
                        except Exception:
                            failed += 1
                        processed += 1

                        # Time-based progress persistence: smooth UI without spamming DB.
                        now = time.monotonic()
                        if (now - last_progress_write) >= progress_interval_s:
                            last_progress_write = now
                            libraries.update_one(
                                {"_id": ObjectId_or_str(library_id)},
                                {
                                    "$set": {
                                        "scan_done": processed,
                                        "scan_failed_count": failed,
                                        "scan_failed_samples": failed_samples,
                                    }
                                },
                            )

                    # Refill the queue.
                    while len(pending) < max_pending:
                        with _scan_lock:
                            if library_id in _cancel_scans:
                                break
                        try:
                            p = next(it)
                        except StopIteration:
                            break
                        pending.add(ex.submit(_process_image, library_id, root_path, p))

            with _scan_lock:
                if library_id in _cancel_scans:
                    raise RuntimeError("cancelled")

            # Flush remaining ops
            _flush_ops()

            # Clean up stale images (images that exist in DB but weren't discovered in current scan)
            images_col = col("images")
            existing_docs = list(
                images_col.find(
                    {"library_id": library_id},
                    {"_id": 1, "original_key": 1, "thumb_key": 1},
                )
            )

            stale_image_ids = []
            stale_minio_keys = []

            for doc in existing_docs:
                existing_id = doc["_id"]
                if existing_id not in discovered_image_ids:
                    stale_image_ids.append(existing_id)
                    # Collect MinIO keys for cleanup
                    if doc.get("original_key"):
                        stale_minio_keys.append(doc["original_key"])
                    if doc.get("thumb_key"):
                        stale_minio_keys.append(doc["thumb_key"])

            # Remove stale images from MongoDB
            if stale_image_ids:
                images_col.delete_many({"_id": {"$in": stale_image_ids}})

                # Clean up corresponding MinIO objects
                # Group keys by prefix to optimize deletion
                if stale_minio_keys:
                    try:
                        # For efficiency, we could delete by prefix for each stale image
                        # but since we have the exact keys, let's delete them individually
                        from minio.deleteobjects import DeleteObject
                        from .storage_minio import get_minio

                        client = get_minio()

                        # Separate keys by bucket type (original vs thumb)
                        original_keys = [
                            k for k in stale_minio_keys if not k.endswith(".jpg")
                        ]
                        thumb_keys = [k for k in stale_minio_keys if k.endswith(".jpg")]

                        # Delete from originals bucket
                        if original_keys:
                            delete_list = [DeleteObject(key) for key in original_keys]
                            for err in client.remove_objects(
                                config.MINIO_BUCKET_ORIGINALS, delete_list
                            ):
                                # Best effort cleanup, ignore errors
                                _ = err

                        # Delete from thumbs bucket
                        if thumb_keys:
                            delete_list = [DeleteObject(key) for key in thumb_keys]
                            for err in client.remove_objects(
                                config.MINIO_BUCKET_THUMBS, delete_list
                            ):
                                # Best effort cleanup, ignore errors
                                _ = err

                    except Exception:
                        # Best effort cleanup - don't fail the scan if MinIO cleanup fails
                        pass

            # Finalize
            libraries.update_one(
                {"_id": ObjectId_or_str(library_id)},
                {
                    "$set": {
                        "scanning": False,
                        "scan_done": processed,
                        "indexed_count": indexed,
                        "last_scanned": datetime.utcnow(),
                        "scan_failed_count": failed,
                        "scan_failed_samples": failed_samples,
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
                _cancel_scans.discard(library_id)
                _scan_threads.pop(library_id, None)

    # Start background thread
    import threading

    t = threading.Thread(target=_run, name=f"scan-{library_id}", daemon=True)
    with _scan_lock:
        _scan_threads[library_id] = t
    t.start()
    return {"started": True}


def cancel_scan(library_id: str, *, join_timeout_s: float = 0.5) -> bool:
    """Request cancellation of a running scan.

    Returns True if a scan was running (cancellation requested), False otherwise.
    """
    import threading

    t: threading.Thread | None = None
    with _scan_lock:
        running = library_id in _current_scans
        if not running:
            return False
        _cancel_scans.add(library_id)
        t = _scan_threads.get(library_id)

    # Best-effort: give the scan thread a moment to notice cancellation.
    if t is not None and t.is_alive():
        t.join(timeout=max(0.0, float(join_timeout_s)))
    return True


def ObjectId_or_str(id_str: str):
    """Helper to use ObjectId if valid, else assume stored as string."""
    try:
        from bson.objectid import ObjectId

        return ObjectId(id_str)
    except Exception:
        return id_str
