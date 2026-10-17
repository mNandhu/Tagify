from __future__ import annotations
import os
from pathlib import Path
from pydantic import BaseModel, Field, field_validator
from typing import Optional

_QUOTE_PAIRS = (('"', '"'), ("'", "'"))


def _sanitize_path(value: str) -> str:
    value = value.strip()
    while len(value) >= 2:
        for start, end in _QUOTE_PAIRS:
            if value[0] == start and value[-1] == end:
                value = value[1:-1].strip()
                break
        else:
            break
    return value


def _validate_path(value: str) -> str:
    value = _sanitize_path(value)
    # A quoted-empty or whitespace-only path sanitizes to "", and Path("") is
    # the process's own cwd to pathlib — not "no path". Rejecting non-absolute
    # paths here also catches that (cwd is relative) along with bare relative
    # names and Windows drive-relative references ("C:", as opposed to
    # "C:\\"), whose meaning would otherwise depend on the backend's cwd
    # rather than naming a fixed location.
    if not value or not Path(value).is_absolute():
        raise ValueError(f"Path must be a non-empty absolute path: {value!r}")
    # One spelling per folder: `D:/images/` and `D:/images` are the same library.
    return os.path.normpath(value)


class LibraryIn(BaseModel):
    path: str
    name: Optional[str] = None

    @field_validator("path")
    @classmethod
    def _strip_quotes(cls, v: str) -> str:
        return _validate_path(v)


class LibraryDiscoverIn(BaseModel):
    paths: list[str] = Field(..., min_length=1, max_length=50)
    #: Offer each immediate subfolder as its own library.
    split_subdirs: bool = False

    @field_validator("paths")
    @classmethod
    def _clean(cls, v: list[str]) -> list[str]:
        return [_validate_path(p) for p in v if p.strip()]


class Library(BaseModel):
    id: str = Field(..., alias="_id")
    path: str
    name: Optional[str] = None

    class Config:
        populate_by_name = True


class LibraryUpdate(BaseModel):
    path: Optional[str] = None
    name: Optional[str] = None
    watch_enabled: Optional[bool] = None

    @field_validator("path")
    @classmethod
    def _strip_quotes(cls, v: Optional[str]) -> Optional[str]:
        return _validate_path(v) if v is not None else v
