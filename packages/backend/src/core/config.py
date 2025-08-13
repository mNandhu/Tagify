import os
from dotenv import load_dotenv

load_dotenv()


def env_str(name: str, default: str | None = None) -> str:
    val = os.getenv(name)
    return val if val is not None else (default or "")


MONGO_URI: str = env_str("MONGO_URI", "mongodb://localhost:27017")
AI_TAGGING_URL: str = env_str("AI_TAGGING_URL", "")


# Legacy THUMBS_DIR removed; MinIO is now the source of truth

# MinIO / S3-compatible storage settings
MINIO_ENDPOINT: str = env_str("MINIO_ENDPOINT", "127.0.0.1:9000")
MINIO_ACCESS_KEY: str = env_str("MINIO_ACCESS_KEY", "")
MINIO_SECRET_KEY: str = env_str("MINIO_SECRET_KEY", "")
MINIO_SECURE: bool = env_str("MINIO_SECURE", "false").lower() == "true"
MINIO_BUCKET_THUMBS: str = env_str("MINIO_BUCKET_THUMBS", "tagify-thumbs")
MINIO_BUCKET_ORIGINALS: str = env_str("MINIO_BUCKET_ORIGINALS", "tagify-originals")

# Scanner concurrency cap
SCANNER_MAX_WORKERS: int = int(env_str("SCANNER_MAX_WORKERS", "0") or "0")

# Media delivery mode: 'off' (proxy via API), 'redirect' (302/307 to presigned), 'url' (API returns URL JSON)
MEDIA_PRESIGNED_MODE: str = env_str("MEDIA_PRESIGNED_MODE", "off").lower()
# Expiration for presigned URLs in seconds
MEDIA_PRESIGNED_EXPIRES: int = int(env_str("MEDIA_PRESIGNED_EXPIRES", "3600") or "3600")
