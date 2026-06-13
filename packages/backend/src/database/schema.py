"""Single source of truth for Mongo connection tuning and index definitions.

Both the sync (:mod:`database.mongo`) and async (:mod:`database.motor`) clients
import from here, so connection kwargs and the index set are defined exactly once.
"""

from __future__ import annotations

from typing import Any

from pymongo import ASCENDING, DESCENDING, IndexModel

from ..core.config import settings


def mongo_uri() -> str:
    return settings.mongo_uri


def client_kwargs() -> dict[str, Any]:
    """Connection/pool/timeout kwargs shared by the sync and async clients."""
    return dict(
        appname="tagify",
        maxPoolSize=max(1, settings.mongo_max_pool_size),
        minPoolSize=max(0, settings.mongo_min_pool_size),
        serverSelectionTimeoutMS=max(1000, settings.mongo_server_selection_timeout_ms),
        connectTimeoutMS=max(1000, settings.mongo_connect_timeout_ms),
        retryReads=True,
        retryWrites=True,
    )


def image_indexes() -> list[IndexModel]:
    """Secondary indexes for the ``images`` collection (``_id`` is implicit)."""
    return [
        # Filter by library efficiently and keep sort by _id fast for pagination
        IndexModel([("library_id", ASCENDING), ("_id", DESCENDING)], name="lib_id__id"),
        # Tag queries ($in / $all) without a library_id: the multikey tags
        # prefix serves the match and the trailing _id covers the desc sort,
        # so pagination doesn't fall back to an in-memory sort.
        IndexModel([("tags", ASCENDING), ("_id", DESCENDING)], name="tags__id"),
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
