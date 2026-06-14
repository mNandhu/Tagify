"""Image tag-state: the single owner of how tags live on an image document.

Conventions enforced here (and nowhere else):

- ``tags`` holds two kinds of tag in one array:
    * AI tags    — primary, stored unprefixed (e.g. ``"1girl"``)
    * Manual tags — stored with a ``manual:`` prefix (e.g. ``"manual:favourite"``)
- ``has_tags``    — True iff ``tags`` is non-empty.
- ``has_ai_tags`` — True iff ``tags`` contains at least one non-manual tag.
- ``rating``      — one of RATINGS; reset to ``"-"`` when AI tags are cleared.

Every write that touches ``tags`` recomputes ``has_tags``/``has_ai_tags`` from the
resulting array via :func:`_recompute_flags_stage`, so the two booleans can never
drift from the array they summarise. Callers hand the repo a high-level intent
(apply manual / remove / replace AI / clear AI); they never assemble pipelines.
"""

from __future__ import annotations

from typing import Any

from ..database.motor import acol

MANUAL_PREFIX = "manual:"
_MANUAL_REGEX = r"^manual:"

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
        "quarantined": False,
        "score": 0,
    }


# --- Tag prefix helpers (pure) ------------------------------------------------


def is_manual(tag: str) -> bool:
    return tag.startswith(MANUAL_PREFIX)


def to_manual(tag: str) -> str:
    """Return ``tag`` with the manual prefix, idempotently."""
    return tag if is_manual(tag) else f"{MANUAL_PREFIX}{tag}"


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
    """A ``$set`` stage deriving the flags from the current ``$tags`` array."""
    tags = {"$ifNull": ["$tags", []]}
    return {
        "$set": {
            "has_tags": {"$gt": [{"$size": tags}, 0]},
            "has_ai_tags": {
                "$anyElementTrue": {
                    "$map": {
                        "input": tags,
                        "as": "t",
                        "in": {
                            "$not": [
                                {"$regexMatch": {"input": "$$t", "regex": _MANUAL_REGEX}}
                            ]
                        },
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
    """Replace AI tags with ``ai_tags``, preserving manual tags; set AI meta+rating."""
    return [
        {
            "$set": {
                "ai": ai_meta,
                "rating": rating,
                "__manual_tags": {
                    "$filter": {
                        "input": {"$ifNull": ["$tags", []]},
                        "as": "t",
                        "cond": {"$regexMatch": {"input": "$$t", "regex": _MANUAL_REGEX}},
                    }
                },
            }
        },
        {"$set": {"tags": {"$concatArrays": ["$__manual_tags", ai_tags]}}},
        _recompute_flags_stage(),
        {"$unset": "__manual_tags"},
    ]


def clear_ai_pipeline() -> list[dict[str, Any]]:
    """Drop AI tags + AI meta from an image, keeping manual tags. Resets rating."""
    return [
        {
            "$set": {
                "tags": {
                    "$filter": {
                        "input": {"$ifNull": ["$tags", []]},
                        "as": "t",
                        "cond": {"$regexMatch": {"input": "$$t", "regex": _MANUAL_REGEX}},
                    }
                },
                "rating": "-",
            }
        },
        _recompute_flags_stage(),
        {"$unset": "ai"},
    ]


def exclude_manual_match() -> dict[str, Any]:
    """Match expression selecting only non-manual (AI) tags."""
    return {"tags": {"$not": {"$regex": _MANUAL_REGEX}}}


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
