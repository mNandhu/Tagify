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
  Normalized in one place (`image_tags.normalize_rating`).
- **Scan** — discovering a library's files, indexing them, and **reconciling**
  away images that vanished from disk. (`services/scanner.py`;
  `reconcile_stale` is the pure deletion-decision step.)
- **Thumbnail** — a WebP render of an image stored in MinIO. (`storage_minio.py`)
- **AI Job** — a queued, cancellable batch tagging unit. (`services/ai_jobs.py`)
- **Tagger / Model** — the WD ONNX model. Lifecycle (download/load/idle-unload)
  is separate from the pure inference step `select_tags`. (`services/ai_tagger.py`)
- **AI Settings** — persisted tagger knobs; validation is pure
  (`ai_settings.clean_settings_patch`). (`services/ai_settings.py`)

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
