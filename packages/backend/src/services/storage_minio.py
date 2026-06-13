from __future__ import annotations
from typing import Optional, Union, List, Tuple, cast
from io import BytesIO

from minio import Minio
from minio.deleteobjects import DeleteObject

from ..core.config import settings
from urllib.parse import urlparse
from datetime import timedelta

_client: Optional[Minio] = None
_sign_client: Optional[Minio] = None


def ensure_buckets() -> None:
    """Ensure required buckets exist.

    Run this at startup (preferably), so request paths don't pay bucket_exists costs.
    """
    client = get_minio()
    for bucket in (settings.minio_bucket_thumbs,):
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)


def get_minio() -> Minio:
    global _client
    if _client is None:
        _client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
            region=settings.minio_region or None,
        )
    return _client


def _get_signing_minio() -> Minio:
    """Return a MinIO client used ONLY for generating presigned URLs.
    If MEDIA_PUBLIC_MINIO_ENDPOINT is set, use that host:port (and scheme) so the signature matches the URL the browser will fetch.
    Otherwise, reuse the internal client.
    """
    global _sign_client
    public = (settings.media_public_minio_endpoint or "").strip()
    if not public:
        return get_minio()
    if _sign_client is not None:
        return _sign_client
    # Determine endpoint and secure from value; allow http(s):// or host:port
    endpoint = public
    secure = False
    if public.startswith("http://") or public.startswith("https://"):
        u = urlparse(public)
        endpoint = u.netloc or u.path
        secure = u.scheme == "https"
    _sign_client = Minio(
        endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=secure,
        region=settings.minio_region or None,
    )
    return _sign_client


def put_thumb(
    library_id: str, image_id: str, data: bytes, content_type: str = "image/webp"
) -> str:
    """Upload thumbnail bytes as WebP; returns object key."""
    client = get_minio()
    key = f"{library_id}/{image_id}.webp"

    # Set Cache-Control metadata for long-lived caching
    metadata: dict[str, Union[str, List[str], Tuple[str]]] = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": content_type,
    }

    client.put_object(
        settings.minio_bucket_thumbs,
        key,
        data=BytesIO(data),
        length=len(data),
        content_type=content_type,
        metadata=cast(dict[str, Union[str, List[str], Tuple[str]]], metadata),
    )
    return key


def get_thumb(key: str):
    client = get_minio()
    return client.get_object(settings.minio_bucket_thumbs, key)


def presign_thumb(key: str, expires: int | None = None) -> str:
    client = _get_signing_minio()
    ttl = expires or settings.media_presigned_expires
    url = client.presigned_get_object(
        settings.minio_bucket_thumbs, key, expires=timedelta(seconds=int(ttl))
    )
    return url


def delete_by_prefix(prefix: str):
    """Delete objects in the thumbs bucket under a prefix (e.g., library_id/)."""
    client = get_minio()
    objs = list(
        client.list_objects(settings.minio_bucket_thumbs, prefix=prefix, recursive=True)
    )
    if not objs:
        return
    delete_list = [DeleteObject(o.object_name) for o in objs if o.object_name]
    for err in client.remove_objects(settings.minio_bucket_thumbs, delete_list):
        # Best-effort; could log err if needed
        _ = err
