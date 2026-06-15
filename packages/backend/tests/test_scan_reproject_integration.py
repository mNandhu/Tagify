"""End-to-end integration for the two highest-risk write subsystems that the
other tests stub past: a real disk scan (sync, multithreaded → SQLite) and
reprojection (the sole writer of the promoted gen_* columns + image_gen_terms +
prompt: tags). Without these, the model/pterms feed filters would be unverified."""

import time

import pytest
import sqlalchemy as sa
from PIL import Image
from PIL.PngImagePlugin import PngInfo

from src.database import db
from src.database import schema as t
from src.services import reproject, scanner

pytestmark = pytest.mark.asyncio


def _write_png(path, **text_chunks):
    meta = PngInfo()
    for k, v in text_chunks.items():
        meta.add_text(k, v)
    Image.new("RGB", (8, 8)).save(path, "PNG", pnginfo=meta)


async def _img(image_id):
    async with db.async_conn() as conn:
        return (
            await conn.execute(sa.select(t.images).where(t.images.c._id == image_id))
        ).first()


# --- reprojection (sync, direct) ---------------------------------------------


async def test_reproject_writes_gen_columns_terms_and_prompt_tags(temp_db, seed):
    image_id = "L1:art.png"
    seed(image_id, tags=("1girl",))  # existing AI tag must survive reprojection
    # Stash the captured raw the scanner would have written.
    with db.sync_tx() as conn:
        conn.execute(
            sa.insert(t.image_gen_raw).values(
                _id=image_id,
                library_id="L1",
                workflow_sig=None,
                raw={
                    "source": "a1111",
                    "parameters": "masterpiece, 1girl\nSteps: 20, Model: sdxl, Seed: 7",
                },
            )
        )

    updated = reproject.reproject_library("L1")
    assert updated == 1

    row = await _img(image_id)
    # Promoted gen.* columns the feed filters read (the ONLY writer is reproject).
    assert row.gen_model == "sdxl"
    assert row.gen_prompt is not None
    assert row.gen is not None
    # Derived prompt-term rows (the pterms filter source).
    async with db.async_conn() as conn:
        terms = {
            r.term
            for r in (
                await conn.execute(
                    sa.select(t.image_gen_terms.c.term).where(
                        t.image_gen_terms.c.image_id == image_id
                    )
                )
            ).fetchall()
        }
    assert terms  # non-empty; tokens extracted from the prompt
    # prompt: tags mirrored into the tag array, AI tag preserved, flags resynced.
    assert "1girl" in row.tags
    assert any(tag.startswith("prompt:") for tag in row.tags)
    assert row.has_ai_tags is True
    assert row.has_prompt_tags is True


async def test_reproject_model_filter_works_after_real_reprojection(client, seed):
    image_id = "L1:art.png"
    seed(image_id)
    with db.sync_tx() as conn:
        conn.execute(
            sa.insert(t.image_gen_raw).values(
                _id=image_id,
                library_id="L1",
                workflow_sig=None,
                raw={
                    "source": "a1111",
                    "parameters": "a cat\nSteps: 20, Model: pony, Seed: 1",
                },
            )
        )
    reproject.reproject_library("L1")

    # The model filter (reads gen_model) now returns the image — end to end.
    resp = await client.get("/images", params={"model": "pony"})
    assert [it["_id"] for it in resp.json()] == [image_id]


# --- full disk scan (sync, multithreaded) ------------------------------------


def _wait_scan(library_id: str, timeout: float = 20.0) -> None:
    th = scanner._scan_threads.get(library_id)
    if th is not None:
        th.join(timeout=timeout)
    # Belt-and-suspenders: also wait for the scanning flag to clear.
    deadline = time.time() + timeout
    while time.time() < deadline:
        with db.sync_conn() as conn:
            scanning = (
                conn.execute(
                    sa.select(t.libraries.c.scanning).where(
                        t.libraries.c._id == library_id
                    )
                )
            ).scalar()
        if not scanning:
            return
        time.sleep(0.05)


async def test_full_scan_indexes_images_and_rescan_preserves_tag_state(
    client, tmp_path
):
    lib_dir = tmp_path / "lib"
    lib_dir.mkdir()
    _write_png(lib_dir / "plain.png")
    _write_png(
        lib_dir / "gen.png",
        parameters="masterpiece\nSteps: 20, Model: sdxl",
    )

    # Add the library through the API — this kicks off the real background scan.
    resp = await client.post("/libraries", json={"path": str(lib_dir)})
    assert resp.status_code == 200, resp.text
    lib_id = resp.json()["_id"]
    _wait_scan(lib_id)

    # Both files indexed, with insert-time tag-state seeded.
    feed = await client.get("/images", params={"library_id": lib_id})
    ids = {it["_id"] for it in feed.json()}
    assert ids == {f"{lib_id}:plain.png", f"{lib_id}:gen.png"}

    target = f"{lib_id}:plain.png"
    row = await _img(target)
    assert row.thumb_key is not None  # thumbnail written to FS
    assert row.has_tags is False  # fresh: no curatable tags yet

    # Simulate curation, then rescan: ON CONFLICT must NOT reset the manual tag.
    await client.post(f"/tags/apply/{target}", json=["keeper"])
    await client.post(f"/libraries/{lib_id}/rescan")
    _wait_scan(lib_id)

    row = await _img(target)
    assert "manual:keeper" in row.tags  # survived the rescan upsert
    assert row.has_tags is True
