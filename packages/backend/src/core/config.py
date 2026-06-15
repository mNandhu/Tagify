from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).parent.parent.parent  # packages/backend/
_REPO_ROOT = _BACKEND_ROOT.parent.parent  # project root


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_REPO_ROOT / ".env", _BACKEND_ROOT / ".env"),
        extra="ignore",
    )

    ai_tagging_url: str = ""

    # SQLite database file. Relative values resolve against the repo root (NOT the
    # process cwd), mirroring `thumb_root`, so the DB lands at `<repo>/data/tagify.db`
    # regardless of where uvicorn is started.
    sqlite_path: str = "./data/tagify.db"
    # How long a blocked writer waits for SQLite's file lock before erroring
    # (SQLITE_BUSY). WAL + short scanner transactions keep contention rare.
    sqlite_busy_timeout_ms: int = 5000

    # Local filesystem root for generated thumbnails. Must be a persistent
    # volume, kept outside library trees. Keys are `{library_id}/{image_id}.webp`.
    # A relative value is resolved against the repo root (NOT the process cwd),
    # so it lands at `<repo>/data/thumbs` regardless of where uvicorn is started.
    thumb_root: str = "./data/thumbs"

    scanner_max_workers: int = 0
    scan_progress_update_ms: int = 500

    # Local filesystem directory for downloaded AI tagger model files (ONNX +
    # label CSV). Relative values resolve against the repo root, the same as
    # `thumb_root` and `sqlite_path`, so the location doesn't depend on the
    # process working directory.
    model_cache_dir: str = ".cache/tagify/models"

    thumb_max_size: int = 1080
    thumb_format: str = "webp"

    log_slow_requests_ms: int = 1000

    rate_limit_enabled: bool = False
    rate_limit_rescan_per_minute: int = 1

    @property
    def model_cache_dir_path(self) -> Path:
        """Absolute model cache directory. Relative `model_cache_dir` anchors to
        the repo root so the location doesn't depend on the process working directory."""
        p = Path(self.model_cache_dir)
        return p if p.is_absolute() else (_REPO_ROOT / p)

    @property
    def thumb_root_path(self) -> Path:
        """Absolute thumbnail root. Relative `thumb_root` anchors to the repo
        root so the location doesn't depend on the process working directory."""
        p = Path(self.thumb_root)
        return p if p.is_absolute() else (_REPO_ROOT / p)

    @property
    def sqlite_file(self) -> Path:
        """Absolute SQLite file path. Relative `sqlite_path` anchors to the repo
        root so the location doesn't depend on the process working directory."""
        p = Path(self.sqlite_path)
        return p if p.is_absolute() else (_REPO_ROOT / p)


settings = Settings()
