# Docker Configuration Guide

This directory contains multiple Docker Compose configurations for different use cases:

## Available Configurations

### 1. `docker-compose.yml` - Production Setup

Full production stack with all services, optimized for stability:

- All services with proper health checks
- Data persistence with volumes
- Frontend served via nginx
- Configured for production deployment

**Usage:**

```bash
docker compose up --build -d
```

### 2. `docker-compose.dev.yml` - Development Dependencies

Only external dependencies (MongoDB + MinIO) for hybrid development:

- Backend and frontend run natively via `pnpm dev`
- Faster iteration during development
- Reduced resource usage

**Usage:**

```bash
docker compose -f docker-compose.dev.yml up -d
pnpm dev
```

### 3. `docker-compose.ci.yml` - CI/Testing Environment

Optimized for automated testing and CI pipelines:

- No restart policies (prevents container state issues)
- Aggressive health check timings
- Better error handling and logging
- Separate volumes to avoid conflicts

**Usage:**

```bash
docker compose -f docker-compose.ci.yml up --build -d
```

## Configuration Details

### Health Checks

All configurations include comprehensive health checks:

- **MongoDB**: `mongosh` ping command with authentication
- **MinIO**: HTTP health endpoint check
- **Backend**: FastAPI `/health` endpoint
- **Frontend**: nginx root endpoint (production only)

### Environment Variables

Configure via `.env` file (see `.env.example`):

- Database credentials
- MinIO settings
- Media delivery modes
- Performance tuning

### Volumes

Persistent data storage:

- `mongodb_data`: Database files
- `minio_data`: Object storage files
- Separate volumes for CI to avoid conflicts

### Networking

All services communicate via Docker internal networking:

- Backend connects to `mongodb:27017` and `minio:9000`
- Frontend proxies API calls to `backend:8000`
- External access via mapped ports

## Troubleshooting

### Container State Issues

If you encounter "invalid state transition" errors:

1. Use the CI configuration: `docker-compose.ci.yml`
2. Ensure Docker daemon is running properly
3. Clean up existing containers: `docker system prune`

### Health Check Failures

If services fail health checks:

1. Increase timeout values in compose file
2. Check container logs: `docker compose logs <service>`
3. Verify network connectivity between containers

### Build Failures

If Docker builds fail:

1. Clear build cache: `docker builder prune`
2. Check Dockerfile and build context
3. Ensure all required files are present and not in `.dockerignore`

### Performance Issues

For better performance:

1. Allocate more resources to Docker
2. Use SSD storage for volumes
3. Adjust health check intervals
4. Tune worker counts via environment variables
