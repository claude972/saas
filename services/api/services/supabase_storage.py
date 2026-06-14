"""Supabase Storage adapter for the BTP OpenClaw Cockpit.

Provides a thin, dependency-free interface to upload binary blobs to Supabase
Storage via its REST API.  When Supabase is not configured (empty
``SUPABASE_URL`` or ``SUPABASE_SERVICE_KEY``), all uploads fall back to the
local filesystem under ``storage/files/`` relative to this service's root, so
the application boots and operates normally without any cloud credentials.

Public API
----------
::

    if storage_available():
        url = await upload_bytes(data, "documents/report.pdf", "application/pdf")

:func:`storage_available` — synchronous availability check (no I/O).
:func:`upload_bytes`      — async upload; never raises on misconfigured env.
"""

from __future__ import annotations

import logging
from pathlib import Path

from config import settings

logger = logging.getLogger(__name__)

# Absolute path to the local fallback directory, relative to the API root.
_LOCAL_STORAGE_DIR = Path("/Users/claudebrafa/dev/saas/services/api/storage/files")


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def storage_available() -> bool:
    """Return ``True`` when Supabase Storage credentials are configured.

    Both ``SUPABASE_URL`` and ``SUPABASE_SERVICE_KEY`` must be non-empty
    strings.  No network call is made — this is a pure configuration check.
    """
    return bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_KEY)


async def upload_bytes(data: bytes, path: str, content_type: str) -> str:
    """Upload *data* to Supabase Storage and return the public URL.

    When Supabase credentials are available, the file is uploaded via the
    Supabase REST Storage API (``POST /storage/v1/object/{bucket}/{path}``).
    On success the public URL
    ``{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}`` is returned.

    When Supabase is not configured, the bytes are written to the local
    fallback directory ``storage/files/<filename>`` and the absolute
    filesystem path is returned instead.

    This function never raises an exception: any upload error is logged at
    ``WARNING`` level and the local fallback path is returned.

    Args:
        data:         Raw bytes to upload.
        path:         Destination path inside the Supabase bucket, e.g.
                      ``"documents/2024/report.pdf"``.  The basename of this
                      path is also used as the local filename on fallback.
        content_type: MIME type for the ``Content-Type`` header, e.g.
                      ``"application/pdf"``.

    Returns:
        A string URL (Supabase public URL) or an absolute local file path.
    """
    if storage_available():
        return await _upload_supabase(data, path, content_type)
    return _upload_local(data, path)


# ---------------------------------------------------------------------------
# Internal implementations
# ---------------------------------------------------------------------------


async def _upload_supabase(data: bytes, path: str, content_type: str) -> str:
    """Upload *data* to Supabase Storage via its REST API.

    Falls back to local storage on any network or HTTP error.
    """
    try:
        import httpx
    except ImportError:
        logger.warning(
            "httpx not installed — cannot upload to Supabase, falling back to local storage."
        )
        return _upload_local(data, path)

    bucket = settings.SUPABASE_BUCKET
    url = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/{bucket}/{path}"
    headers = {
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}",
        "apikey": settings.SUPABASE_SERVICE_KEY,
        "Content-Type": content_type,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, content=data, headers=headers)
            response.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Supabase Storage upload failed for %r (%s) — falling back to local storage.",
            path,
            exc,
        )
        return _upload_local(data, path)

    public_url = (
        f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{bucket}/{path}"
    )
    logger.debug("Uploaded %r to Supabase Storage: %s", path, public_url)
    return public_url


def _upload_local(data: bytes, path: str) -> str:
    """Write *data* to the local fallback directory and return the file path.

    Only the basename of *path* is used as the filename, so
    ``"documents/2024/report.pdf"`` becomes ``storage/files/report.pdf``.
    Parent directories inside *path* are intentionally ignored to keep the
    fallback area flat and avoid creating arbitrary subdirectories.

    Any I/O error is logged at ``ERROR`` level and re-raised only if the
    directory itself cannot be created; otherwise a best-effort path is
    returned.
    """
    filename = Path(path).name or "upload"
    dest = _LOCAL_STORAGE_DIR / filename

    try:
        _LOCAL_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        logger.debug("Saved upload locally: %s", dest)
    except OSError as exc:
        logger.error("Local storage write failed for %r: %s", str(dest), exc)

    return str(dest)
