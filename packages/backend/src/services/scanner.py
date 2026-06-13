from __future__ import annotations
import os
from pathlib import Path
from io import BytesIO
from PIL import Image as PILImage
from ..database.mongo import col
from . import image_tags
from .storage_minio import put_thumb
from .blurhash import blurhash_for_image
import hashlib
import mimetypes
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime
from multiprocessing import cpu_count
import threading
from threading import Lock
import time

from pymongo import UpdateOne
from pymongo.errors import AutoReconnect, NetworkTimeout, PyMongoError
from ..core.config import settings

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def _make_thumb_bytes(
    path: Path,
) -> tuple[bytes | None, str | None, int, int]:
    """Render thumbnail bytes, a BlurHash placeholder, and original dimensions
    from a single image open.

    Returns ``(thumb_bytes, blurhash, width, height)``; thumb/blurhash may be
    None on failure, dimensions 0 if the header couldn't be read.
    """
    try:
        with PILImage.open(path) as img:
            # Original dimensions come from the header (no full decode) — read
            # them before draft()/thumbnail() shrink the in-memory image.
            width, height = img.size

            size = max(16, settings.thumb_max_size)
            # draft() lets the JPEG decoder emit a pre-shrunk image (1/2, 1/4,
            # 1/8 scale), so large sources decode several times faster. No-op
            # for non-JPEG formats.
            img.draft("RGB", (size, size))
            img.thumbnail((size, size))

            buf = BytesIO()
            fmt = settings.thumb_format.upper()
            if fmt == "WEBP":
                img.save(buf, format="WEBP", quality=85)
            else:
                img.convert("RGB").save(buf, format=fmt, quality=85)

            # BlurHash from the already-downsampled thumbnail (it shrinks to
            # ~64px internally, so the result is identical to encoding the
            # full-res image but far cheaper).
            bh = blurhash_for_image(img)
            return buf.getvalue(), bh, int(width), int(height)
    except Exception:
        return None, None, 0, 0


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


def image_id_for(library_id: str, root_path: Path, p: Path) -> str:
    """Stable image id: ``{library_id}:{path-relative-to-library-root}``."""
    return f"{library_id}:{p.relative_to(root_path)}"


def upsert_image_op(doc: dict) -> UpdateOne:
    """Upsert that refreshes file metadata but seeds tag-state only on insert."""
    return UpdateOne(
        {"_id": doc["_id"]},
        {"$set": doc, "$setOnInsert": image_tags.initial_tag_fields()},
        upsert=True,
    )


def reconcile_stale(
    discovered_ids: set[str], existing_docs: list[dict]
) -> tuple[list[str], list[str]]:
    """Given the ids seen this scan and the docs already in the DB, return
    ``(stale_image_ids, stale_thumb_keys)`` — images that no longer exist on disk.

    Pure set math, extracted from the scan loop because it *deletes* images and so
    is the highest-risk part to get wrong.
    """
    stale_ids: list[str] = []
    stale_thumb_keys: list[str] = []
    for doc in existing_docs:
        if doc["_id"] not in discovered_ids:
            stale_ids.append(doc["_id"])
            if doc.get("thumb_key"):
                stale_thumb_keys.append(doc["thumb_key"])
    return stale_ids, stale_thumb_keys


# --- Async scanning with progress tracking ---
_scan_lock = Lock()
_current_scans: set[str] = set()
_cancel_scans: set[str] = set()
_scan_threads: dict[str, threading.Thread] = {}


@dataclass
class _ScanResult:
    image_id: str
    ok: bool
    doc: dict | None = None
    error: str | None = None
    stage: str | None = None


def _process_image(library_id: str, root_path: Path, p: Path) -> _ScanResult:
    """Process a single image file.

    This function performs file inspection + thumbnail upload to MinIO.
    Mongo writes are performed in batches by the scan coordinator thread.
    Originals are served directly from the filesystem (Local Mount mode).
    """
    try:
        stat = p.stat()
        image_id = image_id_for(library_id, root_path, p)
        # Single decode yields the thumbnail, BlurHash placeholder, and the
        # original dimensions (read from the header before downscaling).
        thumb_bytes, blurhash, width, height = _make_thumb_bytes(p)

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
                # Best-effort: keep image indexed even if thumb failed.
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
            "thumb_key": thumb_key,
            "blurhash": blurhash,
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
                            discovered_image_ids.add(
                                image_id_for(library_id, root_path, p)
                            )
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
            cap = settings.scanner_max_workers
            workers = (
                default_workers if not cap or cap <= 0 else min(default_workers, cap)
            )
            progress_interval_s = max(
                0.1,
                settings.scan_progress_update_ms / 1000.0,
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
                                mongo_ops.append(upsert_image_op(res.doc))

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
                    {"_id": 1, "thumb_key": 1},
                )
            )

            stale_image_ids, stale_thumb_keys = reconcile_stale(
                discovered_image_ids, existing_docs
            )

            # Remove stale images from MongoDB
            if stale_image_ids:
                images_col.delete_many({"_id": {"$in": stale_image_ids}})

                # Clean up corresponding MinIO thumbnail objects
                if stale_thumb_keys:
                    try:
                        from minio.deleteobjects import DeleteObject
                        from .storage_minio import get_minio

                        client = get_minio()
                        delete_list = [DeleteObject(key) for key in stale_thumb_keys]
                        for err in client.remove_objects(
                            settings.minio_bucket_thumbs, delete_list
                        ):
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
    t = threading.Thread(target=_run, name=f"scan-{library_id}", daemon=True)
    with _scan_lock:
        _scan_threads[library_id] = t
    t.start()
    return {"started": True}


def cancel_scan(library_id: str, *, join_timeout_s: float = 0.5) -> bool:
    """Request cancellation of a running scan.

    Returns True if a scan was running (cancellation requested), False otherwise.
    """
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
