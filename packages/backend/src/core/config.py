import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


def env_str(name: str, default: str | None = None) -> str:
    val = os.getenv(name)
    return val if val is not None else (default or "")


MONGO_URI: str = env_str("MONGO_URI", "mongodb://localhost:27017")
AI_TAGGING_URL: str = env_str("AI_TAGGING_URL", "")


# Thumbnails directory, default to repo root /.thumbs when running from backend folder
def find_repo_thumbs(start: Path) -> Path:
    p = start
    for _ in range(6):
        candidate = p / ".thumbs"
        if candidate.exists():
            return candidate
        if p.parent == p:
            break
        p = p.parent
    return start / ".thumbs"


_default_thumbs = find_repo_thumbs(Path(__file__).resolve())
THUMBS_DIR: Path = Path(env_str("THUMBS_DIR", str(_default_thumbs))).resolve()
