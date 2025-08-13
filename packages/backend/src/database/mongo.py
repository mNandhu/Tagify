from __future__ import annotations
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
import os

_client: MongoClient | None = None


def get_client() -> MongoClient:
    global _client
    if _client is None:
        uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
        _client = MongoClient(uri)
    return _client


def get_db(name: str = os.getenv("MONGO_DB", "tagify")) -> Database:
    return get_client()[name]


def col(name: str) -> Collection:
    return get_db()[name]
