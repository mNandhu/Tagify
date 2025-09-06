from __future__ import annotations
from typing import Optional
from io import BytesIO

from minio import Minio
from minio.deleteobjects import DeleteObject

from ..core import config
from datetime import timedelta

_client: Optional[Minio] = None


def get_minio() -> Minio:
    global _client
    if _client is None:
        _client = Minio(
            config.MINIO_ENDPOINT,
            access_key=config.MINIO_ACCESS_KEY,
            secret_key=config.MINIO_SECRET_KEY,
            secure=config.MINIO_SECURE,
        )
        # Ensure buckets exist
        for bucket in (config.MINIO_BUCKET_THUMBS, config.MINIO_BUCKET_ORIGINALS):
            if not _client.bucket_exists(bucket):
                _client.make_bucket(bucket)
    return _client


def put_thumb(
    library_id: str, image_id: str, data: bytes, content_type: str = "image/jpeg"
) -> str:
    """Upload thumbnail bytes as JPEG; returns object key."""
    client = get_minio()
    key = f"{library_id}/{image_id}.jpg"
    
    # Set Cache-Control metadata for long-lived caching
    metadata = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": content_type,
    }
    
    client.put_object(
        config.MINIO_BUCKET_THUMBS,
        key,
        data=BytesIO(data),
        length=len(data),
        content_type=content_type,
        metadata=metadata,
    )
    return key


def put_original(
    library_id: str, image_id: str, stream, length: int, content_type: Optional[str]
) -> str:
    """Upload original file stream; returns object key."""
    # Try to infer extension from content type
    ext = ""
    if content_type and "/" in content_type:
        subtype = content_type.split("/")[-1]
        if subtype:
            ext = "." + subtype
    key = f"{library_id}/{image_id}{ext}"
    client = get_minio()
    client.put_object(
        config.MINIO_BUCKET_ORIGINALS,
        key,
        data=stream,
        length=length,
        content_type=content_type or "application/octet-stream",
    )
    return key


def get_thumb(key: str):
    client = get_minio()
    return client.get_object(config.MINIO_BUCKET_THUMBS, key)


def get_original(key: str, offset: int | None = None, length: int | None = None):
    """Get original object; supports ranged reads via offset/length (bytes)."""
    client = get_minio()
    off = 0 if offset is None else int(offset)
    # MinIO treats length=0 as 'to end'
    ln = 0 if length is None else int(length)
    return client.get_object(
        config.MINIO_BUCKET_ORIGINALS,
        key,
        offset=off,
        length=ln,
    )


def stat_original(key: str):
    """Return metadata for original object (size, etag, content-type)."""
    client = get_minio()
    return client.stat_object(config.MINIO_BUCKET_ORIGINALS, key)


def presign_original(key: str, expires: int | None = None) -> str:
    client = get_minio()
    ttl = expires or config.MEDIA_PRESIGNED_EXPIRES
    return client.presigned_get_object(
        config.MINIO_BUCKET_ORIGINALS, key, expires=timedelta(seconds=int(ttl))
    )


def presign_thumb(key: str, expires: int | None = None) -> str:
    client = get_minio()
    ttl = expires or config.MEDIA_PRESIGNED_EXPIRES
    return client.presigned_get_object(
        config.MINIO_BUCKET_THUMBS, key, expires=timedelta(seconds=int(ttl))
    )


def delete_by_prefix(prefix: str):
    """Delete objects in both buckets under a prefix (e.g., library_id/)."""
    client = get_minio()
    for bucket in (config.MINIO_BUCKET_THUMBS, config.MINIO_BUCKET_ORIGINALS):
        objs = list(client.list_objects(bucket, prefix=prefix, recursive=True))
        if not objs:
            continue
        delete_list = [DeleteObject(o.object_name) for o in objs if o.object_name]
        for err in client.remove_objects(bucket, delete_list):
            # Best-effort; could log err if needed
            _ = err
