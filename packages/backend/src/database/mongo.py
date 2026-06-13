from __future__ import annotations
import os
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

from . import schema

_client: MongoClient | None = None


def get_client() -> MongoClient:
    global _client
    if _client is None:
        _client = MongoClient(schema.mongo_uri(), **schema.client_kwargs())
    return _client


def get_db(name: str = os.getenv("MONGO_DB", "tagify")) -> Database:
    return get_client()[name]


def col(name: str) -> Collection:
    return get_db()[name]


def ensure_indexes() -> None:
    """Create required indexes if they don't already exist.
    Idempotent and safe to call on startup.
    """
    db = get_db()
    for name, indexes in (
        ("images", schema.image_indexes()),
        ("tag_meta", schema.tag_meta_indexes()),
    ):
        try:
            db[name].create_indexes(indexes)
        except Exception:
            # Best-effort; don't prevent app startup. Consider logging in future.
            pass
