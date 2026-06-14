"""Authentication and JWT helpers.

V1 uses a single admin account whose credentials live in the environment
(``ADMIN_EMAIL`` / ``ADMIN_PASSWORD``). On successful login a signed JWT is
issued; protected routes depend on :func:`get_current_user`, which decodes the
bearer token and returns the caller identity.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import settings

_bearer_scheme = HTTPBearer(auto_error=False)


def create_access_token(sub: str) -> str:
    """Create a signed JWT for the given subject (the admin email).

    Expiry is taken from ``settings.ACCESS_TOKEN_EXPIRE_MINUTES``.
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": sub,
        "iat": now,
        "exp": expire,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and verify a JWT, returning its claims.

    Raises ``jwt.PyJWTError`` (or a subclass) on any validation failure.
    """
    return jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=[settings.JWT_ALGORITHM],
    )


def authenticate(email: str, password: str) -> bool:
    """Return True when the credentials match the configured admin account."""
    return email == settings.ADMIN_EMAIL and password == settings.ADMIN_PASSWORD


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> dict:
    """FastAPI dependency: resolve the current user from the bearer token.

    Raises ``401 Unauthorized`` when the header is missing, malformed, or the
    token is invalid/expired. Returns ``{"email": <sub>}`` on success.
    """
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Identifiants invalides ou jeton expire.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None or not credentials.credentials:
        raise unauthorized

    try:
        claims = decode_token(credentials.credentials)
    except jwt.PyJWTError as exc:  # noqa: F841 - message kept generic on purpose
        raise unauthorized from exc

    sub = claims.get("sub")
    if not sub:
        raise unauthorized

    return {"email": sub}
