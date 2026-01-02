"""Deprecated module.

MinIO integration lives in `storage_minio.py`.

This file is kept only to avoid confusing empty-module imports if anyone referenced
it historically.
"""

from .storage_minio import get_minio  # re-export for compatibility
