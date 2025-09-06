# Tagify backend built with uv (Python + Alpine)
FROM ghcr.io/astral-sh/uv:python3.12-alpine

# Install curl for health checks (alpine)
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy project metadata and lockfile first (better layer caching)
COPY pyproject.toml uv.lock ./

# Install dependencies into project venv using lockfile
RUN uv sync --locked

# Copy application source
COPY src/ ./src/

# Expose port (keep 8000 to match docker-compose)
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Start the FastAPI app with uv
CMD ["uv", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]