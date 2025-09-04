from __future__ import annotations
from pymongo import MongoClient
from pymongo import IndexModel
from pymongo import ASCENDING, DESCENDING
from pymongo.collection import Collection
from pymongo.database import Database
import os

_client: MongoClient | None = None


def get_client() -> MongoClient:
    global _client
    if _client is None:
        uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
        _client = MongoClient(uri)
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
    images = db["images"]
    # _id has an implicit unique index already. Add helpful secondary indexes.
    image_indexes: list[IndexModel] = [
        # Filter by library efficiently and keep sort by _id fast for pagination
        IndexModel([("library_id", ASCENDING), ("_id", DESCENDING)], name="lib_id__id"),
        # Tag queries ($in / $all) benefit from a multikey index on tags
        IndexModel([("tags", ASCENDING)], name="tags"),
        # Optimize "no tags" filter via has_tags boolean combined with library and sort
        IndexModel(
            [("library_id", ASCENDING), ("has_tags", ASCENDING), ("_id", DESCENDING)],
            name="lib_id_has_tags__id",
        ),
    ]
    try:
        images.create_indexes(image_indexes)
    except Exception:
        # Best-effort; don't prevent app startup. Consider logging in future.
        pass
