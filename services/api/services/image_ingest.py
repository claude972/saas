"""Ingestion d'images pour les documents (photos de compte rendu).

Convertit des octets d'image quelconques (JPEG/PNG/WebP/HEIC…) en un
``data:image/jpeg;base64,...`` compressé, prêt à être stocké dans le ``content``
d'un document et rendu tel quel dans le PDF (Chromium).

HEIC (iPhone) est pris en charge si ``pillow-heif`` est installé.
"""

from __future__ import annotations

import base64
import io

from PIL import Image

_HEIF_REGISTERED = False


def _register_heif() -> None:
    global _HEIF_REGISTERED
    if _HEIF_REGISTERED:
        return
    try:
        import pillow_heif  # type: ignore

        pillow_heif.register_heif_opener()
    except Exception:  # noqa: BLE001 — HEIC optionnel
        pass
    _HEIF_REGISTERED = True


def ingest_image_to_datauri(raw: bytes, max_dim: int = 1400, quality: int = 82) -> str:
    """Return a compressed JPEG data URI from arbitrary image bytes.

    Raises ``ValueError`` if the bytes cannot be decoded as an image.
    """
    _register_heif()
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"image illisible ({exc.__class__.__name__})") from exc

    if img.mode != "RGB":
        img = img.convert("RGB")

    w, h = img.size
    if max(w, h) > max_dim:
        if w >= h:
            h = round(h * max_dim / w)
            w = max_dim
        else:
            w = round(w * max_dim / h)
            h = max_dim
        img = img.resize((w, h), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def strip_data_uri_prefix(s: str) -> str:
    """Return the base64 payload of a data URI, or the string itself."""
    if s.startswith("data:") and "," in s:
        return s.split(",", 1)[1]
    return s
