from __future__ import annotations
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


class LibraryIn(BaseModel):
    path: str
    name: Optional[str] = None

    @field_validator("path")
    @classmethod
    def _strip_quotes(cls, v: str) -> str:
        return _sanitize_path(v)


class Library(BaseModel):
    id: str = Field(..., alias="_id")
    path: str
    name: Optional[str] = None

    class Config:
        populate_by_name = True


class LibraryUpdate(BaseModel):
    path: Optional[str] = None
    name: Optional[str] = None

    @field_validator("path")
    @classmethod
    def _strip_quotes(cls, v: Optional[str]) -> Optional[str]:
        return _sanitize_path(v) if v is not None else v
