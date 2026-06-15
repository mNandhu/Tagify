from pathlib import Path

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

    # Local filesystem root for generated thumbnails. Must be a persistent
    # volume, kept outside library trees. Keys are `{library_id}/{image_id}.webp`.
    # A relative value is resolved against the repo root (NOT the process cwd),
    # so it lands at `<repo>/data/thumbs` regardless of where uvicorn is started.
    thumb_root: str = "./data/thumbs"

    scanner_max_workers: int = 0
    scan_progress_update_ms: int = 500

    thumb_max_size: int = 1080
    thumb_format: str = "webp"

    log_slow_requests_ms: int = 1000

    rate_limit_enabled: bool = False
    rate_limit_rescan_per_minute: int = 1

    @property
    def thumb_root_path(self) -> Path:
        """Absolute thumbnail root. Relative `thumb_root` anchors to the repo
        root so the location doesn't depend on the process working directory."""
        p = Path(self.thumb_root)
        return p if p.is_absolute() else (_REPO_ROOT / p)


settings = Settings()
