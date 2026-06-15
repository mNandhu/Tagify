import uuid

from fastapi import APIRouter, HTTPException
import anyio  # type: ignore[import-not-found]

import sqlalchemy as sa

from ..database.db import async_conn, async_tx
from ..database import schema as t
from ..models.library import LibraryIn, LibraryUpdate
from ..services.scanner import cancel_scan, scan_library_async

from ..services.storage_fs import delete_by_prefix

router = APIRouter()

# Columns the list/summary views expose (kept minimal).
_LIB_LIST_COLS = (
    t.libraries.c._id,
    t.libraries.c.path,
    t.libraries.c.name,
    t.libraries.c.indexed_count,
    t.libraries.c.last_scanned,
    t.libraries.c.scanning,
    t.libraries.c.scan_total,
    t.libraries.c.scan_done,
    t.libraries.c.scan_error,
    t.libraries.c.scan_failed_count,
)


@router.get("")
async def list_libraries():
    async with async_conn() as conn:
        rows = (await conn.execute(sa.select(*_LIB_LIST_COLS))).fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("")
async def add_library(body: LibraryIn):
    async with async_tx() as conn:
        existing = (
            await conn.execute(
                sa.select(t.libraries).where(t.libraries.c.path == body.path)
            )
        ).first()
        if existing:
            return dict(existing._mapping)
        lib_id = uuid.uuid4().hex
        await conn.execute(
            sa.insert(t.libraries).values(
                _id=lib_id,
                path=body.path,
                name=body.name or body.path,
                indexed_count=0,
                last_scanned=None,
            )
        )
    # trigger initial scan in background
    scan_library_async(lib_id, body.path)
    return {"_id": lib_id, "path": body.path, "name": body.name or body.path}


@router.delete("/{library_id}")
async def remove_library(library_id: str):
    # Cancel an in-flight scan first to avoid the scan recreating rows/files after deletion.
    cancel_scan(library_id)

    async with async_tx() as conn:
        await conn.execute(
            sa.delete(t.libraries).where(t.libraries.c._id == library_id)
        )
        # image_tags / image_gen_terms cascade via FK when images are deleted.
        await conn.execute(
            sa.delete(t.images).where(t.images.c.library_id == library_id)
        )
        await conn.execute(
            sa.delete(t.image_gen_raw).where(
                t.image_gen_raw.c.library_id == library_id
            )
        )
    # remove thumbnail files for this library
    try:
        await anyio.to_thread.run_sync(lambda: delete_by_prefix(f"{library_id}/"))  # type: ignore[attr-defined]
    except Exception:
        # ignore failures to remove files
        pass
    return {"removed": library_id}


@router.post("/{library_id}/rescan")
async def rescan_library(library_id: str):
    async with async_conn() as conn:
        path = (
            await conn.execute(
                sa.select(t.libraries.c.path).where(t.libraries.c._id == library_id)
            )
        ).scalar()
    if path is None:
        raise HTTPException(status_code=404, detail="Library not found")
    scan_library_async(library_id, path)
    return {"rescan": library_id, "started": True}


@router.post("/{library_id}/reproject")
async def reproject_library_endpoint(library_id: str):
    """Re-derive structured gen.* for a library from stored raw (no disk rescan)."""
    async with async_conn() as conn:
        found = (
            await conn.execute(
                sa.select(t.libraries.c._id).where(t.libraries.c._id == library_id)
            )
        ).scalar()
    if found is None:
        raise HTTPException(status_code=404, detail="Library not found")
    from ..services.reproject import reproject_library_async

    reproject_library_async(library_id)
    return {"reproject": library_id, "started": True}


@router.get("/{library_id}/progress")
async def library_progress(library_id: str):
    async with async_conn() as conn:
        lib = (
            await conn.execute(
                sa.select(t.libraries).where(t.libraries.c._id == library_id)
            )
        ).first()
    if lib is None:
        raise HTTPException(status_code=404, detail="Library not found")
    m = lib._mapping
    return {
        "scanning": bool(m.get("scanning", False)),
        "scan_total": m.get("scan_total", 0),
        "scan_done": m.get("scan_done", 0),
        "indexed_count": m.get("indexed_count", 0),
        "last_scanned": m.get("last_scanned"),
        "scan_error": m.get("scan_error"),
        "scan_failed_count": m.get("scan_failed_count", 0),
    }


@router.patch("/{library_id}")
async def update_library(library_id: str, body: LibraryUpdate):
    update_doc = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not update_doc:
        raise HTTPException(status_code=400, detail="No fields to update")
    async with async_tx() as conn:
        old = (
            await conn.execute(
                sa.select(t.libraries).where(t.libraries.c._id == library_id)
            )
        ).first()
        if old is None:
            raise HTTPException(status_code=404, detail="Library not found")
        await conn.execute(
            sa.update(t.libraries)
            .where(t.libraries.c._id == library_id)
            .values(**update_doc)
        )
        doc = (
            await conn.execute(
                sa.select(t.libraries).where(t.libraries.c._id == library_id)
            )
        ).first()
    result = dict(doc._mapping) if doc else None
    if "path" in update_doc and update_doc["path"] != old._mapping.get("path"):
        scan_library_async(library_id, update_doc["path"])
    return result
