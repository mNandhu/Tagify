from fastapi import APIRouter, HTTPException


from ..database.mongo import col
from ..models.library import LibraryIn, LibraryUpdate
from ..services.scanner import scan_library_async
from bson.objectid import ObjectId

from ..services.storage_minio import delete_by_prefix

router = APIRouter()


@router.get("")
async def list_libraries():
    libraries = list(col("libraries").find())
    for lib in libraries:
        lib["_id"] = str(lib["_id"])  # stringify ObjectId
    return libraries


@router.post("")
async def add_library(body: LibraryIn):
    libraries = col("libraries")
    existing = libraries.find_one({"path": body.path})
    if existing:
        existing["_id"] = str(existing["_id"])
        return existing
    res = libraries.insert_one(
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
    libraries = col("libraries")
    images = col("images")
    try:
        oid = ObjectId(library_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid library id")
    libraries.delete_one({"_id": oid})
    images.delete_many({"library_id": library_id})
    # remove MinIO objects for this library
    try:
        delete_by_prefix(f"{library_id}/")
    except Exception:
        # ignore failures to remove objects
        pass
    return {"removed": library_id}


@router.post("/{library_id}/rescan")
async def rescan_library(library_id: str):
    libraries = col("libraries")
    lib = libraries.find_one({"_id": ObjectId(library_id)})
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")
    scan_library_async(library_id, lib["path"])
    return {"rescan": library_id, "started": True}


@router.get("/{library_id}/progress")
async def library_progress(library_id: str):
    libraries = col("libraries")
    lib = libraries.find_one({"_id": ObjectId(library_id)})
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")
    return {
        "scanning": lib.get("scanning", False),
        "scan_total": lib.get("scan_total", 0),
        "scan_done": lib.get("scan_done", 0),
        "indexed_count": lib.get("indexed_count", 0),
        "last_scanned": lib.get("last_scanned"),
        "scan_error": lib.get("scan_error"),
    }


@router.patch("/{library_id}")
async def update_library(library_id: str, body: LibraryUpdate):
    try:
        oid = ObjectId(library_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid library id")
    update_doc = {k: v for k, v in body.dict(exclude_unset=True).items()}
    if not update_doc:
        raise HTTPException(status_code=400, detail="No fields to update")
    libraries = col("libraries")
    libraries.update_one({"_id": oid}, {"$set": update_doc})
    doc = libraries.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Library not found")
    doc["_id"] = str(doc["_id"])  # stringify
    return doc
