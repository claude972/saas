"""Authentication routes.

Two endpoints back the cockpit login flow:

* ``POST /auth/login`` — validates the credentials against the configured admin
  account (``authenticate``) and, on success, issues a signed JWT.
* ``GET /auth/me`` — returns the current caller identity, resolved from the
  bearer token by :func:`get_current_user`.

V1 uses a single env-based admin account, so there is no user table to query
here; the route layer stays intentionally thin.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from core.security import authenticate, create_access_token, get_current_user
from schemas import LoginRequest, Token

router = APIRouter()


@router.post("/login", response_model=Token)
async def login(payload: LoginRequest) -> Token:
    """Authenticate the admin account and return a bearer JWT.

    Raises ``401 Unauthorized`` when the credentials do not match.
    """
    if not authenticate(payload.email, payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants invalides.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(sub=payload.email)
    return Token(access_token=access_token, token_type="bearer")


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)) -> dict:
    """Return the current authenticated user (``{"email": ...}``)."""
    return current_user
