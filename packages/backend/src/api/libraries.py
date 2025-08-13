from fastapi import APIRouter, HTTPException

from ..database.mongo import col
from ..models.library import LibraryIn
from ..services.scanner import scan_library
from bson.objectid import ObjectId

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
    res = libraries.insert_one({"path": body.path, "name": body.name or body.path})
    lib_id = str(res.inserted_id)
    # trigger initial scan (sync for now)
    count = scan_library(lib_id, body.path)
    return {
        "_id": lib_id,
        "path": body.path,
        "name": body.name or body.path,
        "indexed": count,
    }


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
    return {"removed": library_id}


@router.post("/{library_id}/rescan")
async def rescan_library(library_id: str):
    libraries = col("libraries")
    lib = libraries.find_one({"_id": ObjectId(library_id)})
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")
    count = scan_library(library_id, lib["path"])
    return {"rescan": library_id, "indexed": count}
