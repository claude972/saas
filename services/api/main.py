"""FastAPI application entrypoint for the BTP OpenClaw Cockpit backend.

On startup the lifespan:
  1. imports the `models` module so all tables are registered on Base.metadata,
  2. creates the tables (run_sync of Base.metadata.create_all),
  3. seeds the agents (only if the `agents` table is empty).

The backend is the authority: OpenClaw never writes directly to the DB/files.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

# Import models so every table is registered on Base.metadata before create_all.
import models  # noqa: F401
from agents.llm import llm_available
from config import settings
from database import Base, async_session_maker, engine

# Routers
from routes.agents import router as agents_router
from routes.approvals import router as approvals_router
from routes.auth import router as auth_router
from routes.documents import router as documents_router
from routes.logs import router as logs_router
from routes.openclaw import router as openclaw_router
from routes.projects import router as projects_router
from routes.tasks import router as tasks_router

logger = logging.getLogger("openclaw.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1 + 2. Create all tables registered on Base.metadata.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 3. Seed agents only when the agents table is empty.
    try:
        from models import Agent  # imported here to keep startup robust
        from seed import seed

        async with async_session_maker() as session:
            count = await session.scalar(select(func.count()).select_from(Agent))
            if not count:
                await seed(session)
    except Exception:  # noqa: BLE001 - never let seeding crash startup
        logger.exception("Agent seeding failed; continuing without seed.")

    yield


app = FastAPI(title="BTP OpenClaw Cockpit API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers at their contractual prefixes.
app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(openclaw_router, prefix="/openclaw", tags=["openclaw"])
app.include_router(projects_router, prefix="/projects", tags=["projects"])
app.include_router(agents_router, prefix="/agents", tags=["agents"])
app.include_router(tasks_router, prefix="/tasks", tags=["tasks"])
app.include_router(approvals_router, prefix="/approvals", tags=["approvals"])
app.include_router(documents_router, prefix="/documents", tags=["documents"])
app.include_router(logs_router, prefix="/logs", tags=["logs"])


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "llm": llm_available()}
