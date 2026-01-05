from __future__ import annotations

import asyncio
import csv
import os
import time
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image

try:
    import onnxruntime as rt
except Exception:  # pragma: no cover
    rt = None  # type: ignore[assignment]

import httpx

KAOMOJIS = {
    "0_0",
    "(o)_(o)",
    "+_+",
    "+-",
    "._.",
    "<o>_<o>",
    "<|>_<|>",
    "=_=",
    ">_<",
    "3_3",
    "6_9",
    ">_o",
    "@_@",
    "^_^",
    "o_o",
    "u_u",
    "x_x",
    "|_|",
    "||_||",
}


def mcut_threshold(probs: np.ndarray) -> float:
    sorted_probs = probs[probs.argsort()[::-1]]
    difs = sorted_probs[:-1] - sorted_probs[1:]
    t = int(difs.argmax())
    return float((sorted_probs[t] + sorted_probs[t + 1]) / 2)


@dataclass(frozen=True)
class LabelIndex:
    names: list[str]
    rating_idx: np.ndarray
    general_idx: np.ndarray
    character_idx: np.ndarray


def _load_labels_from_csv(csv_path: str) -> LabelIndex:
    names: list[str] = []
    categories: list[int] = []

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = (row.get("name") or "").strip()
            cat_str = (row.get("category") or "").strip()
            if not name or not cat_str:
                continue
            try:
                cat = int(cat_str)
            except Exception:
                continue

            if name not in KAOMOJIS:
                name = name.replace("_", " ")

            names.append(name)
            categories.append(cat)

    cats = np.asarray(categories)
    rating_idx = np.where(cats == 9)[0]
    general_idx = np.where(cats == 0)[0]
    character_idx = np.where(cats == 4)[0]

    return LabelIndex(
        names=names,
        rating_idx=rating_idx,
        general_idx=general_idx,
        character_idx=character_idx,
    )


def _get_hf_endpoint() -> str:
    hf_endpoint = os.getenv("HF_ENDPOINT", "https://huggingface.co")
    if not hf_endpoint.startswith("https://"):
        hf_endpoint = f"https://{hf_endpoint}"
    return hf_endpoint.rstrip("/")


async def _download_if_missing(url: str, dst_path: str) -> None:
    # Back-compat helper: keep simple behavior for any other callers.
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    if os.path.exists(dst_path):
        return

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        async with client.stream("GET", url) as r:
            r.raise_for_status()
            with open(dst_path, "wb") as f:
                async for chunk in r.aiter_bytes(chunk_size=1024 * 256):
                    if chunk:
                        f.write(chunk)


@dataclass
class DownloadFileState:
    name: str
    url: str
    dst_path: str
    status: str = "pending"  # pending|downloading|done|error|cancelled
    downloaded: int = 0
    total: int | None = None
    error: str | None = None


@dataclass
class ModelDownloadState:
    model_repo: str
    cache_dir: str
    status: str = "idle"  # idle|downloading|done|error|cancelled
    started_at: float | None = None
    updated_at: float | None = None
    cancel_requested: bool = False
    error: str | None = None
    files: list[DownloadFileState] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "model_repo": self.model_repo,
            "cache_dir": self.cache_dir,
            "status": self.status,
            "started_at": self.started_at,
            "updated_at": self.updated_at,
            "cancel_requested": self.cancel_requested,
            "error": self.error,
            "files": [
                {
                    "name": f.name,
                    "status": f.status,
                    "downloaded": f.downloaded,
                    "total": f.total,
                    "error": f.error,
                }
                for f in self.files
            ],
        }


class ModelDownloadManager:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._states: dict[tuple[str, str], ModelDownloadState] = {}
        self._tasks: dict[tuple[str, str], asyncio.Task] = {}

    def get_state(self, *, model_repo: str, cache_dir: str) -> ModelDownloadState:
        key = (model_repo, cache_dir)
        st = self._states.get(key)
        if st is None:
            st = ModelDownloadState(model_repo=model_repo, cache_dir=cache_dir)
            self._states[key] = st
        return st

    async def start(self, *, model_repo: str, cache_dir: str) -> ModelDownloadState:
        key = (model_repo, cache_dir)
        async with self._lock:
            st = self.get_state(model_repo=model_repo, cache_dir=cache_dir)

            # If everything is already there, declare success.
            csv_path, onnx_path = _expected_paths(
                model_repo=model_repo, cache_dir=cache_dir
            )
            if os.path.exists(csv_path) and os.path.exists(onnx_path):
                st.status = "done"
                st.updated_at = time.time()
                return st

            task = self._tasks.get(key)
            if task is not None and not task.done():
                return st

            st.status = "downloading"
            st.started_at = st.started_at or time.time()
            st.updated_at = time.time()
            st.cancel_requested = False
            st.error = None

            async def _runner() -> None:
                try:
                    await self._download_all(st)
                    if st.cancel_requested:
                        st.status = "cancelled"
                    else:
                        st.status = "done"
                except asyncio.CancelledError:
                    st.status = "cancelled"
                    st.cancel_requested = True
                    raise
                except Exception as e:
                    st.status = "error"
                    st.error = str(e)
                finally:
                    st.updated_at = time.time()

            self._tasks[key] = asyncio.create_task(
                _runner(), name=f"model-download:{model_repo}"
            )
            return st

    async def cancel(self, *, model_repo: str, cache_dir: str) -> bool:
        key = (model_repo, cache_dir)
        async with self._lock:
            st = self._states.get(key)
            if st is None:
                return False
            st.cancel_requested = True
            st.updated_at = time.time()
            t = self._tasks.get(key)
            if t is not None and not t.done():
                t.cancel()
                return True
            return False

    async def wait(self, *, model_repo: str, cache_dir: str) -> None:
        key = (model_repo, cache_dir)
        t = self._tasks.get(key)
        if t is not None:
            await t

    async def _download_all(self, st: ModelDownloadState) -> None:
        hf = _get_hf_endpoint()
        base_url = f"{hf}/{st.model_repo}/resolve/main"
        csv_path, onnx_path = _expected_paths(
            model_repo=st.model_repo, cache_dir=st.cache_dir
        )

        files: list[DownloadFileState] = [
            DownloadFileState(
                name="model.onnx",
                url=f"{base_url}/model.onnx",
                dst_path=onnx_path,
            ),
            DownloadFileState(
                name="selected_tags.csv",
                url=f"{base_url}/selected_tags.csv",
                dst_path=csv_path,
            ),
        ]
        st.files = files

        for f in files:
            if st.cancel_requested:
                f.status = "cancelled"
                continue
            if os.path.exists(f.dst_path):
                f.status = "done"
                f.downloaded = os.path.getsize(f.dst_path)
                f.total = f.downloaded
                st.updated_at = time.time()
                continue
            await self._download_one(st, f)

    async def _download_one(self, st: ModelDownloadState, f: DownloadFileState) -> None:
        os.makedirs(os.path.dirname(f.dst_path), exist_ok=True)
        tmp_path = f.dst_path + ".part"

        # Always restart partials to keep logic simple.
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass

        f.status = "downloading"
        f.downloaded = 0
        f.total = None
        f.error = None
        st.updated_at = time.time()

        try:
            async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
                async with client.stream("GET", f.url) as r:
                    r.raise_for_status()
                    try:
                        cl = r.headers.get("Content-Length")
                        f.total = int(cl) if cl else None
                    except Exception:
                        f.total = None

                    with open(tmp_path, "wb") as out:
                        async for chunk in r.aiter_bytes(chunk_size=1024 * 256):
                            if st.cancel_requested:
                                raise asyncio.CancelledError()
                            if not chunk:
                                continue
                            out.write(chunk)
                            f.downloaded += len(chunk)
                            st.updated_at = time.time()

            # Atomic replace
            os.replace(tmp_path, f.dst_path)
            f.status = "done"
            if f.total is None:
                try:
                    f.total = os.path.getsize(f.dst_path)
                except Exception:
                    pass
        except asyncio.CancelledError:
            f.status = "cancelled"
            raise
        except Exception as e:
            f.status = "error"
            f.error = str(e)
            raise
        finally:
            # Cleanup partial
            if f.status in ("cancelled", "error"):
                try:
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)
                except Exception:
                    pass


_download_manager: ModelDownloadManager | None = None


def get_download_manager() -> ModelDownloadManager:
    global _download_manager
    if _download_manager is None:
        _download_manager = ModelDownloadManager()
    return _download_manager


def _expected_paths(*, model_repo: str, cache_dir: str) -> tuple[str, str]:
    safe_name = model_repo.replace("/", "_")
    onnx_path = os.path.join(cache_dir, f"{safe_name}.onnx")
    csv_path = os.path.join(cache_dir, f"{safe_name}.csv")
    return csv_path, onnx_path


async def download_wd_tagger(model_repo: str, *, cache_dir: str) -> tuple[str, str]:
    """Download (or reuse cached) wd-tagger model + labels.

    Returns (csv_path, onnx_path)
    """
    model_repo = model_repo.strip()
    if not model_repo or "/" not in model_repo:
        raise ValueError("model_repo must look like 'org/repo'")

    dm = get_download_manager()
    await dm.start(model_repo=model_repo, cache_dir=cache_dir)
    # Wait for completion; cancellation is supported via dm.cancel().
    await dm.wait(model_repo=model_repo, cache_dir=cache_dir)

    csv_path, onnx_path = _expected_paths(model_repo=model_repo, cache_dir=cache_dir)
    return csv_path, onnx_path


class WDTagger:
    def __init__(self) -> None:
        self._session: Any | None = None
        self._labels: LabelIndex | None = None
        self._target_size: int | None = None
        self._repo: str | None = None

    @property
    def repo(self) -> str | None:
        return self._repo

    @property
    def loaded(self) -> bool:
        return self._session is not None

    def unload(self) -> None:
        # Best-effort: drop references so Python can GC.
        self._session = None
        self._labels = None
        self._target_size = None
        self._repo = None

    async def load(self, model_repo: str, *, cache_dir: str) -> None:
        if rt is None:
            raise RuntimeError(
                "onnxruntime is not installed. Add it to backend dependencies."
            )

        if self._repo == model_repo and self._session is not None:
            return

        csv_path, onnx_path = await download_wd_tagger(model_repo, cache_dir=cache_dir)
        labels = await asyncio.to_thread(_load_labels_from_csv, csv_path)

        # Import locally so type checkers don't treat rt as Optional.
        import onnxruntime as ort

        def _make_session():
            # CPU first is the most portable; GPU provider can be added later.
            return ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])

        session = await asyncio.to_thread(_make_session)

        # Input shape is typically (N, H, W, C)
        _, h, _, _ = session.get_inputs()[0].shape
        target_size = int(h) if h is not None else None

        self._session = session
        self._labels = labels
        self._target_size = target_size
        self._repo = model_repo

    def _prepare_image(self, img: Image.Image) -> np.ndarray:
        # Convert to RGB with white background for alpha
        canvas = Image.new("RGBA", img.size, (255, 255, 255, 255))
        canvas.alpha_composite(img.convert("RGBA"))
        img = canvas.convert("RGB")

        w, h = img.size
        m = max(w, h)
        pad = Image.new("RGB", (m, m), (255, 255, 255))
        pad.paste(img, ((m - w) // 2, (m - h) // 2))

        target = self._target_size if self._target_size is not None else m
        if m != target:
            resample = getattr(getattr(Image, "Resampling", Image), "BICUBIC", 3)
            pad = pad.resize((int(target), int(target)), resample)

        arr = np.asarray(pad, dtype=np.float32)[:, :, ::-1]  # RGB -> BGR
        return arr[None, ...]

    def predict(
        self,
        *,
        image: Image.Image,
        general_thresh: float,
        character_thresh: float,
        general_mcut: bool = False,
        character_mcut: bool = False,
        max_general: int = 80,
        max_character: int = 40,
    ) -> dict[str, Any]:
        assert self._session is not None and self._labels is not None

        input_tensor = self._prepare_image(image)
        input_name = self._session.get_inputs()[0].name
        output_name = self._session.get_outputs()[0].name

        preds = self._session.run([output_name], {input_name: input_tensor})[0][0]

        labels = list(zip(self._labels.names, preds.astype(float)))

        rating = dict(labels[i] for i in self._labels.rating_idx)

        general = [labels[i] for i in self._labels.general_idx]
        if general_mcut and general:
            general_thresh = mcut_threshold(np.array([p for _, p in general]))
        general = [(t, p) for (t, p) in general if p > general_thresh]
        general.sort(key=lambda x: x[1], reverse=True)
        if max_general > 0:
            general = general[: int(max_general)]

        character = [labels[i] for i in self._labels.character_idx]
        if character_mcut and character:
            character_thresh = max(
                0.15, mcut_threshold(np.array([p for _, p in character]))
            )
        character = [(t, p) for (t, p) in character if p > character_thresh]
        character.sort(key=lambda x: x[1], reverse=True)
        if max_character > 0:
            character = character[: int(max_character)]

        caption = ", ".join([t for t, _ in general])

        return {
            "caption": caption,
            "rating": rating,
            "general_tags": general,
            "character_tags": character,
        }


class TaggerManager:
    """Process-level tagger manager with idle-unload."""

    def __init__(self) -> None:
        self._tagger = WDTagger()
        self._lock = asyncio.Lock()
        self._last_used = 0.0
        self._idle_unload_s = 300
        self._load_task: asyncio.Task | None = None
        self._loading_for: tuple[str, str] | None = None
        self._load_error: str | None = None
        self._load_status: str = "idle"  # idle|loading|loaded|error|cancelled

    def status(self) -> dict[str, Any]:
        return {
            "loaded": self._tagger.loaded,
            "repo": self._tagger.repo,
            "last_used": self._last_used,
            "idle_unload_s": self._idle_unload_s,
        }

    def load_status(self) -> dict[str, Any]:
        repo = self._loading_for[0] if self._loading_for else self._tagger.repo
        cache_dir = self._loading_for[1] if self._loading_for else None
        dl = None
        if repo and cache_dir:
            dl = (
                get_download_manager()
                .get_state(model_repo=repo, cache_dir=cache_dir)
                .as_dict()
            )
        return {
            "status": self._load_status,
            "error": self._load_error,
            "loading_for": self._loading_for,
            "download": dl,
        }

    def start_load(self, *, model_repo: str, cache_dir: str) -> bool:
        # Fire-and-forget background load so UI can poll progress.
        if self._tagger.loaded and self._tagger.repo == model_repo:
            self._load_status = "loaded"
            self._load_error = None
            return False

        if self._load_task is not None and not self._load_task.done():
            # Already loading something.
            return False

        self._loading_for = (model_repo, cache_dir)
        self._load_error = None
        self._load_status = "loading"

        async def _runner() -> None:
            try:
                await self.ensure_loaded(model_repo=model_repo, cache_dir=cache_dir)
                self._load_status = "loaded"
            except asyncio.CancelledError:
                self._load_status = "cancelled"
                raise
            except Exception as e:
                self._load_status = "error"
                self._load_error = str(e)
            finally:
                # If load succeeded, clear "loading_for".
                if self._load_status == "loaded":
                    self._loading_for = None

        self._load_task = asyncio.create_task(
            _runner(), name=f"model-load:{model_repo}"
        )
        return True

    async def cancel_load(self) -> bool:
        if not self._loading_for:
            return False
        repo, cache_dir = self._loading_for
        # Cancel download (if in progress)
        await get_download_manager().cancel(model_repo=repo, cache_dir=cache_dir)
        # Cancel load task (if running)
        if self._load_task is not None and not self._load_task.done():
            self._load_status = "cancelled"
            self._load_task.cancel()
            return True
        return False

    def set_idle_unload_s(self, seconds: int) -> None:
        self._idle_unload_s = max(0, int(seconds))

    async def ensure_loaded(self, *, model_repo: str, cache_dir: str) -> None:
        # If a background load task is already doing this exact work, await it.
        task = self._load_task
        current = asyncio.current_task()
        if (
            task is not None
            and not task.done()
            and self._loading_for == (model_repo, cache_dir)
            and task is not current
        ):
            await task
            if self._tagger.loaded and self._tagger.repo == model_repo:
                return
            raise RuntimeError(self._load_error or "model load failed")

        async with self._lock:
            await self._tagger.load(model_repo, cache_dir=cache_dir)
            self._last_used = time.time()

    async def unload(self) -> None:
        async with self._lock:
            self._tagger.unload()

    async def predict_bytes(
        self,
        *,
        image_bytes: bytes,
        model_repo: str,
        cache_dir: str,
        general_thresh: float,
        character_thresh: float,
        general_mcut: bool,
        character_mcut: bool,
        max_general: int,
        max_character: int,
    ) -> dict[str, Any]:
        await self.ensure_loaded(model_repo=model_repo, cache_dir=cache_dir)
        async with self._lock:
            # Lock ensures session use is serialized (safe baseline).
            # We can relax later with per-session locks or multiple sessions.
            self._last_used = time.time()
            img = Image.open(BytesIO(image_bytes)).convert("RGBA")
            return self._tagger.predict(
                image=img,
                general_thresh=general_thresh,
                character_thresh=character_thresh,
                general_mcut=general_mcut,
                character_mcut=character_mcut,
                max_general=max_general,
                max_character=max_character,
            )

    async def idle_unload_loop(self, *, poll_s: float = 5.0) -> None:
        while True:
            await asyncio.sleep(max(1.0, float(poll_s)))
            idle_unload_s = int(self._idle_unload_s or 0)
            if idle_unload_s <= 0:
                continue
            st = self.status()
            if not st["loaded"]:
                continue
            last = float(st["last_used"] or 0.0)
            if last and (time.time() - last) > float(idle_unload_s):
                await self.unload()


# Singleton
_tagger_manager: TaggerManager | None = None


def get_tagger_manager() -> TaggerManager:
    global _tagger_manager
    if _tagger_manager is None:
        _tagger_manager = TaggerManager()
    return _tagger_manager
