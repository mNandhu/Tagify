# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [0.1.0] - 2025-08-13

### Added

- Image View
  - Full-screen image view refinements: icon-only overlays (Back, Info), slide-in info panel, distinct surface, image fade-in, and neighbor preloading.
  - Back action returns to gallery with filters preserved.
  - Info toggle shows as overlay when closed and as X inside the panel when open.
- Libraries
  - Shows indexed_count and last_scanned in cards.
  - Rescan now runs in background (non-blocking) with per-library progress tracking and a new progress endpoint.
  - Frontend polls progress only while scanning and displays a progress bar; hides “n indexed” while scanning.
  - Inline edit modal for name/path with optional rescan.
- Backend
  - Multithreaded scanner with ThreadPoolExecutor; progress fields: scanning, scan_total, scan_done, scan_error, last_scanned, indexed_count.
  - New GET /libraries/{id}/progress for UI polling.

### Changed

- Avoids excessive polling by limiting to scanning libraries and stopping when complete.

### Notes

- Virtualized masonry for the gallery is planned next.

### Added

- Monorepo structure using pnpm workspaces: `packages/frontend`, `packages/backend`, and shared `.thumbs/` directory.
- Root configuration: `.gitignore`, `pnpm-workspace.yaml`, root `package.json` scripts for backend dev.
- Backend (FastAPI + uv):
  - `pyproject.toml` with dependencies: `fastapi[standard]`, `uvicorn`, `pymongo`, `pillow`, `python-dotenv`.
  - FastAPI app with CORS for Vite, `/health` endpoint, and static `/thumbs` mount serving repo `.thumbs/`.
  - Placeholder API routers: `libraries`, `images`, `tags`.
  - `.env.example` and config loader (`src/core/config.py`).
- Frontend (Vite + React + TypeScript + Tailwind):
  - Vite config with proxy from `/api` to backend.
  - Strict `tsconfig.json`, Tailwind and PostCSS configs, scaffolded React app that pings `/api/health`.
  - `.env.local.example`.

### Notes

- Backend verified locally: `/health` returns `{ "status": "ok" }`.
- Frontend requires pnpm to install and run dev server.

[0.1.0]: https://example.com/tagify/releases/0.1.0
