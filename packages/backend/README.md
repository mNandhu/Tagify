# Tagify Backend (FastAPI + uv)

## Development

- Manage Python deps with uv.
- Run dev server:

```
uv run uvicorn src.main:app --reload --host 127.0.0.1 --port 8000
```

- Env: copy `.env.example` to `.env` and fill values.

## Configuration

Environment variables (see `.env.example`):

- Mongo / AI

  - `MONGO_URI` (default: mongodb://localhost:27017)
  - `AI_TAGGING_URL` optional external tagging endpoint

- MinIO / S3

  - `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_SECURE`
  - `MINIO_BUCKET_THUMBS`, `MINIO_BUCKET_ORIGINALS`

- Scanner

  - `SCANNER_MAX_WORKERS` cap worker threads (0 = auto)

- Media delivery
  - `MEDIA_PRESIGNED_MODE`: `off` | `redirect` | `url` (default: `redirect`)
    - `redirect`: API responds to file/thumb with 307 redirect to a time-limited URL
    - `url`: API responds with JSON `{ "url": "..." }`
    - `off`: API proxies bytes directly
  - `MEDIA_PRESIGNED_EXPIRES`: expiry seconds for pre-signed URLs (default: 3600)

Notes:

- Range requests are honored when clients send `Range` for originals; API proxies with `206 Partial Content`.

## API highlights

- `GET /images` list images

  - Filters: `tags[]=...`, `logic=and|or`, `library_id`, `no_tags=1`
  - Pagination: `limit`, `cursor` (string `_id`) for stable paging by `_id` descending
  - Returns minimal fields for grid: `_id`, `path`, `width`, `height`

- `GET /images/{id}/file`

  - In `redirect` mode: 307 to pre-signed URL
  - In `url` mode: `{ "url": "..." }`
  - In `off` mode: streams content; supports `Range`

- `GET /images/{id}/thumb`

  - Same delivery behavior as `/file`

- `GET /tags`
  - Server-side TTL cache for 30s to avoid heavy aggregations on every request
