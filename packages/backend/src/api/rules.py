"""User extraction rules: per-workflow-signature rulesets that pin dot-paths for
generation fields. Rulesets are sig-global (not per-library); editing one
reprojects every image of that signature across all libraries.

See CONTEXT.md › Generation metadata, and plan-aiArtEnhancements-v2.md.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database.motor import acol
from ..services import gen_metadata
from ..services.image_tags import id_variants

router = APIRouter()


class RulesetBody(BaseModel):
    fields: dict[str, list[str]] = {}


class PreviewBody(BaseModel):
    sample_image_id: str
    fields: dict[str, list[str]] = {}


@router.get("")
async def list_rulesets():
    docs = await acol("gen_rulesets").find({}).to_list(length=10000)
    return docs


@router.get("/signatures")
async def list_signatures(q: str | None = None):
    """Workflow signatures seen in the library, with image counts, how many still
    need mapping, a sample image to author against, and whether a ruleset exists.
    Drives the authoring UI's signature picker.

    ``q`` (optional) narrows the list to signatures whose raw embedded metadata
    contains the term — so a user who remembers a prompt word (``masterpiece``)
    can find the otherwise-opaque signature hash to map. We search the *raw* doc,
    not ``gen.prompt_terms``: an unmapped custom workflow (the whole reason this
    page exists) has ``gen.prompt = None`` and empty terms, so the keyword only
    survives in the raw graph. Counts stay whole-signature; the sample image is
    swapped to one that actually matched so the authoring graph shows the term.
    """
    pipeline = [
        {"$match": {"gen.workflow_sig": {"$ne": None}}},
        {
            "$group": {
                "_id": "$gen.workflow_sig",
                "count": {"$sum": 1},
                "needs_mapping": {
                    "$sum": {
                        "$cond": [
                            {"$eq": [{"$ifNull": ["$gen.prompt", None]}, None]},
                            1,
                            0,
                        ]
                    }
                },
                "sample_image_id": {"$first": "$_id"},
            }
        },
        {"$sort": {"needs_mapping": -1, "count": -1}},
    ]
    rows = await acol("images").aggregate(pipeline).to_list(length=10000)

    term = (q or "").strip()
    if term:
        # Map each signature's images to itself, then scan their raw docs for the
        # term. Stream raws (one at a time) and stop a signature as soon as one of
        # its images matches — bounded by distinct signatures, not library size,
        # since this is an authoring page and the raw graphs are large.
        sig_by_img = {
            d["_id"]: d["gen"]["workflow_sig"]
            async for d in acol("images").find(
                {"gen.workflow_sig": {"$ne": None}}, {"gen.workflow_sig": 1}
            )
        }
        want = {r["_id"] for r in rows}
        sample_by_sig: dict[str, str] = {}
        async for raw in acol("image_gen_raw").find(
            {}, {"prompt": 1, "workflow": 1, "parameters": 1}
        ):
            sig = sig_by_img.get(raw["_id"])
            if sig is None or sig not in want or sig in sample_by_sig:
                continue
            if gen_metadata.raw_matches_term(raw, term):
                sample_by_sig[sig] = raw["_id"]
                if len(sample_by_sig) == len(want):
                    break
        rows = [r for r in rows if r["_id"] in sample_by_sig]
        for r in rows:
            r["sample_image_id"] = sample_by_sig[r["_id"]]

    mapped = {
        d["_id"]
        for d in await acol("gen_rulesets").find({}, {"_id": 1}).to_list(length=10000)
    }
    for r in rows:
        r["workflow_sig"] = r.pop("_id")
        r["has_ruleset"] = r["workflow_sig"] in mapped
    return rows


@router.get("/{sig}")
async def get_ruleset(sig: str):
    doc = await acol("gen_rulesets").find_one({"_id": sig})
    if not doc:
        # A signature with no ruleset yet — return an empty editable shell.
        return {"_id": sig, "fields": {}}
    return doc


@router.put("/{sig}")
async def put_ruleset(sig: str, body: RulesetBody):
    fields = gen_metadata.clean_rule_fields(body.fields)
    doc = {"_id": sig, "fields": fields, "updated_at": time.time()}
    await acol("gen_rulesets").replace_one({"_id": sig}, doc, upsert=True)
    # Re-derive gen.* for every image of this signature (sig-global).
    from ..services.reproject import reproject_by_sig_async

    reproject_by_sig_async(sig)
    return doc


@router.delete("/{sig}")
async def delete_ruleset(sig: str):
    await acol("gen_rulesets").delete_one({"_id": sig})
    from ..services.reproject import reproject_by_sig_async

    reproject_by_sig_async(sig)
    return {"deleted": sig}


@router.post("/preview")
async def preview_ruleset(body: PreviewBody):
    """Resolve candidate rules against one sample image's raw, without saving.

    Returns the final ``gen`` (== what reproject would write) plus per-path
    resolution so the UI can show whether each pin fired."""
    raw = await acol("image_gen_raw").find_one({"_id": body.sample_image_id})
    if not raw:
        for alt in id_variants(body.sample_image_id):
            raw = await acol("image_gen_raw").find_one({"_id": alt})
            if raw:
                break
    if not raw:
        raise HTTPException(status_code=404, detail="No generation data for image")

    fields = gen_metadata.clean_rule_fields(body.fields)
    gen = gen_metadata.extract(raw, {"fields": fields})
    paths = gen_metadata.resolve_ruleset_paths(raw, fields)
    return {"gen": gen, "paths": paths}
