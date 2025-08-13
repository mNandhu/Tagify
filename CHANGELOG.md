# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [0.1.0] - 2025-08-13

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
