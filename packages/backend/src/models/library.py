from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional


class LibraryIn(BaseModel):
    path: str
    name: Optional[str] = None


class Library(BaseModel):
    id: str = Field(..., alias="_id")
    path: str
    name: Optional[str] = None

    class Config:
        populate_by_name = True


class LibraryUpdate(BaseModel):
    path: Optional[str] = None
    name: Optional[str] = None
