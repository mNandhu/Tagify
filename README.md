# Tagify Monorepo

A FastAPI + React image management application with tagging capabilities.

## Quick Start

### Docker Compose (Recommended)

The easiest way to run Tagify is using Docker Compose:

```bash
# Clone the repository
git clone https://github.com/mNandhu/Tagify.git
cd Tagify

# Copy environment configuration
cp .env.example .env

# Start all services
docker compose up --build
```

This will start:
- **Frontend**: http://localhost:5173 (React app)
- **Backend API**: http://localhost:8000 (FastAPI)
- **MinIO Console**: http://localhost:9001 (admin:password123)
- **MongoDB**: localhost:27017

### Development Setup

For local development without Docker:

```bash
# Install dependencies
pnpm install

# Start MongoDB and MinIO locally (required)
# Then run both frontend and backend:
pnpm dev
```

## Architecture

- **Backend**: FastAPI app with MongoDB for metadata, MinIO for image storage
- **Frontend**: Vite + React + TypeScript with TailwindCSS
- **Storage**: 
  - MongoDB: Image metadata, tags, library information
  - MinIO: Original images and JPEG thumbnails in separate buckets

## Environment Configuration

Key environment variables (see `.env.example`):

- `MEDIA_PRESIGNED_MODE`: How images are served (`redirect`, `url`, `off`)
- `MINIO_ROOT_USER/PASSWORD`: MinIO credentials
- `MONGO_ROOT_USERNAME/PASSWORD`: MongoDB credentials
- `THUMB_MAX_SIZE`: Maximum thumbnail size in pixels
- `SCANNER_MAX_WORKERS`: Scanner thread count (0 = auto)

## Services

### MinIO Buckets

- `tagify-thumbs`: Generated thumbnails (JPEG)
- `tagify-originals`: Original images

### API Endpoints

See .github/prompts/tech_guide.md for architecture details. Key endpoints:

- `GET /health`: Health check
- `GET /images`: List images with filtering and pagination
- `GET /images/{id}/file`: Original image
- `GET /images/{id}/thumb`: Thumbnail
- `GET /tags`: Available tags
- `POST /libraries`: Create/scan libraries

## Data Persistence

Docker volumes ensure data persists across restarts:
- `mongodb_data`: MongoDB database
- `minio_data`: MinIO storage buckets
