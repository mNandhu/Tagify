# Tagify

**AI-generated image management made simple.**

Tagify is purpose-built for organizing and exploring large collections of AI-generated images from ComfyUI and other AI art tools. Use powerful tag-based organization with optional AI autotagging to keep your diffusion models and generated artwork easily discoverable.

![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Python](https://img.shields.io/badge/python-3.12-blue)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue)

> [!NOTE]
> This is a work in progress and not all features are implemented yet.
> See the [ROADMAP](ROADMAP.md) for planned features.
> I'm pretty much working on this in my spare time, so don't expect rapid progress.

## ✨ Features

- **🎨 AI Art Focused**: Optimized for AI-generated image workflows; extracts generation metadata (prompts, model, workflow) from ComfyUI/A1111 PNGs
- **🤖 Built-in Autotagger**: Local WD ONNX tagger (`SmilingWolf/wd-vit-tagger-v3` by default) with a queued, cancellable batch job system — no external service required
- **🏷️ Smart Tagging**: Manual tags, AI tags, and prompt tags (derived from generation prompts)
- **⭐ Rate & Curate**: 0–5 star quality scores, danbooru-style content ratings, and quarantine to hide images from the feed without deleting them
- **📁 Library Management**: Organize images into libraries with automatic background scanning and progress tracking
- **🔍 Powerful Search**: Filter by tags, libraries, untagged, or no-AI-tags with AND/OR logic
- **⚡ Fast Performance**: Cursor-based pagination, virtualized masonry grid, and pre-signed URL delivery
- **🖼️ Gallery Views**: Responsive masonry grid with full-screen image viewer
- **🐳 Docker Ready**: Complete Docker Compose setup for easy deployment

## 📸 Screenshots

### All Images Gallery

![Gallery View](docs/images/AllImagesPage.jpeg)

### Libraries Management

![Libraries Page](docs/images/LibrariesPage.jpeg)

### Image Detail View

![Image Detail](docs/images/ImageDetailView.jpeg)

## 🚀 Quick Start

### Docker Compose (Recommended)

The fastest way to get Tagify running:

```bash
# Clone the repository
git clone https://github.com/mNandhu/Tagify.git
cd Tagify

# Copy environment configuration
cp .env.example .env

# Start all services
docker compose up --build
```

> [!WARNING]
>
> You must mount host image directories into the backend service via `docker-compose.override.yml` so the backend can access libraries on the host. Edit the `backend` service `volumes` section, for example:
>
> ```yaml
> services:
>   backend:
>     volumes:
>       - /absolute/path/to/your/images:/data/libraries
>       - ./packages/backend:/app
> ```
>
> Use absolute host paths and verify file permissions.

**Access Points:**

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **MinIO Console**: http://localhost:9001 (admin:password123)
- **Health Check**: http://localhost:8000/health

### Hybrid Development (Recommended for Development)

For faster iteration during development:

```bash
# Start only MongoDB and MinIO with Docker
docker compose -f docker-compose.dev.yml up -d

# Install dependencies and run locally
pnpm install
pnpm dev
```

This approach gives you containerized dependencies with fast local code reloading.

## 📦 Installation & Setup

### Prerequisites

- **Node.js** 18+ and **pnpm** ([installation guide](https://pnpm.io/installation))
- **Python** 3.12+ and **uv** ([installation guide](https://docs.astral.sh/uv/getting-started/installation/))
- **MongoDB** (local or Docker)
- **MinIO** (local or Docker)

### Local Development Setup

1. **Clone and install dependencies:**

   ```bash
   git clone https://github.com/mNandhu/Tagify.git
   cd Tagify
   pnpm install
   ```

2. **Set up environment configuration:**

   ```bash
   cp .env.example .env
   # Edit .env if needed for custom MongoDB/MinIO settings
   ```

3. **Start dependencies with Docker:**

   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

4. **Configure backend environment**

   Create and edit the file packages/backend/.env and set the following environment variables (adjust values as needed):

   ```env
   MONGO_URI=mongodb://admin:password@localhost:27017/tagify?authSource=admin
   MINIO_ENDPOINT=localhost:9000
   MINIO_ACCESS_KEY=admin
   MINIO_SECRET_KEY=password123
   MINIO_SECURE=false
   MEDIA_PRESIGNED_MODE=redirect
   ```

5. **Start the application:**
   ```bash
   pnpm dev
   ```

### Adding Your First Library

1. Navigate to http://localhost:5173/libraries
2. Enter your image folder path (e.g., `/path/to/your/images`)
3. Give it a name and click "Add Library"
4. Wait for the scanning to complete
5. Browse your images at http://localhost:5173

## 🏗 Architecture

- **Backend**: FastAPI app with MongoDB for metadata, MinIO for thumbnail storage (originals stay on the host filesystem)
- **Frontend**: Vite + React + TypeScript with TailwindCSS
- **Storage**:
  - MongoDB: Image metadata, tags, library information
  - Original images: served directly from the host filesystem (the library paths you mount); never copied into object storage
  - MinIO: WebP thumbnails only (single `tagify-thumbs` bucket)

## 🤖 AI Autotagger

Tagify ships with a **built-in** autotagger — a WD ONNX model that runs locally via `onnxruntime`. No external service is required. The default model is `SmilingWolf/wd-vit-tagger-v3`, downloaded from HuggingFace on first use and cached locally.

**How it works:**

1. Configure the model and thresholds on the Settings page (or via `POST /ai/settings`).
2. Load the model (`POST /ai/model/load`) — download and load are tracked, cancellable, and the model idle-unloads to free memory.
3. Tag a single image, or queue a batch (e.g. all untagged images) via the AI job system (`POST /ai/tag`, `POST /ai/tag-untagged`). Jobs are listed, polled, and cancellable (`GET /ai/jobs`, `POST /ai/jobs/{id}/cancel`).
4. AI tags are stored alongside manual and prompt tags and become searchable.

**Tag kinds** (all share one `tags` array, see [CONTEXT.md](CONTEXT.md)):

- **AI tags** — produced by the tagger, stored unprefixed (`1girl`).
- **Manual tags** — user-applied, `manual:` prefix.
- **Prompt tags** — extracted from generation prompts by reprojection, `prompt:` prefix.

Tuning knobs (model repo, general/character thresholds, idle-unload timeout, prompt-tag reprojection) live in AI Settings. The legacy `AI_TAGGING_URL` env var refers to an older external-service path and is not the primary tagging route.

## 🧬 Generation Metadata & Extraction Rules

Tagify reads the generation data embedded in AI-art images (ComfyUI `prompt` node graphs, Automatic1111 `parameters` text) during scanning and stores it **verbatim**. From that stored raw it derives structured `gen.*` fields — positive/negative prompt, seed, model, sampler, steps, CFG — plus searchable prompt tags. Because derivation works off the stored raw, fields can be re-derived any time without touching disk again.

**Workflow signatures.** Each ComfyUI image is fingerprinted by a `workflow_sig` — a hash of its node *kinds* (sorted `class_type` multiset), ignoring node ids and widget values. Images from the same workflow share a signature, so they can be grouped and mapped together.

**Why rules exist.** Standard graphs are parsed structurally (walk the sampler's `positive`/`negative` links back to text nodes, the `model` link to the checkpoint loader). Custom and non-standard workflows — exotic samplers, custom text nodes, pass-through wrappers — break those heuristics, leaving prompt/model/seed empty even though the data is present in the raw.

**Extraction rules (rulesets)** fix that. Per `workflow_sig`, you pin **dot-paths** into the raw doc for specific fields (e.g. `prompt.32.inputs.text0` → `prompt`). A resolving pin overrides the structural baseline; the fallback chain is *pinned → structural → class*, so a pin only ever fills or corrects, never erases a working parse.

Author rules on the **Rules page**: pick a signature (the picker surfaces which still need mapping and a sample image), pin paths, and preview resolution live against that sample before saving (`POST /rules/preview`). Rulesets are **sig-global** — saving one **reprojects every image of that signature across all libraries** from their stored raw (`PUT /rules/{sig}` → background reproject), so one mapping retroactively fixes the whole batch. You can also reproject a single library on demand (`POST /libraries/{id}/reproject`).

## ⚙️ Environment Configuration

Key environment variables (see `.env.example`):

### Media Delivery

- `MEDIA_PRESIGNED_MODE`: How images are served (`redirect`, `url`, `off`)
  - `redirect`: 307 redirect to pre-signed URLs (default, offloads media)
  - `url`: Return JSON with pre-signed URL
  - `off`: Stream content directly through API
- `MEDIA_PRESIGNED_EXPIRES`: Pre-signed URL expiry in seconds (default: 3600)

### Storage

- `MINIO_ROOT_USER/PASSWORD`: MinIO credentials
- `MONGO_ROOT_USERNAME/PASSWORD`: MongoDB credentials
- `MINIO_BUCKET_THUMBS`: Thumbnail bucket name (default: `tagify-thumbs`). Originals are read from the host filesystem, so there is no originals bucket.

### Performance

- `THUMB_MAX_SIZE`: Maximum thumbnail size in pixels (default: 1080)
- `THUMB_FORMAT`: Thumbnail format (default: `webp`)
- `SCANNER_MAX_WORKERS`: Scanner thread count (0 = auto-detect CPU cores)

## 📁 Project Structure

```
Tagify/
├── packages/
│   ├── backend/          # FastAPI application
│   │   ├── src/
│   │   │   ├── api/      # REST API endpoints
│   │   │   ├── services/ # Business logic (scanner, storage)
│   │   │   └── database/ # MongoDB connection and utilities
│   │   └── .env          # Backend environment variables
│   └── frontend/         # React application
│       ├── src/
│       │   ├── components/ # React components
│       │   ├── pages/      # Page components
│       │   └── lib/        # Utilities and API client
│       └── vite.config.ts  # Vite configuration with /api proxy
├── test_images/          # Sample images for testing
├── docs/                 # Documentation
├── scripts/              # Utility scripts
├── docker-compose.yml    # Production Docker setup
├── docker-compose.dev.yml # Development dependencies only
└── README.md            # This file
```

## 🔌 API Overview

See [.github/prompts/tech_guide.md](.github/prompts/tech_guide.md) for detailed architecture documentation.

**Key Endpoints:**

- `GET /health` - Health check
- `GET /images` - List images with filtering and pagination
- `GET /images/{id}/file` - Original image from host filesystem (supports Range requests)
- `GET /images/{id}/thumb` - WebP thumbnail
- `POST /images/{id}/rating` - Set content rating (`general`/`sensitive`/`questionable`/`explicit`/`-`)
- `POST /images/{id}/score` - Set 0–5 star quality score (distinct from content rating)
- `POST /images/{id}/quarantine` - Toggle quarantine flag (DB-only; hides from feed, file untouched)
- `POST /images/{id}/purge` - Permanently delete original from disk + records (`confirm=true` required)
- `GET /tags` - Available tags with counts (30s TTL cache)
- `POST /tags/apply/{id}` / `POST /tags/remove/{id}` - Mutate tags on an image
- `POST /libraries` - Create/scan a library; `POST /libraries/{id}/rescan`, `POST /libraries/{id}/reproject`
- `GET /ai/status`, `POST /ai/model/load`, `POST /ai/tag`, `GET /ai/jobs` - Built-in autotagger + job queue
- `GET /rules`, `GET /rules/signatures`, `PUT /rules/{sig}` - Generation-metadata extraction rules, keyed by workflow signature

**Image Filtering:**

- `tags[]=tag1&tags[]=tag2` - Filter by tags
- `logic=and|or` - Tag filter logic
- `library_id=...` - Filter by library
- `no_tags=1` - Show only untagged images
- `no_ai_tags=1` - Show only images without AI tags
- `pterms[]=term&plogic=and|or` - Filter by prompt tags (generation-prompt terms)
- `quarantined=1` - Show quarantined images (hidden from the default feed)
- `cursor=...` - Cursor-based pagination for stable results

## 📚 Documentation & Links

- **[CHANGELOG.md](CHANGELOG.md)** - Version history and release notes
- **[ROADMAP.md](ROADMAP.md)** - Future features and development plan
- **[TODO.md](TODO.md)** - Current development tasks and priorities
- **[Backend README](packages/backend/README.md)** - Backend-specific documentation
- **[Frontend README](packages/frontend/README.md)** - Frontend-specific documentation
- **[Docker Guide](docs/docker-guide.md)** - Detailed Docker configuration guide
- **[Tech Guide](.github/prompts/tech_guide.md)** - Architecture and technical details

## 🐳 Data Persistence

Docker volumes ensure data persists across container restarts:

- `mongodb_data`: MongoDB database files
- `minio_data`: MinIO storage buckets

To backup your data:

```bash
# Backup MongoDB (metadata, tags, libraries)
docker compose exec mongodb mongodump --out /data/backup

# Backup the WebP thumbnail bucket (via MinIO client)
docker compose exec minio mc mirror minio/tagify-thumbs /data/backup/thumbs
```

> Original images are **not** stored in MinIO — they live in the host directories you mounted as libraries. Back those directories up with your normal file-backup tooling. Thumbnails can always be regenerated by rescanning, so only MongoDB and your source images are essential.

## 🔧 Development

### Running Tests

```bash
# Backend tests (when available)
cd packages/backend
uv run pytest

# Frontend tests (when available)
cd packages/frontend
pnpm test
```

### Code Style

- **Backend**: Code formatted with `ruff` (when configured)
- **Frontend**: Code formatted with `prettier` + `eslint` (when configured)

### Performance Testing

```bash
# Run performance benchmark
pnpm perf
```

## 🐛 Troubleshooting

### Common Issues

**Docker build fails with SSL errors:**

```bash
# Use development setup instead
docker compose -f docker-compose.dev.yml up -d
pnpm dev
```

**Services not starting:**

```bash
# Check logs
docker compose logs -f

# Restart services
docker compose restart
```

**Port conflicts:**

- MongoDB: 27017 (Unlikely as it is not exposed by default)
- MinIO: 9000 (API), 9001 (Console)
- Backend: 8000
- Frontend: 5173

Change ports in `docker-compose.yml` if needed.

**Health check failures:**

- Wait longer for services to start (especially MongoDB)
- Check container logs: `docker compose logs [service-name]`

### Testing Setup

Validate your installation:

```bash
./scripts/test-docker.sh
```

## 🤝 Contributing

We welcome contributions! Here's how to get started:

### Development Setup

1. **Fork and clone:**

   ```bash
   git clone https://github.com/your-username/Tagify.git
   cd Tagify
   ```

2. **Set up development environment:**

   ```bash
   # Install dependencies
   pnpm install

   # Start dependencies
   docker compose -f docker-compose.dev.yml up -d

   # Configure backend
   cp packages/backend/.env.example packages/backend/.env
   # Edit packages/backend/.env with MongoDB/MinIO credentials

   # Start development servers
   pnpm dev
   ```

3. **Make your changes and test:**

   ```bash
   # Test your changes work end-to-end
   # Add a library, scan images, verify functionality
   ```

4. **Submit a pull request:**
   - Create a feature branch
   - Make focused, minimal changes
   - Include tests if adding new features
   - Update documentation as needed

### Code Guidelines

- **Backend**: Follow FastAPI patterns, use type hints, keep endpoints focused
- **Frontend**: Use TypeScript, follow React best practices, maintain component isolation
- **Commits**: Use conventional commit format when possible
- **Testing**: Ensure your changes don't break existing functionality

### Reporting Issues

When reporting bugs, please include:

- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Docker version, etc.)
- Relevant logs from `docker compose logs`

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **FastAPI** - Modern, fast web framework for Python
- **React** + **Vite** - Frontend framework and build tool
- **MongoDB** - Document database for metadata
- **MinIO** - S3-compatible object storage
- **TailwindCSS** - Utility-first CSS framework

---

**Made for AI artists and diffusion model enthusiasts** 🎨✨
