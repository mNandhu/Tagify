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


def _load_rulesets() -> dict[str, dict]:
    """All user rulesets keyed by workflow signature (``_id``)."""
    return {doc["_id"]: doc for doc in col("gen_rulesets").find({})}


def _reproject_query(query: dict) -> int:
    """Recompute ``gen.*`` for every raw doc matching ``query``, applying the
    user ruleset bound to each doc's signature. Returns docs updated."""
    rulesets = _load_rulesets()
    images = col("images")
    ops: list[UpdateOne] = []
    updated = 0

    def _flush() -> None:
        nonlocal updated, ops
        if not ops:
            return
        batch = ops
        ops = []
        for attempt in range(3):
            try:
                images.bulk_write(batch, ordered=False)
                break
            except (AutoReconnect, NetworkTimeout, PyMongoError):
                if attempt == 2:
                    raise
        updated += len(batch)

    for raw in col("image_gen_raw").find(query):
        ruleset = rulesets.get(raw.get("workflow_sig"))
        g = gen_metadata.extract(raw, ruleset)
        if g is None:
            continue
        ops.append(UpdateOne({"_id": raw["_id"]}, {"$set": {"gen": g}}))
        if len(ops) >= _BATCH:
            _flush()
    _flush()
    return updated


def reproject_library(library_id: str, *, workflow_sig: str | None = None) -> int:
    """Recompute ``gen.*`` for one library's images (optionally scoped to a single
    workflow signature)."""
    query: dict = {"library_id": library_id}
    if workflow_sig is not None:
        query["workflow_sig"] = workflow_sig
    return _reproject_query(query)


def reproject_by_sig(workflow_sig: str) -> int:
    """Recompute ``gen.*`` for every image of a signature across all libraries.
    Used when a ruleset is created/edited/deleted (rulesets are sig-global)."""
    return _reproject_query({"workflow_sig": workflow_sig})


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


def reproject_by_sig_async(workflow_sig: str) -> None:
    """Fire-and-forget by-sig reprojection (triggered on ruleset save/delete)."""
    t = threading.Thread(
        target=reproject_by_sig,
        args=(workflow_sig,),
        name=f"reproject-sig-{workflow_sig[:8]}",
        daemon=True,
    )
    t.start()
