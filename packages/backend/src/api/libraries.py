from fastapi import APIRouter, HTTPException
import anyio


from ..database.motor import acol
from ..models.library import LibraryIn, LibraryUpdate
from ..services.scanner import cancel_scan, scan_library_async

from ._utils import parse_object_id

from ..services.storage_minio import delete_by_prefix

router = APIRouter()


@router.get("")
async def list_libraries():
    libraries = (
        await acol("libraries")
        .find(
            {},
            {
                "path": 1,
                "name": 1,
                "indexed_count": 1,
                "last_scanned": 1,
                "scanning": 1,
                "scan_total": 1,
                "scan_done": 1,
                "scan_error": 1,
                "scan_failed_count": 1,
            },
        )
        .to_list(length=10000)
    )
    for lib in libraries:
        lib["_id"] = str(lib["_id"])  # stringify ObjectId
    return libraries


@router.post("")
async def add_library(body: LibraryIn):
    libraries = acol("libraries")
    existing = await libraries.find_one({"path": body.path})
    if existing:
        existing["_id"] = str(existing["_id"])
        return existing
    res = await libraries.insert_one(
        {
            "path": body.path,
            "name": body.name or body.path,
            "indexed_count": 0,
            "last_scanned": None,
        }
    )
    lib_id = str(res.inserted_id)
    # trigger initial scan in background
    scan_library_async(lib_id, body.path)
    return {"_id": lib_id, "path": body.path, "name": body.name or body.path}


@router.delete("/{library_id}")
async def remove_library(library_id: str):
    # Cancel an in-flight scan first to avoid the scan recreating docs/objects after deletion.
    cancel_scan(library_id)

    oid = parse_object_id(library_id)
    libraries = acol("libraries")
    images = acol("images")
    await libraries.delete_one({"_id": oid})
    await images.delete_many({"library_id": library_id})
    # remove MinIO objects for this library
    try:
        await anyio.to_thread.run_sync(delete_by_prefix, f"{library_id}/")
    except Exception:
        # ignore failures to remove objects
        pass
    return {"removed": library_id}


@router.post("/{library_id}/rescan")
async def rescan_library(library_id: str):
    oid = parse_object_id(library_id)
    libraries = acol("libraries")
    lib = await libraries.find_one({"_id": oid})
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")
    scan_library_async(library_id, lib["path"])
    return {"rescan": library_id, "started": True}


@router.get("/{library_id}/progress")
async def library_progress(library_id: str):
    oid = parse_object_id(library_id)
    libraries = acol("libraries")
    lib = await libraries.find_one({"_id": oid})
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")
    return {
        "scanning": lib.get("scanning", False),
        "scan_total": lib.get("scan_total", 0),
        "scan_done": lib.get("scan_done", 0),
        "indexed_count": lib.get("indexed_count", 0),
        "last_scanned": lib.get("last_scanned"),
        "scan_error": lib.get("scan_error"),
        "scan_failed_count": lib.get("scan_failed_count", 0),
    }


@router.patch("/{library_id}")
async def update_library(library_id: str, body: LibraryUpdate):
    oid = parse_object_id(library_id)
    update_doc = {k: v for k, v in body.dict(exclude_unset=True).items()}
    if not update_doc:
        raise HTTPException(status_code=400, detail="No fields to update")
    libraries = acol("libraries")
    await libraries.update_one({"_id": oid}, {"$set": update_doc})
    doc = await libraries.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Library not found")
    doc["_id"] = str(doc["_id"])  # stringify
    return doc
