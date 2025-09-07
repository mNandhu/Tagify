# Tagify

**AI-generated image management made simple.**

Tagify is purpose-built for organizing and exploring large collections of AI-generated images from Stable Diffusion, Midjourney, DALL-E, and other AI art tools. Use powerful tag-based organization with optional AI autotagging to keep your diffusion models and generated artwork easily discoverable.

![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Python](https://img.shields.io/badge/python-3.12-blue)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue)

## ✨ Features

- **🎨 AI Art Focused**: Optimized for AI-generated image workflows and metadata
- **🏷️ Smart Tagging**: Manual tagging with optional AI autotagging via external services
- **📁 Library Management**: Organize images into libraries with automatic scanning
- **🔍 Powerful Search**: Filter by tags, libraries, or untagged images with AND/OR logic
- **⚡ Fast Performance**: Cursor-based pagination and pre-signed URL delivery
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

- **Backend**: FastAPI app with MongoDB for metadata, MinIO for image storage
- **Frontend**: Vite + React + TypeScript with TailwindCSS
- **Storage**: 
  - MongoDB: Image metadata, tags, library information
  - MinIO: Original images and JPEG thumbnails in separate buckets

## 🤖 AI Autotagger Integration

Tagify supports external AI tagging services for automatic tag generation. While Tagify stores and manages tags internally, you can connect it to autotagging services like [danbooru/autotagger](https://github.com/danbooru/autotagger) for automatic tag suggestions.

**Configuration:**
```bash
# In packages/backend/.env
AI_TAGGING_URL=http://your-autotagger-service:port/predict
```

**How it works:**
1. Tagify sends images to your configured autotagger service
2. Receives tag suggestions back
3. You review and accept/reject suggestions before applying
4. Tags are stored in Tagify's database for future searches

**Compatible Services:**
- [danbooru/autotagger](https://github.com/danbooru/autotagger) - Deep learning model for anime/artwork tagging
- Custom APIs that accept image input and return JSON tag arrays

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
- `MINIO_BUCKET_THUMBS/ORIGINALS`: Bucket names for thumbnails and originals

### Performance
- `THUMB_MAX_SIZE`: Maximum thumbnail size in pixels (default: 512)
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
- `GET /images/{id}/file` - Original image (supports Range requests)
- `GET /images/{id}/thumb` - Thumbnail image
- `GET /tags` - Available tags with counts (cached)
- `POST /libraries` - Create/scan libraries
- `POST /tags/apply` - Apply tags to images

**Image Filtering:**
- `tags[]=tag1&tags[]=tag2` - Filter by tags
- `logic=and|or` - Tag filter logic
- `library_id=...` - Filter by library
- `no_tags=1` - Show only untagged images
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

**POSIX (Linux/macOS):**
```bash
# Backup MongoDB
docker compose exec mongodb mongodump --out /data/backup

# Backup MinIO (via MinIO client)
docker compose exec minio mc mirror minio/tagify-originals /data/backup/originals
docker compose exec minio mc mirror minio/tagify-thumbs /data/backup/thumbs
```

**Windows PowerShell:**
```powershell
# Backup MongoDB
docker compose exec mongodb mongodump --out /data/backup

# Backup MinIO (via MinIO client)
docker compose exec minio mc mirror minio/tagify-originals /data/backup/originals
docker compose exec minio mc mirror minio/tagify-thumbs /data/backup/thumbs
```

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
- MongoDB: 27017
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
