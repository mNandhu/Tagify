# Architecture Deepening Plan

Deepening opportunities found in an architecture review (2026-06-15). Goal: turn
shallow modules into deep ones (much behavior behind a small interface) for
testability and AI-navigability.

Glossary: **deep** = much behavior behind small interface; **shallow** = interface
≈ implementation; **deletion test** = does removing a module concentrate
complexity or just move it; **seam** = where behavior can be swapped without
editing in place.

Candidates are ranked by leverage. We work them in order, each as its own loop:
implement → manual review → verify → commit.

---

## 1. Image-feed query module (genuine deepening) — ✅ DONE

**Files:** `api/images.py:47-147` (`_build_feed_where`), `:150-165` (`_FEED_COLS`,
`_attach_thumb_url`), `:168-226` (feed), `:336-421` (groups).

**Problem:** The Image feed is a named domain concept, but its 100-line
WHERE-builder (tag-group fan-out, `any:` expansion, prompt-term `$all`/`$any`,
dimension/model/quarantine logic) is fused with HTTP validation (`raise
HTTPException`) and lives in the router. Untestable without FastAPI; not reusable
by a CLI/export. Feed and groups share it only via 14 positional kwargs passed
twice.

**Solution:** A `services/image_feed.py` taking a validated filter object →
returns rows (+ the group window-query). Router does HTTP validation → filter
object → calls it. Projection / `thumb_url` decoration move with it.

**Benefits:** Small interface (filter → rows) over lots of SQL = depth + leverage.
Filter→WHERE becomes unit-testable. Feed/groups/export can't drift.

## 2. Canonical image-id resolution seam — ✅ DONE

**Files:** `api/images.py:471-480` (`_resolve_id`), `:433-443` (inline in
workflow); `services/image_tags.py:258-268` (`_resolve`), `:271-286`
(`find_image` inline loop); `api/rules.py` preview (inline loop).

**Problem:** `_id` lookups normalize `/` vs `\`. The pure part (`id_variants`) is
already shared, but the resolve-against-DB loop is re-derived 5×. No module owns
"given any id spelling, return the stored `_id`."

**Deletion test:** the loop is smeared across 5 callers; one module concentrates
it.

**Solution:** One `resolve_image_id(conn, id)` in `image_tags` (home of
`id_variants`); all callers delegate.

**Benefits:** Locality (slash fix touches one place); leverage.

## 3. Single-image mutation ownership (restores a stated invariant) — ✅ DONE

**Files:** `api/images.py:483-528` (rating/score/quarantine — 3 near-identical
resolve+update+return); `services/image_tags.py:310-370` (repo read-modify-write
repeated 3×).

**Problem:** CONTEXT.md: `image_tags` is the only place that mutates tag-state,
`rating` included. But `set_image_rating` writes `rating` via raw `sa.update` in
the router — and there's no rating setter in `image_tags` to call.
Score/quarantine likewise raw in the router. Separately,
`apply_manual`/`remove_tags`/`replace_ai` each repeat
resolve→fetch-tags→transform→persist.

**Solution:** Give `image_tags` the scalar setters (or a `mutate(image_id, fn,
extra)` higher-order helper) so all single-image writes pass through the one
owner; router just validates.

**Benefits:** Restores the documented single-owner seam; collapses 3 shallow
endpoints + 3 repeated orchestrations.

## 4. Scanner orchestration (extracted pure fn, untested orchestration)

**Files:** `services/scanner.py:354-588` (`_run` closure), pure
`reconcile_stale:225-241`.

**Problem:** The pure deletion-decision was extracted for testability — but the
real bugs live in the untested 230-line orchestration: threadpool queue,
batch-flush threshold, scattered cancel checks, stale+thumb cleanup, progress
writes. No test seam on the risky part.

**Solution:** Extract the batched walk→process→flush loop into a testable unit
(inject per-file work + flush sink) so cancel/batch/flush is exercisable without
a real FS+DB.

**Benefits:** Test surface moves to where the bugs are.

## 5. AI tagger subsystem (two sub-seams)

**Files:** `services/ai_tagger.py` (766 lines), `api/ai.py:55-74` (status).

**Problem:** (a) `ai_tagger.py` glues three modules: model download manager,
ONNX inference (`WDTagger`/`select_tags`), and lifecycle (`TaggerManager`).
Testing pure `select_tags` drags in onnxruntime+httpx. The download manager is
cleanly separable. (b) `/ai/status` reaches into all three managers' internal
shapes — mirrors internals, not a contract.

**Solution:** Split the download manager into its own module; status route
consumes a single assembled view object.

**Benefits:** Pure inference testable in isolation; status route stops breaking
on internal shape changes.

## 6. Frontend: shared API + consistent seams (locality/DRY, not depth)

**Files:** 5 pages each define their own `api<T>()` (`AllImagesPage`,
`LibrariesPage`, `AITaggingPage`, `OverviewPage`, `TagsPage`); `lib/gen.ts` has
private `getJson`/`postJson` not exported; query keys hand-written as
`["images"]` while `imageFeedKey()` exists unused; `AllImagesPage` raw-fetches
`/api/ai/tag` though `useAiTagging` already wraps that seam.

**Solution:** Export one typed client; route invalidation through
`imageFeedKey()`; make `AllImagesPage` use the existing `useAiTagging` adapter.

**Benefits:** One adapter per concern instead of N; kills drift.

## 7. Frontend: strand pure logic + state out of the monster pages

**Files:** `pages/ImageView.tsx` (1028), `pages/AllImagesPage.tsx` (820).

**Problem:** Pure logic inline in components, against the convention (pure →
`lib/` with tests): `pickRating`, `ratingBadgeClass`, `formatTag`, tag
partitioning, `hasActiveFilter`; `isFormField` copy-pasted 3×.
Selection/`selectionMode`/`focusedIndex` inline `useState`, no hook, no tests.

**Solution:** Move pure helpers to `lib/` with colocated tests; extract
`useSelectionMode` / `useGridFocus`.

**Benefits:** Test surface = the interface; the monster pages shrink toward thin
orchestration.

---

## Side note

CONTEXT.md was stale: Thumbnail said "stored in MinIO (`storage_minio.py`)" but
storage is FS (`storage_fs.py`). Fixed alongside this work.
</content>
</invoke>
