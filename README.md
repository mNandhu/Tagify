# Tagify Monorepo

MinIO buckets:

- tagify-thumbs: generated thumbnails (JPEG)
- tagify-originals: original images

See .github/prompts/tech_guide.md for architecture details. - FastAPI app with CORS for Vite, `/health` endpoint. Images are streamed from MinIO via `/images/:id/file` and `/images/:id/thumb`.
