# Tagify Frontend (Vite + React + TS)

Install pnpm first: https://pnpm.io/installation

Then install and run:

- pnpm install
- pnpm dev

The dev server proxies /api to the backend at http://127.0.0.1:8000.

## Features

- Pre-signed media support

  - The UI follows backend `MEDIA_PRESIGNED_MODE` automatically.
  - `redirect` mode: the browser follows 307 redirects transparently.
  - `url` mode: the UI resolves `{ url }` from API and uses it for <img>.

- Cursor-based pagination

  - Gallery uses `_id` cursor for stable infinite scroll.
  - The current `cursor` is preserved in deep-links to the image view and back.

- Stable gallery layout
  - Thumbnails reserve space using known width/height to avoid reshuffling during loads.
