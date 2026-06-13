"""Unit tests for the Image tag-state invariant.

These exercise the pure builders/helpers in ``services.image_tags`` — the single
owner of the manual-prefix convention and the has_tags/has_ai_tags recompute — so
the invariant has a test surface that needs no database.
"""

from src.services import image_tags as it


# --- prefix helpers ----------------------------------------------------------


def test_to_manual_adds_prefix_idempotently():
    assert it.to_manual("cat") == "manual:cat"
    assert it.to_manual("manual:cat") == "manual:cat"


def test_is_manual():
    assert it.is_manual("manual:cat")
    assert not it.is_manual("cat")


# --- rating normalization ----------------------------------------------------


def test_normalize_rating_canonical_and_aliases():
    assert it.normalize_rating("") == "-"
    assert it.normalize_rating(None) == "-"
    assert it.normalize_rating("none") == "-"
    assert it.normalize_rating("safe") == "general"
    assert it.normalize_rating("General") == "general"
    assert it.normalize_rating("EXPLICIT") == "explicit"
    assert it.normalize_rating("questionable") == "questionable"


def test_normalize_rating_unknown_is_none():
    assert it.normalize_rating("spicy") is None


# --- id variants -------------------------------------------------------------


def test_id_variants_swaps_separators():
    assert it.id_variants("lib:a/b") == ["lib:a\\b"]
    assert it.id_variants("lib:a\\b") == ["lib:a/b"]


def test_id_variants_excludes_primary_when_no_separator():
    assert it.id_variants("lib:flat") == []


# --- update pipelines: every tag-mutating build recomputes both flags --------


def _flags_stage(pipeline):
    """Return the $set stage that recomputes has_tags/has_ai_tags, if present."""
    for stage in pipeline:
        keys = stage.get("$set", {})
        if "has_tags" in keys and "has_ai_tags" in keys:
            return keys
    return None


def test_apply_manual_unions_and_recomputes_flags():
    pipe = it.apply_manual_pipeline(["fav", "manual:keep"])
    # tags stage uses setUnion with manualized inputs
    set_tags = pipe[0]["$set"]["tags"]
    assert set_tags["$setUnion"][1] == ["manual:fav", "manual:keep"]
    assert _flags_stage(pipe) is not None


def test_remove_filters_and_recomputes_flags():
    pipe = it.remove_tags_pipeline(["cat", "manual:fav"])
    cond = pipe[0]["$set"]["tags"]["$filter"]["cond"]
    assert cond == {"$not": [{"$in": ["$$t", ["cat", "manual:fav"]]}]}
    assert _flags_stage(pipe) is not None


def test_replace_ai_preserves_manual_and_recomputes_flags():
    meta = {"model_repo": "x", "updated_at": 0}
    pipe = it.replace_ai_pipeline(ai_tags=["1girl"], ai_meta=meta, rating="general")
    # manual tags are filtered out, then concatenated with the new AI tags
    assert pipe[0]["$set"]["ai"] == meta
    assert pipe[0]["$set"]["rating"] == "general"
    assert pipe[1]["$set"]["tags"] == {"$concatArrays": ["$__manual_tags", ["1girl"]]}
    assert _flags_stage(pipe) is not None
    assert pipe[-1] == {"$unset": "__manual_tags"}


def test_clear_ai_keeps_manual_resets_rating_and_recomputes_flags():
    pipe = it.clear_ai_pipeline()
    set0 = pipe[0]["$set"]
    assert set0["rating"] == "-"
    # tags reduced to manual-only
    assert set0["tags"]["$filter"]["cond"] == {
        "$regexMatch": {"input": "$$t", "regex": "^manual:"}
    }
    assert _flags_stage(pipe) is not None
    assert {"$unset": "ai"} in pipe


def test_exclude_manual_match_shape():
    assert it.exclude_manual_match() == {"tags": {"$not": {"$regex": "^manual:"}}}
