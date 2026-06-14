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


def test_to_prompt_adds_prefix_idempotently():
    assert it.to_prompt("masterpiece") == "prompt:masterpiece"
    assert it.to_prompt("prompt:masterpiece") == "prompt:masterpiece"


def test_is_prompt():
    assert it.is_prompt("prompt:masterpiece")
    assert not it.is_prompt("masterpiece")
    assert not it.is_prompt("manual:fav")


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


def test_replace_ai_preserves_non_ai_tags_and_recomputes_flags():
    meta = {"model_repo": "x", "updated_at": 0}
    pipe = it.replace_ai_pipeline(ai_tags=["1girl"], ai_meta=meta, rating="general")
    # Non-AI tags (manual AND prompt) are kept, then concatenated with new AI tags.
    assert pipe[0]["$set"]["ai"] == meta
    assert pipe[0]["$set"]["rating"] == "general"
    assert pipe[0]["$set"]["__keep_tags"]["$filter"]["cond"] == {
        "$regexMatch": {"input": "$$t", "regex": "^(manual|prompt):"}
    }
    assert pipe[1]["$set"]["tags"] == {"$concatArrays": ["$__keep_tags", ["1girl"]]}
    assert _flags_stage(pipe) is not None
    assert pipe[-1] == {"$unset": "__keep_tags"}


def test_replace_prompt_keeps_ai_and_manual_and_recomputes_flags():
    pipe = it.replace_prompt_pipeline(["prompt:masterpiece", "prompt:1girl"])
    # Everything that is NOT a prompt tag (AI + manual) is preserved.
    assert pipe[0]["$set"]["__keep_tags"]["$filter"]["cond"] == {
        "$not": [{"$regexMatch": {"input": "$$t", "regex": "^prompt:"}}]
    }
    assert pipe[1]["$set"]["tags"] == {
        "$concatArrays": ["$__keep_tags", ["prompt:masterpiece", "prompt:1girl"]]
    }
    assert _flags_stage(pipe) is not None
    assert pipe[-1] == {"$unset": "__keep_tags"}


def test_clear_ai_keeps_non_ai_resets_rating_and_recomputes_flags():
    pipe = it.clear_ai_pipeline()
    set0 = pipe[0]["$set"]
    assert set0["rating"] == "-"
    # tags reduced to non-AI (manual + prompt) only
    assert set0["tags"]["$filter"]["cond"] == {
        "$regexMatch": {"input": "$$t", "regex": "^(manual|prompt):"}
    }
    assert _flags_stage(pipe) is not None
    assert {"$unset": "ai"} in pipe


def test_recompute_flags_stage_has_prompt_axis():
    keys = it._recompute_flags_stage()["$set"]
    assert "has_prompt_tags" in keys
    # AI = neither manual nor prompt.
    ai_in = keys["has_ai_tags"]["$anyElementTrue"]["$map"]["in"]
    assert ai_in == {"$not": [{"$regexMatch": {"input": "$$t", "regex": "^(manual|prompt):"}}]}


def test_has_tags_excludes_prompt_only_so_untagged_tile_holds():
    # has_tags must mean "has a curatable (non-prompt) tag", else prompt-only
    # images (fresh AI art, post-reproject) would vanish from the Untagged tile.
    has_tags_in = it._recompute_flags_stage()["$set"]["has_tags"][
        "$anyElementTrue"
    ]["$map"]["in"]
    assert has_tags_in == {
        "$not": [{"$regexMatch": {"input": "$$t", "regex": "^prompt:"}}]
    }


def test_browse_exclude_match_per_kind():
    # AI-only default: exclude both prefixes.
    assert it.browse_exclude_match() == {
        "tags": {"$not": {"$regex": "^(manual|prompt):"}}
    }
    # Manual opted in: only prompt excluded.
    assert it.browse_exclude_match(include_manual=True) == {
        "tags": {"$not": {"$regex": "^(prompt):"}}
    }
    # Prompt opted in: only manual excluded.
    assert it.browse_exclude_match(include_prompt=True) == {
        "tags": {"$not": {"$regex": "^(manual):"}}
    }
    # Both opted in: no filter.
    assert it.browse_exclude_match(include_manual=True, include_prompt=True) is None
