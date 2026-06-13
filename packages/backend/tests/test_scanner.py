"""Unit tests for the pure, high-risk parts of the library scan: id construction,
the upsert op's insert-only tag seeding, and stale reconciliation (which deletes
images that vanished from disk)."""

from pathlib import Path

from src.services import scanner


def test_image_id_for_is_library_prefixed_relative_path():
    root = Path("/data/lib")
    assert scanner.image_id_for("L1", root, root / "a" / "b.jpg") == "L1:a/b.jpg"


def test_upsert_image_op_seeds_tag_state_only_on_insert():
    op = scanner.upsert_image_op({"_id": "L1:x.jpg", "path": "/data/lib/x.jpg"})
    assert op._doc["$setOnInsert"] == {
        "tags": [],
        "has_tags": False,
        "has_ai_tags": False,
    }
    # File metadata is refreshed on every scan; tag-state only seeded on insert.
    assert "path" in op._doc["$set"]
    assert op._upsert is True


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
