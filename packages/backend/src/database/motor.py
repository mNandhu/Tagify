from __future__ import annotations

import os

from motor.motor_asyncio import (
    AsyncIOMotorClient,
    AsyncIOMotorCollection,
    AsyncIOMotorDatabase,
)

from . import schema

_async_client: AsyncIOMotorClient | None = None


def get_async_client() -> AsyncIOMotorClient:
    global _async_client
    if _async_client is None:
        _async_client = AsyncIOMotorClient(schema.mongo_uri(), **schema.client_kwargs())
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
    for name, indexes in (
        ("images", schema.image_indexes()),
        ("tag_meta", schema.tag_meta_indexes()),
    ):
        try:
            await db[name].create_indexes(indexes)
        except Exception:
            # Best-effort; don't prevent app startup.
            pass
