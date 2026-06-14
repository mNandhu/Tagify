"""AI tagger settings: defaults, validation, and persistence.

Kept separate from the job manager so the validation/clamping rules
(:func:`clean_settings_patch`) are a pure, testable surface.
"""

from __future__ import annotations

from typing import Any

from ..database.motor import acol
from .ai_tagger import get_tagger_manager

DEFAULT_AI_SETTINGS: dict[str, Any] = {
    "model_repo": "SmilingWolf/wd-vit-tagger-v3",
    "general_thresh": 0.35,
    "character_thresh": 0.85,
    "general_mcut": False,
    "character_mcut": False,
    "max_general": 80,
    "max_character": 40,
    "idle_unload_s": 300,
    "cache_dir": ".cache/tagify/models",
}


def clean_settings_patch(patch: dict[str, Any]) -> dict[str, Any]:
    """Drop unknown keys and coerce/clamp known ones. Pure; no I/O.

    Invalid ``idle_unload_s`` is dropped (rather than raising) so a bad value
    can't wedge settings updates.
    """
    allowed = set(DEFAULT_AI_SETTINGS.keys())
    clean: dict[str, Any] = {k: v for k, v in patch.items() if k in allowed}

    if "idle_unload_s" in clean:
        try:
            clean["idle_unload_s"] = max(0, int(clean["idle_unload_s"]))
        except Exception:
            clean.pop("idle_unload_s", None)

    if "general_thresh" in clean:
        clean["general_thresh"] = float(clean["general_thresh"])
    if "character_thresh" in clean:
        clean["character_thresh"] = float(clean["character_thresh"])

    if "max_general" in clean:
        clean["max_general"] = max(0, int(clean["max_general"]))
    if "max_character" in clean:
        clean["max_character"] = max(0, int(clean["max_character"]))

    if "model_repo" in clean:
        clean["model_repo"] = str(clean["model_repo"]).strip()

    return clean


async def get_ai_settings() -> dict[str, Any]:
    settings = acol("settings")
    doc = await settings.find_one({"_id": "ai"})
    if not doc:
        await settings.insert_one({"_id": "ai", **DEFAULT_AI_SETTINGS})
        return dict(DEFAULT_AI_SETTINGS)

    merged = dict(DEFAULT_AI_SETTINGS)
    for k, v in doc.items():
        if k == "_id":
            continue
        merged[k] = v
    return merged


async def update_ai_settings(patch: dict[str, Any]) -> dict[str, Any]:
    clean = clean_settings_patch(patch)
    settings = acol("settings")

    # IMPORTANT: MongoDB rejects updates that try to modify the same field in
    # multiple operators (e.g. $set and $setOnInsert). Since DEFAULT_AI_SETTINGS
    # contains all fields, we must omit any keys present in $set from $setOnInsert.
    on_insert_defaults = {
        k: v for k, v in DEFAULT_AI_SETTINGS.items() if k not in clean
    }
    update_doc: dict[str, Any] = {"$setOnInsert": {"_id": "ai", **on_insert_defaults}}
    if clean:
        update_doc["$set"] = clean

    await settings.update_one({"_id": "ai"}, update_doc, upsert=True)

    # Apply runtime knobs immediately.
    if "idle_unload_s" in clean:
        get_tagger_manager().set_idle_unload_s(int(clean["idle_unload_s"]))

    return await get_ai_settings()
