from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).parent.parent.parent  # packages/backend/
_REPO_ROOT = _BACKEND_ROOT.parent.parent  # project root


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_REPO_ROOT / ".env", _BACKEND_ROOT / ".env"),
        extra="ignore",
    )

    mongo_uri: str = "mongodb://localhost:27017"
    ai_tagging_url: str = ""

    mongo_max_pool_size: int = 100
    mongo_min_pool_size: int = 0
    mongo_server_selection_timeout_ms: int = 5000
    mongo_connect_timeout_ms: int = 5000

    minio_endpoint: str = "127.0.0.1:9000"
    minio_access_key: str = Field(
        default="",
        validation_alias=AliasChoices("MINIO_ACCESS_KEY", "MINIO_ROOT_USER"),
    )
    minio_secret_key: str = Field(
        default="",
        validation_alias=AliasChoices("MINIO_SECRET_KEY", "MINIO_ROOT_PASSWORD"),
    )
    minio_secure: bool = False
    minio_bucket_thumbs: str = "tagify-thumbs"
    minio_region: str = "us-east-1"

    media_public_minio_endpoint: str = ""

    scanner_max_workers: int = 0
    scan_progress_update_ms: int = 500

    thumb_max_size: int = 1080
    thumb_format: str = "webp"

    media_presigned_mode: str = "redirect"
    media_presigned_expires: int = 3600

    log_slow_requests_ms: int = 1000

    rate_limit_enabled: bool = False
    rate_limit_rescan_per_minute: int = 1


settings = Settings()
