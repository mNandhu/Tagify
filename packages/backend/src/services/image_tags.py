"""Image tag-state: the single owner of how tags live on an image document.

Conventions enforced here (and nowhere else):

- ``tags`` holds three kinds of tag in one array:
    * AI tags     — primary, stored unprefixed (e.g. ``"1girl"``)
    * Manual tags — stored with a ``manual:`` prefix (e.g. ``"manual:favourite"``)
    * Prompt tags — extracted from generation prompts, stored with a ``prompt:``
      prefix (e.g. ``"prompt:masterpiece"``). Owned by reprojection, not the user.
- ``has_tags``        — True iff ``tags`` has a *curatable* tag (a non-``prompt:``
  tag, i.e. AI or manual). Prompt-only images stay "untagged" for curation.
- ``has_ai_tags``     — True iff ``tags`` has a tag that is neither manual nor prompt.
- ``has_prompt_tags`` — True iff ``tags`` contains at least one ``prompt:`` tag.
- ``rating``          — one of RATINGS; reset to ``"-"`` when AI tags are cleared.

Every write that touches ``tags`` recomputes the three flags from the resulting
array via :func:`_recompute_flags_stage`, so the booleans can never drift from the
array they summarise. Callers hand the repo a high-level intent (apply manual /
remove / replace AI / clear AI / replace prompt); they never assemble pipelines.
"""

from __future__ import annotations

from typing import Any

from ..database.motor import acol

MANUAL_PREFIX = "manual:"
PROMPT_PREFIX = "prompt:"
_PROMPT_REGEX = r"^prompt:"
# Tags that are NOT AI tags: anything carrying a kind prefix. AI is the absence
# of a prefix, so "is an AI tag" == "matches neither of these".
_NON_AI_REGEX = r"^(manual|prompt):"

# Canonical rating vocabulary used by the API, UI and AI tagger.
RATINGS = ("-", "general", "sensitive", "questionable", "explicit")


def initial_tag_fields() -> dict[str, Any]:
    """Tag-state fields for a freshly indexed image (``$setOnInsert`` payload).

    Seeds ``quarantined``/``score`` so the curation filters never have to cope
    with a missing field (``{"$ne": True}`` still guards pre-existing docs).
    """
    return {
        "tags": [],
        "has_tags": False,
        "has_ai_tags": False,
        "has_prompt_tags": False,
        "quarantined": False,
        "score": 0,
    }


# --- Tag prefix helpers (pure) ------------------------------------------------


def is_manual(tag: str) -> bool:
    return tag.startswith(MANUAL_PREFIX)


def to_manual(tag: str) -> str:
    """Return ``tag`` with the manual prefix, idempotently."""
    return tag if is_manual(tag) else f"{MANUAL_PREFIX}{tag}"


def is_prompt(tag: str) -> bool:
    return tag.startswith(PROMPT_PREFIX)


def to_prompt(tag: str) -> str:
    """Return ``tag`` with the prompt prefix, idempotently."""
    return tag if is_prompt(tag) else f"{PROMPT_PREFIX}{tag}"


# Gallery-search sentinel: ``any:<base>`` is not a stored tag kind but a *query*
# marker the gallery tag search emits. It means "match this text from any source"
# (AI, manual or prompt). Same-text tags from different sources collapse into one
# ``any:`` suggestion in the dropdown so the user sees a single "tag1" row instead
# of three near-identical ones. Only the query builder interprets it.
ANY_PREFIX = "any:"


def is_any(tag: str) -> bool:
    return tag.startswith(ANY_PREFIX)


def any_variants(tag: str) -> list[str]:
    """Concrete tag ids an ``any:<base>`` selection should match: the bare AI
    tag plus its manual/prompt-prefixed siblings."""
    base = tag[len(ANY_PREFIX):]
    return [base, to_manual(base), to_prompt(base)]


def expand_search_tag(tag: str) -> list[str]:
    """Tag ids a single selected search entry matches. An ``any:`` entry fans out
    to all sources; any other entry matches itself exactly (source-specific deep
    links stay precise)."""
    return any_variants(tag) if is_any(tag) else [tag]


def merged_tag_counts_pipeline() -> list[dict[str, Any]]:
    """Aggregation that counts *distinct images* per cross-source base tag.

    Strips the manual:/prompt: prefix so the three sources of "cat" collapse to
    one ``base``, then dedupes (base, image) before counting — so an image
    carrying both ``manual:cat`` and ``prompt:cat`` counts once, not twice (the
    naive per-occurrence sum the gallery used before over-counted). Emits
    ``{_id: "<base>", count: <distinct images>}`` sorted by count; the caller
    re-prefixes ``any:`` to match the search-tag expansion."""
    strip_prefix = {
        "$switch": {
            "branches": [
                {
                    "case": {"$eq": [{"$indexOfBytes": ["$tags", MANUAL_PREFIX]}, 0]},
                    "then": {
                        "$substrBytes": [
                            "$tags",
                            len(MANUAL_PREFIX),
                            {"$strLenBytes": "$tags"},
                        ]
                    },
                },
                {
                    "case": {"$eq": [{"$indexOfBytes": ["$tags", PROMPT_PREFIX]}, 0]},
                    "then": {
                        "$substrBytes": [
                            "$tags",
                            len(PROMPT_PREFIX),
                            {"$strLenBytes": "$tags"},
                        ]
                    },
                },
            ],
            "default": "$tags",
        }
    }
    return [
        {"$unwind": {"path": "$tags", "preserveNullAndEmptyArrays": False}},
        {"$project": {"base": strip_prefix}},
        # Dedupe each image within a base before counting, so multi-source
        # duplicates collapse to one distinct image.
        {"$group": {"_id": {"base": "$base", "img": "$_id"}}},
        {"$group": {"_id": "$_id.base", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]


def build_tags_match(tags: list[str], logic: str) -> dict:
    """Mongo predicate for a list of selected search entries.

    AND → every entry must be present, OR within each ``any:`` group:
    ``{"$and": [{"tags": {"$in": [variants]}}, {"tags": exact}, ...]}``.
    OR  → union of every entry's variants into one ``{"tags": {"$in": [...]}}``.

    A single AND clause is returned unwrapped so callers can attach sibling
    filter keys (``library_id``, ``quarantined``, cursor) by implicit AND."""
    if logic == "or":
        flat: list[str] = []
        seen: set[str] = set()
        for t in tags:
            for v in expand_search_tag(t):
                if v not in seen:
                    seen.add(v)
                    flat.append(v)
        return {"tags": {"$in": flat}}

    clauses: list[dict] = []
    for t in tags:
        ids = expand_search_tag(t)
        clauses.append({"tags": ids[0]} if len(ids) == 1 else {"tags": {"$in": ids}})
    if len(clauses) == 1:
        return clauses[0]
    return {"$and": clauses}


def normalize_rating(raw: str | None) -> str | None:
    """Map a raw rating label to the canonical vocabulary.

    Returns ``"-"`` for empty/none, the canonical label for known values, and
    ``None`` for anything unrecognised. Callers decide whether ``None`` means
    "reject" (API) or "fall back to '-'" (AI tagger).
    """
    r = (raw or "").strip().lower()
    if r in ("", "-", "none"):
        return "-"
    if r in ("general", "safe"):
        return "general"
    if r in ("sensitive", "questionable", "explicit"):
        return r
    return None


# --- Image id variants (pure) -------------------------------------------------


def id_variants(image_id: str) -> list[str]:
    """Alternate ``_id`` spellings to tolerate Windows ``\\`` vs POSIX ``/``.

    The primary id is intentionally excluded; callers try it first.
    """
    variants: list[str] = []
    if "/" in image_id:
        variants.append(image_id.replace("/", "\\"))
    if "\\" in image_id:
        variants.append(image_id.replace("\\", "/"))
    return variants


# --- Update-spec builders (pure) ----------------------------------------------
#
# Each returns an aggregation-pipeline update. They are plain data so their shape
# is unit-testable without a database.


def _recompute_flags_stage() -> dict[str, Any]:
    """A ``$set`` stage deriving the three flags from the current ``$tags`` array.

    ``has_ai_tags`` is "has a tag carrying no kind prefix" — neither ``manual:``
    nor ``prompt:`` — so prompt tags never masquerade as AI tags.
    """
    tags = {"$ifNull": ["$tags", []]}
    return {
        "$set": {
            # "has_tags" means "has a curatable tag" — a non-prompt tag (AI or
            # manual). Prompt tags are reproject-owned, not curation, so a
            # prompt-only image still reads as untagged (stays in the Untagged
            # tile until it gets AI/manual tags). This keeps Untagged ⊂ AI-Untagged.
            "has_tags": {
                "$anyElementTrue": {
                    "$map": {
                        "input": tags,
                        "as": "t",
                        "in": {
                            "$not": [
                                {
                                    "$regexMatch": {
                                        "input": "$$t",
                                        "regex": _PROMPT_REGEX,
                                    }
                                }
                            ]
                        },
                    }
                }
            },
            "has_ai_tags": {
                "$anyElementTrue": {
                    "$map": {
                        "input": tags,
                        "as": "t",
                        "in": {
                            "$not": [
                                {
                                    "$regexMatch": {
                                        "input": "$$t",
                                        "regex": _NON_AI_REGEX,
                                    }
                                }
                            ]
                        },
                    }
                }
            },
            "has_prompt_tags": {
                "$anyElementTrue": {
                    "$map": {
                        "input": tags,
                        "as": "t",
                        "in": {"$regexMatch": {"input": "$$t", "regex": _PROMPT_REGEX}},
                    }
                }
            },
        }
    }


def apply_manual_pipeline(tags: list[str]) -> list[dict[str, Any]]:
    """Add manual tags (union semantics; existing AI tags untouched)."""
    manual = [to_manual(t) for t in tags]
    return [
        {"$set": {"tags": {"$setUnion": [{"$ifNull": ["$tags", []]}, manual]}}},
        _recompute_flags_stage(),
    ]


def remove_tags_pipeline(tags: list[str]) -> list[dict[str, Any]]:
    """Remove the given tags (exact match, AI or manual) and resync flags."""
    return [
        {
            "$set": {
                "tags": {
                    "$filter": {
                        "input": {"$ifNull": ["$tags", []]},
                        "as": "t",
                        "cond": {"$not": [{"$in": ["$$t", tags]}]},
                    }
                }
            }
        },
        _recompute_flags_stage(),
    ]


def replace_ai_pipeline(
    *, ai_tags: list[str], ai_meta: dict[str, Any], rating: str
) -> list[dict[str, Any]]:
    """Replace AI tags with ``ai_tags``, preserving manual + prompt tags; set AI
    meta+rating. Only the unprefixed (AI) tags are swapped out."""
    return [
        {
            "$set": {
                "ai": ai_meta,
                "rating": rating,
                "__keep_tags": {
                    "$filter": {
                        "input": {"$ifNull": ["$tags", []]},
                        "as": "t",
                        "cond": {
                            "$regexMatch": {"input": "$$t", "regex": _NON_AI_REGEX}
                        },
                    }
                },
            }
        },
        {"$set": {"tags": {"$concatArrays": ["$__keep_tags", ai_tags]}}},
        _recompute_flags_stage(),
        {"$unset": "__keep_tags"},
    ]


def replace_prompt_pipeline(prompt_tags: list[str]) -> list[dict[str, Any]]:
    """Replace ``prompt:`` tags with ``prompt_tags``, preserving AI + manual tags.

    Owned by reprojection (mirror of :func:`replace_ai_pipeline`). Re-runnable:
    existing prompt tags are dropped and replaced, never appended. ``prompt_tags``
    are already prefixed by the caller (see :func:`to_prompt`)."""
    return [
        {
            "$set": {
                "__keep_tags": {
                    "$filter": {
                        "input": {"$ifNull": ["$tags", []]},
                        "as": "t",
                        "cond": {
                            "$not": [
                                {
                                    "$regexMatch": {
                                        "input": "$$t",
                                        "regex": _PROMPT_REGEX,
                                    }
                                }
                            ]
                        },
                    }
                },
            }
        },
        {"$set": {"tags": {"$concatArrays": ["$__keep_tags", prompt_tags]}}},
        _recompute_flags_stage(),
        {"$unset": "__keep_tags"},
    ]


def clear_ai_pipeline() -> list[dict[str, Any]]:
    """Drop AI tags + AI meta from an image, keeping manual + prompt tags. Resets
    rating."""
    return [
        {
            "$set": {
                "tags": {
                    "$filter": {
                        "input": {"$ifNull": ["$tags", []]},
                        "as": "t",
                        "cond": {
                            "$regexMatch": {"input": "$$t", "regex": _NON_AI_REGEX}
                        },
                    }
                },
                "rating": "-",
            }
        },
        _recompute_flags_stage(),
        {"$unset": "ai"},
    ]


def browse_exclude_match(
    *, include_manual: bool = False, include_prompt: bool = False
) -> dict[str, Any] | None:
    """Match expression for the tag browser: exclude the kinds not opted into.

    Default browse is AI-only (manual + prompt both excluded). Returns ``None``
    when nothing is excluded (both kinds opted in), so callers can skip the stage.
    """
    excluded: list[str] = []
    if not include_manual:
        excluded.append("manual")
    if not include_prompt:
        excluded.append("prompt")
    if not excluded:
        return None
    regex = rf"^({'|'.join(excluded)}):"
    return {"tags": {"$not": {"$regex": regex}}}


# --- Repository (I/O) ---------------------------------------------------------


async def find_image(image_id: str, projection: dict | None = None):
    """Look up an image by id, tolerating slash/backslash id variants."""
    images = acol("images")
    doc = await images.find_one({"_id": image_id}, projection)
    if doc:
        return doc
    for alt in id_variants(image_id):
        doc = await images.find_one({"_id": alt}, projection)
        if doc:
            return doc
    return None


async def apply_manual(image_id: str, tags: list[str]) -> None:
    await acol("images").update_one({"_id": image_id}, apply_manual_pipeline(tags))


async def remove_tags(image_id: str, tags: list[str]) -> None:
    await acol("images").update_one({"_id": image_id}, remove_tags_pipeline(tags))


async def replace_ai(
    image_id: str, *, ai_tags: list[str], ai_meta: dict[str, Any], rating: str
) -> None:
    await acol("images").update_one(
        {"_id": image_id},
        replace_ai_pipeline(ai_tags=ai_tags, ai_meta=ai_meta, rating=rating),
    )


async def clear_ai_all() -> tuple[int, int]:
    """Clear AI tags across every image. Returns ``(matched, modified)``."""
    res = await acol("images").update_many({}, clear_ai_pipeline())
    return res.matched_count, res.modified_count
