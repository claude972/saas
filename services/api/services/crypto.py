"""Symmetric encryption helpers for secrets stored in the database.

Uses Fernet (AES-128-CBC + HMAC-SHA256) from the ``cryptography`` package.

Key resolution (never raises at boot):
1. If ``settings.SECRETS_ENCRYPTION_KEY`` is a non-empty, valid Fernet key
   (URL-safe base64, 32 bytes) → use it directly.
2. Otherwise → derive a 32-byte key from ``settings.JWT_SECRET`` via SHA-256
   and encode it as URL-safe base64 so it fits the Fernet spec.

The Fernet instance is built once and cached at module level.
"""

from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level Fernet cache
# ---------------------------------------------------------------------------

_fernet: Fernet | None = None


def get_fernet() -> Fernet:
    """Return the cached Fernet instance, building it on first call.

    Never raises: if the configured key is invalid the function falls back to
    deriving one from JWT_SECRET, which always produces a valid 32-byte key.
    """
    global _fernet
    if _fernet is not None:
        return _fernet

    raw_key = settings.SECRETS_ENCRYPTION_KEY if hasattr(settings, "SECRETS_ENCRYPTION_KEY") else ""

    fernet_key: bytes | None = None

    if raw_key:
        try:
            decoded = base64.urlsafe_b64decode(raw_key + "==")
            if len(decoded) == 32:
                fernet_key = raw_key.encode() if isinstance(raw_key, str) else raw_key
            else:
                logger.warning(
                    "SECRETS_ENCRYPTION_KEY decoded to %d bytes (need 32); "
                    "falling back to JWT_SECRET derivation.",
                    len(decoded),
                )
        except Exception:
            logger.warning(
                "SECRETS_ENCRYPTION_KEY is not valid URL-safe base64; "
                "falling back to JWT_SECRET derivation."
            )

    if fernet_key is None:
        digest = hashlib.sha256(settings.JWT_SECRET.encode()).digest()
        fernet_key = base64.urlsafe_b64encode(digest)

    _fernet = Fernet(fernet_key)
    return _fernet


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def encrypt_secret(plaintext: str) -> str:
    """Encrypt *plaintext* and return a URL-safe base64 Fernet token (str)."""
    token: bytes = get_fernet().encrypt(plaintext.encode())
    return token.decode()


def decrypt_secret(token: str) -> str:
    """Decrypt a Fernet *token* and return the plaintext.

    On any failure (wrong key, tampered token, empty input) logs a warning
    WITHOUT including the token value and returns an empty string.
    """
    if not token:
        return ""
    try:
        plaintext: bytes = get_fernet().decrypt(token.encode())
        return plaintext.decode()
    except InvalidToken:
        logger.warning("decrypt_secret: InvalidToken — token could not be decrypted.")
        return ""
    except Exception as exc:
        logger.warning("decrypt_secret: unexpected error (%s).", type(exc).__name__)
        return ""
