# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tagify is a pnpm monorepo for organizing AI-generated images. FastAPI backend (Python 3.11+, MongoDB for metadata, local filesystem for thumbnail + original storage, WD ONNX model for AI tagging) + Vite/React/TypeScript frontend. Frontend talks to backend via REST; the Vite dev server proxies `/api/*` → `http://127.0.0.1:8000` (stripping `/api`).

## Commands

Run from repo root unless noted.

```bash
pnpm install                 # install frontend deps (backend uses uv, see below)
docker compose -f docker-compose.dev.yml up -d   # start MongoDB dep
pnpm dev                     # backend (uvicorn :8000, --reload) + frontend (vite :5173) together
pnpm perf                    # backend perf benchmark

# Backend (Python via uv — never call `python` directly)
uv --directory packages/backend sync                # install deps
uv --directory packages/backend run uvicorn src.main:app --reload   # backend only
uv --directory packages/backend run pytest          # all backend tests
uv --directory packages/backend run pytest tests/test_scanner.py::test_name   # single test

# Frontend (from packages/frontend)
pnpm test                    # vitest run (one-shot)
pnpm test:watch              # vitest watch
pnpm -C packages/frontend test src/lib/fuzzy.test.ts   # single test file
pnpm -C packages/frontend build   # tsc -b && vite build
```

Backend needs `packages/backend/.env` (MONGO_URI, optional THUMB_ROOT — defaults to `<repo>/data/thumbs`). Settings load from repo-root `.env` then `packages/backend/.env` (`src/core/config.py`). CI (`.github/workflows/ci.yml`) runs the full stack via `docker-compose.ci.yml` and exercises scan + media endpoints with curl — there is no unit-test step in CI.

## Domain model

**Read `CONTEXT.md` first** — it is the authoritative glossary for Library, Image, the three tag kinds, Tag-state, Rating, Scan, AI Job, Tagger. Key invariants that constrain edits:

- **Image `_id` is `{library_id}:{relative/path}`.** ID lookups normalize `/` vs `\` (`api/images.py` `_find_image_doc`).
- **One `tags[]` array holds three tag kinds:** AI tags unprefixed (`1girl`), manual tags `manual:`-prefixed, prompt tags `prompt:`-prefixed. AI and prompt tags may overlap and are never deduped against each other.
- **`services/image_tags.py` is the ONLY place that mutates `tags` and recomputes the summary flags** (`has_tags`, `has_ai_tags`, `has_prompt_tags`, `rating`). Mutating tags anywhere else will drift the flags. `normalize_rating` is the single rating normalizer.
- **Mongo indexes/connection are defined once in `database/schema.py`;** `mongo.py` (sync) and `motor.py` (async) are thin wrappers. Indexes are ensured on startup (`ensure_indexes_async` in `main.py` lifespan), which also backfills new flag fields onto older docs.

## Backend layout

`src/api/` routers (libraries, images, tags, ai, rules) mounted in `main.py` under matching prefixes. `src/services/` holds the logic: `scanner.py` (multithreaded walk → write thumb to FS → upsert + library progress), `storage_fs.py` (thumbnail FS keys/paths under `THUMB_ROOT`, atomic writes, traversal guard, `delete_by_prefix`), `ai_jobs.py` (queued cancellable batch tagging worker, started in lifespan), `ai_tagger.py` (WD ONNX model lifecycle vs pure `select_tags` inference), `ai_settings.py`, `reproject.py` (prompt-tag extraction), `image_tags.py`, `blurhash.py`.

**Media delivery** streams everything from the local filesystem through the API: thumbnails via `FileResponse` from `THUMB_ROOT`, originals via `FileResponse` from their on-disk library path. Originals support Range requests; both thumb and original have HEAD endpoints. New media endpoints should serve from the FS with a HEAD counterpart. A single exposed port covers remote access; front with nginx for TLS/static offload (see `deploy/nginx.conf.example`).

## Frontend layout

- **`lib/imageFilter.ts`** (`parseFilters`/`serializeFilters`) is the single source of truth for the gallery filter ⇄ URL round-trip — keep URL and query key in sync through it.
- **`hooks/useImageFeed.ts`** — one shared TanStack `useInfiniteQuery` keyed by the filter; `AllImagesPage` and `ImageView` read the same cache (cursor-paged by `_id` desc), so paging in one is visible in the other.
- **`lib/media.ts`** lazily resolves a media URL; with FS-backed thumbnails it is effectively a passthrough (the HEAD probe detects a plain image response and returns the endpoint as-is). Kept for future modes that need a per-tile resolve.
- Pure logic lives in `lib/` with colocated `*.test.ts` (fuzzy, gen, gridNav, masonryLayout, imageFilter, ai). Prefer adding pure functions there with tests over logic inside components.
- `components/VirtualizedGrid.tsx` + `masonryLayout.ts` compute row spans from width/height for a stable, reflow-free grid.

## Gotchas

- Use DB helpers (`col()`/`get_db()` sync, `acol()` async) — don't open connections ad hoc.
- Keep list responses minimal via Mongo projections; return full docs only when needed.
- `tags` GET aggregation is cached with a ~30s TTL — clear it after mutating tags.
- In `content-visibility:auto` is a known paint-gap hazard in the virtualized grid (see project memory); avoid reintroducing it.
