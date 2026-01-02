from __future__ import annotations

import os

from motor.motor_asyncio import (
    AsyncIOMotorClient,
    AsyncIOMotorCollection,
    AsyncIOMotorDatabase,
)
from pymongo import ASCENDING, DESCENDING, IndexModel

from ..core import config

_async_client: AsyncIOMotorClient | None = None


def get_async_client() -> AsyncIOMotorClient:
    global _async_client
    if _async_client is None:
        uri = config.MONGO_URI or os.getenv("MONGO_URI", "mongodb://localhost:27017")
        _async_client = AsyncIOMotorClient(
            uri,
            appname="tagify",
            maxPoolSize=max(1, int(getattr(config, "MONGO_MAX_POOL_SIZE", 100))),
            minPoolSize=max(0, int(getattr(config, "MONGO_MIN_POOL_SIZE", 0))),
            serverSelectionTimeoutMS=max(
                1000, int(getattr(config, "MONGO_SERVER_SELECTION_TIMEOUT_MS", 5000))
            ),
            connectTimeoutMS=max(
                1000, int(getattr(config, "MONGO_CONNECT_TIMEOUT_MS", 5000))
            ),
            retryReads=True,
            retryWrites=True,
        )
    return _async_client


def get_async_db(name: str = os.getenv("MONGO_DB", "tagify")) -> AsyncIOMotorDatabase:
    return get_async_client()[name]


def acol(name: str) -> AsyncIOMotorCollection:
    return get_async_db()[name]


async def ensure_indexes_async() -> None:
    """Create required indexes if they don't already exist.

    This is safe to call on startup.
    """
    db = get_async_db()
    images = db["images"]
    image_indexes: list[IndexModel] = [
        IndexModel([("library_id", ASCENDING), ("_id", DESCENDING)], name="lib_id__id"),
        IndexModel([("tags", ASCENDING)], name="tags"),
        IndexModel(
            [("library_id", ASCENDING), ("has_tags", ASCENDING), ("_id", DESCENDING)],
            name="lib_id_has_tags__id",
        ),
        IndexModel(
            [("library_id", ASCENDING), ("tags", ASCENDING), ("_id", DESCENDING)],
            name="lib_id_tags__id",
        ),
    ]
    try:
        await images.create_indexes(image_indexes)
    except Exception:
        # Best-effort; don't prevent app startup.
        pass
