# TODO

A living checklist of work items for Tagify. Priorities: P0 (now), P1 (next), P2 (later).

## Status snapshot

- Core: Monorepo scaffolded (frontend + backend) [Done]
- Backend: FastAPI app with CORS, /health, Mongo wired, scanning service, tags API (incl. AI placeholder), thumbnails served [Done]
- Frontend: Vite + React + TS + Tailwind scaffolded, basic health check view [Done]
- Dev UX: pnpm configured, concurrently one-command dev [Done]

## P0 — Short-term deliverables

- Libraries UI
  - Add library form (path, name) and list existing libraries [Frontend]
  - Trigger rescan, show indexed count/progress [Frontend]
- Gallery views
  - All Images grid (virtualized), show thumbnails from `/thumbs` [Frontend]
  - Per-library image view [Frontend]
- Image details & tags
  - Side panel or modal with image metadata and tags [Frontend]
  - Add/remove tags on image(s) [Frontend -> /tags]
  - Batch selection and batch tag add/remove [Frontend + Backend (already supports per-image; batch endpoint TBD)]
- Search & filters
  - Search bar with tag chips; AND/OR logic [Frontend]
  - “No tags” filter [Frontend + Backend (query tags: [])]
- Scanner robustness
  - Handle inaccessible paths and corrupt images gracefully [Backend]
  - Option to skip very large images or unsupported formats [Backend]
- Basic auth/config
  - Configuration page for AI_TAGGING_URL and MONGO settings (read-only if env-based) [Frontend]

## P1 — Next improvements

- Async/background scanning
  - Move scanning to background jobs; add progress endpoints [Backend]
  - UI progress bar and cancel/resume [Frontend]
- AI tagging workflow
  - Preview suggested tags > accept/reject before apply [Frontend]
  - Batch AI tagging (selected images) [Frontend/Backend]
- Tag management
  - Tags browser (top tags with counts) and drill-down [Frontend]
  - Rename/merge tags (migration) [Backend]
- Thumbnail pipeline
  - On-demand thumb regeneration and size presets [Backend]
  - Blurhash or low-quality placeholder while loading [Frontend]
- Error handling & UX
  - Global toasts, retry flows, nicer error pages [Frontend]
  - Structured error responses [Backend]

## P2 — Later / nice-to-have

- Workflow data parsing (ComfyUI metadata extraction) [Backend]
- Drag & drop image import / link external folders [Frontend]
- User accounts and roles (local) [Full stack]
- Export/import database (backup/restore) [Backend]
- Dark/light themes + polished UI library adoption (shadcn) [Frontend]
- Packaging: Docker Compose for Mongo + API + Frontend [Infra]

## Technical debt & chores

- Tests
  - Backend: unit tests for scanner, tags, images, routers
  - Frontend: component tests for gallery, tags, search
- Lint/format tooling
  - Backend: Ruff + mypy (optional)
  - Frontend: ESLint + Prettier
- CI
  - Lint + test on PRs; build previews
- Docs
  - API reference (OpenAPI is available via FastAPI docs)

## Acceptance notes / definitions of done

- Scanning: can index a directory with 10k images without crashing; metadata visible and searchable; thumbnails generated and served.
- Tagging: can add/remove tags individually and in batch; AI suggestions can be previewed and applied.
- Gallery: smooth scroll with virtualization; search returns results < 200ms on indexed set (local).

Testing note

- Filters: Defer full verification of tag-based filters until a UI to add tags exists; add sample tags via API or UI before testing combinations (AND/OR, library filter, and no-tags).

## Open questions / decisions pending

- Where to store user preferences (localStorage vs DB)?
- Will AI tagging endpoint return confidence scores? If so, UI should surface confidence.
- Pagination strategy for images (offset vs cursor) and server response shape.
