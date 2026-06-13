"""Single source of truth for Mongo connection tuning and index definitions.

Both the sync (:mod:`database.mongo`) and async (:mod:`database.motor`) clients
import from here, so connection kwargs and the index set are defined exactly once.
"""

from __future__ import annotations

import os
from typing import Any

from pymongo import ASCENDING, DESCENDING, IndexModel

from ..core import config


def mongo_uri() -> str:
    return config.MONGO_URI or os.getenv("MONGO_URI", "mongodb://localhost:27017")


def client_kwargs() -> dict[str, Any]:
    """Connection/pool/timeout kwargs shared by the sync and async clients."""
    return dict(
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


def image_indexes() -> list[IndexModel]:
    """Secondary indexes for the ``images`` collection (``_id`` is implicit)."""
    return [
        # Filter by library efficiently and keep sort by _id fast for pagination
        IndexModel([("library_id", ASCENDING), ("_id", DESCENDING)], name="lib_id__id"),
        # Tag queries ($in / $all) benefit from a multikey index on tags
        IndexModel([("tags", ASCENDING)], name="tags"),
        # Optimize "no tags" filter via has_tags boolean combined with library and sort
        IndexModel(
            [("library_id", ASCENDING), ("has_tags", ASCENDING), ("_id", DESCENDING)],
            name="lib_id_has_tags__id",
        ),
        # Compound index for tag filter queries with library and sort
        IndexModel(
            [("library_id", ASCENDING), ("tags", ASCENDING), ("_id", DESCENDING)],
            name="lib_id_tags__id",
        ),
        # Optimize AI tagging progress queries (untagged by AI)
        IndexModel(
            [("library_id", ASCENDING), ("has_ai_tags", ASCENDING), ("_id", DESCENDING)],
            name="lib_id_has_ai_tags__id",
        ),
    ]


def tag_meta_indexes() -> list[IndexModel]:
    return [IndexModel([("updated_at", DESCENDING)], name="tag_meta_updated_at")]
