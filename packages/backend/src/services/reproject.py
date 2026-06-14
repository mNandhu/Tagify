"""Reprojection: (re)derive structured ``gen.*`` on image docs from the raw
generation data captured at scan time.

Decoupled from disk scanning — it reads ``image_gen_raw`` (the cold collection)
and writes the small structured subdoc onto ``images``. Because raw is retained,
this can re-run any time (e.g. after extraction rules change in v2) without
re-reading a single file.

Sync (pymongo) by design: the only v1 caller is the scan thread, which is sync,
and the manual endpoint spawns its own thread. No event loop to juggle.
"""

from __future__ import annotations

import threading

from pymongo import UpdateOne
from pymongo.errors import AutoReconnect, NetworkTimeout, PyMongoError

from ..database.mongo import col
from . import gen_metadata

_BATCH = 200


def reproject_library(library_id: str, *, workflow_sig: str | None = None) -> int:
    """Recompute ``gen.*`` for one library's images (optionally scoped to a single
    workflow signature). Returns the number of image docs updated."""
    query: dict = {"library_id": library_id}
    if workflow_sig is not None:
        query["workflow_sig"] = workflow_sig

    raw_col = col("image_gen_raw")
    images = col("images")
    ops: list[UpdateOne] = []
    updated = 0

    def _flush() -> None:
        nonlocal updated, ops
        if not ops:
            return
        batch = ops
        ops = []

        def _do():
            return images.bulk_write(batch, ordered=False)

        for attempt in range(3):
            try:
                _do()
                break
            except (AutoReconnect, NetworkTimeout, PyMongoError):
                if attempt == 2:
                    raise
        updated += len(batch)

    for raw in raw_col.find(query):
        g = gen_metadata.extract(raw)
        if g is None:
            continue
        ops.append(UpdateOne({"_id": raw["_id"]}, {"$set": {"gen": g}}))
        if len(ops) >= _BATCH:
            _flush()
    _flush()
    return updated


def reproject_library_async(
    library_id: str, *, workflow_sig: str | None = None
) -> None:
    """Fire-and-forget reprojection in a daemon thread (manual endpoint)."""
    t = threading.Thread(
        target=reproject_library,
        args=(library_id,),
        kwargs={"workflow_sig": workflow_sig},
        name=f"reproject-{library_id}",
        daemon=True,
    )
    t.start()
