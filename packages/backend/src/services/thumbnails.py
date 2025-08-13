from __future__ import annotations
from pathlib import Path
from PIL import Image as PILImage
from ..core import config

THUMBS_ROOT = config.THUMBS_DIR
THUMB_SIZE = (512, 512)


def ensure_dir(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)


def thumb_rel_path(library_id: str, rel: str) -> Path:
    # store under thumbs/<lib>/<rel>.jpg
    return Path(library_id) / Path(rel).with_suffix(".jpg")


def generate_thumbnail(library_id: str, abs_path: str, rel: str) -> str:
    src = Path(abs_path)
    out_rel = thumb_rel_path(library_id, rel)
    out_abs = THUMBS_ROOT / out_rel
    ensure_dir(out_abs)
    try:
        with PILImage.open(src) as img:
            img.thumbnail(THUMB_SIZE)
            img.convert("RGB").save(out_abs, format="JPEG", quality=85)
    except Exception:
        # ignore errors creating thumbnail
        return str(out_rel).replace("\\", "/")
    return str(out_rel).replace("\\", "/")
