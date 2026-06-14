"""Shared FastAPI dependencies.

`get_current_user` lives in core.security (not here) to avoid a circular import
with the auth layer; routes import it from there.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from database import async_session_maker


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an async DB session."""
    async with async_session_maker() as session:
        yield session
