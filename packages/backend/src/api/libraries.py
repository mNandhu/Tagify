from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_libraries():
    return []


@router.post("")
async def add_library(path: str, name: str | None = None):
    return {"id": "lib_1", "name": name or path, "path": path}


@router.delete("/{library_id}")
async def remove_library(library_id: str):
    return {"removed": library_id}


@router.post("/{library_id}/rescan")
async def rescan_library(library_id: str):
    return {"rescan": library_id, "status": "queued"}
