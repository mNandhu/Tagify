# Tagify — Domain Context

Glossary of the core domain concepts and the modules that own them. Keep names
here in sync with the code; when a module is named after a concept, the concept
belongs in this file.

## Concepts

- **Library** — a root directory of images registered for indexing. Owns scan
  progress state. (`api/libraries.py`, `models/library.py`)
- **Image** — one indexed file. Id is `{library_id}:{path-relative-to-root}`.
- **Tag** — a label on an image. Three kinds share one `tags` array:
  - **AI tag** — produced by the tagger, stored unprefixed (`1girl`).
  - **Manual tag** — user-applied, stored with a `manual:` prefix.
  - **Prompt tag** — extracted from generation prompts by reprojection, stored
    with a `prompt:` prefix (`prompt:masterpiece`). Owned by reprojection, not the
    user; mirrors `gen.prompt_terms` (which stays the fast search field). AI and
    prompt tags may overlap (e.g. `1girl` and `prompt:1girl` coexist) — they are
    distinct kinds and are never deduped against each other.
- **Tag-state** — the invariant binding `tags` to its summary flags:
  `has_tags` (any *curatable* tag — a non-`prompt:` tag, so prompt-only images
  stay "Untagged"), `has_ai_tags` (any tag that is *neither* `manual:` nor
  `prompt:`), and `has_prompt_tags` (any `prompt:` tag), plus `rating`.
  Owned by `services/image_tags.py` — the single place that mutates tags and
  recomputes the flags, so they can never drift.
- **Rating** — one of `-`, `general`, `sensitive`, `questionable`, `explicit`.
  Normalized in one place (`image_tags.normalize_rating`) and written only
  through `image_tags.set_rating` (with `set_score` / `set_quarantine` for the
  other per-image scalars), so the single-owner rule holds — routers never
  assemble the UPDATE.
- **Scan** — discovering a library's files, indexing them, and **reconciling**
  away images that vanished from disk. (`services/scanner.py`;
  `reconcile_stale` is the pure deletion-decision step.) The scan's batched
  transactional writer is `services/scan_writer.py` (`ScanWriter` — accumulate,
  flush every N, flush the remainder); the bounded-concurrency worker loop is
  `services/batch_pool.py`.
- **Thumbnail** — a WebP render of an image stored on the local filesystem under
  `THUMB_ROOT`. (`services/storage_fs.py`)
- **AI Job** — a queued, cancellable batch tagging unit. (`services/ai_jobs.py`)
- **Tagger / Model** — the WD ONNX model. Load/idle-unload lifecycle and the pure
  inference step `select_tags` live in `services/ai_tagger.py`; model **download**
  (HuggingFace fetch, progress, cancel) is its own dependency-free module
  `services/ai_tagger_download.py` (also home to `model_target`, the one place the
  `(model_repo, cache_dir)` default is resolved). The API's combined model status
  is assembled once by `ai_tagger.model_status_view` so routes don't reach into
  the managers' internals.
- **AI Settings** — persisted tagger knobs; validation is pure
  (`ai_settings.clean_settings_patch`). (`services/ai_settings.py`)
- **Image feed (backend)** — how an Image filter becomes SQL. A `FeedFilter`
  validates its own inputs on construction (`FeedFilterError` → HTTP 422);
  `feed_where` builds the WHERE clause; `list_feed` / `list_groups` run the
  cursor-paged feed and the batch-collapsed grouped view. The feed and grouped
  view share one builder so they can never drift. (`services/image_feed.py`)

## Frontend

- **Image filter** — the criteria selecting which Images the gallery shows:
  tags + match logic (`and`/`or`), library, and the `no_tags`/`no_ai_tags`
  toggles. Its URL round-trip is pure: `parseFilters` / `serializeFilters`
  (`lib/imageFilter.ts`) are the single source of truth, so the URL and the
  query never drift.
- **Image feed** — the cursor-paged stream of Images matching an Image filter.
  One shared query (`hooks/useImageFeed.ts`, TanStack `useInfiniteQuery` keyed
  by the filter); the gallery (`AllImagesPage`) and `ImageView` read the same
  cache, so paging done in one is visible to the other.

## Persistence

- Embedded SQLite (via SQLAlchemy Core), one file, no external database server.
  The schema (tables + indexes) is defined once as a `MetaData` in
  `database/schema.py`; `database/db.py` owns the async (app) and sync (scanner)
  engines and creates the schema on startup. `tags` is an ordered JSON array on
  `images`; `image_tags` / `image_gen_terms` are derived join tables rebuilt
  transactionally to serve grouped/`$in`/`$all` queries.
