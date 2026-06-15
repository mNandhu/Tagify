"""Unit tests for the pure, high-risk parts of the library scan: id construction,
the upsert op's insert-only tag seeding, and stale reconciliation (which deletes
images that vanished from disk)."""

import io
import json
from pathlib import Path

from PIL import Image
from PIL.PngImagePlugin import PngInfo

from src.services import scanner

_COMFY = {
    "3": {"class_type": "KSampler", "inputs": {"positive": ["6", 0]}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "a fox"}},
}
_A1111 = "a prompt\nSteps: 20, Seed: 7"


def _png_with(**text_chunks: str) -> Image.Image:
    meta = PngInfo()
    for k, v in text_chunks.items():
        meta.add_text(k, v)
    buf = io.BytesIO()
    Image.new("RGB", (8, 8)).save(buf, "PNG", pnginfo=meta)
    buf.seek(0)
    return Image.open(buf)


def test_read_gen_raw_comfyui_png_parses_chunks():
    with _png_with(prompt=json.dumps(_COMFY), workflow=json.dumps({"nodes": []})) as im:
        raw = scanner._read_gen_raw(im)
    assert raw is not None
    assert raw["source"] == "comfyui"
    assert raw["prompt"] == _COMFY  # round-tripped from the text chunk
    assert raw["workflow"] == {"nodes": []}


def test_read_gen_raw_a1111_png():
    with _png_with(parameters=_A1111) as im:
        raw = scanner._read_gen_raw(im)
    assert raw == {"source": "a1111", "parameters": _A1111}


def test_read_gen_raw_none_when_no_metadata():
    with _png_with() as im:
        assert scanner._read_gen_raw(im) is None


def test_image_id_for_is_library_prefixed_relative_path():
    root = Path("/data/lib")
    assert scanner.image_id_for("L1", root, root / "a" / "b.jpg") == "L1:a/b.jpg"


def test_image_upsert_values_merges_initial_tag_state():
    vals = scanner.image_upsert_values({"_id": "L1:x.jpg", "path": "/data/lib/x.jpg"})
    # Scanner file-metadata is carried through.
    assert vals["_id"] == "L1:x.jpg"
    assert vals["path"] == "/data/lib/x.jpg"
    # Initial tag-state is seeded into the insert payload (the ON CONFLICT clause
    # leaves these columns untouched on update — verified by an integration test).
    assert vals["tags"] == []
    assert vals["has_tags"] is False
    assert vals["has_ai_tags"] is False
    assert vals["has_prompt_tags"] is False
    assert vals["quarantined"] is False
    assert vals["score"] == 0


def test_gen_raw_values_splits_into_row_shape():
    row = scanner._gen_raw_values(
        {
            "_id": "L1:x.jpg",
            "library_id": "L1",
            "workflow_sig": "sig1",
            "source": "comfyui",
            "prompt": {"a": 1},
        }
    )
    assert row["_id"] == "L1:x.jpg"
    assert row["library_id"] == "L1"
    assert row["workflow_sig"] == "sig1"
    # The variable per-source payload lands in `raw`, sans the promoted keys.
    assert row["raw"] == {"source": "comfyui", "prompt": {"a": 1}}


def test_reconcile_stale_flags_only_undiscovered_images():
    existing = [
        {"_id": "L1:keep.jpg", "thumb_key": "L1/keep.webp"},
        {"_id": "L1:gone.jpg", "thumb_key": "L1/gone.webp"},
        {"_id": "L1:gone_nothumb.jpg"},
    ]
    discovered = {"L1:keep.jpg"}
    stale_ids, stale_thumbs = scanner.reconcile_stale(discovered, existing)
    assert set(stale_ids) == {"L1:gone.jpg", "L1:gone_nothumb.jpg"}
    # Only the thumb key that exists is queued for cleanup
    assert stale_thumbs == ["L1/gone.webp"]


def test_reconcile_stale_keeps_everything_when_all_discovered():
    existing = [{"_id": "L1:a.jpg"}, {"_id": "L1:b.jpg"}]
    discovered = {"L1:a.jpg", "L1:b.jpg"}
    assert scanner.reconcile_stale(discovered, existing) == ([], [])
