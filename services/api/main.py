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
from sqlalchemy import func, select, text

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
from routes.settings import router as settings_router
from routes.skills import router as skills_router
from routes.tasks import router as tasks_router
from routes.tenders import router as tenders_router
from routes.sources import router as sources_router
from routes.veille import router as veille_router

logger = logging.getLogger("openclaw.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1 + 2. Create all tables registered on Base.metadata.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all never ALTERs existing tables, so add columns introduced
        # after a table was first created. Idempotent (Postgres IF NOT EXISTS).
        await conn.execute(
            text(
                "ALTER TABLE agents ADD COLUMN IF NOT EXISTS "
                "provider VARCHAR(50) NOT NULL DEFAULT 'anthropic'"
            )
        )
        await conn.execute(
            text("ALTER TABLE agents ADD COLUMN IF NOT EXISTS model VARCHAR(255)")
        )
        # veille_config: columns added after the table's first deploy
        # (model/prompt/timezone are configurable from the cockpit).
        await conn.execute(
            text(
                "ALTER TABLE veille_config ADD COLUMN IF NOT EXISTS "
                "timezone VARCHAR(64) NOT NULL DEFAULT 'America/Martinique'"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE veille_config ADD COLUMN IF NOT EXISTS "
                "perplexity_model VARCHAR(100) NOT NULL DEFAULT 'sonar'"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE veille_config ADD COLUMN IF NOT EXISTS "
                "search_prompt TEXT"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE tender_offers ADD COLUMN IF NOT EXISTS sectors JSON"
            )
        )
        # company_settings: default LLM ("agent chef") configurable from Réglages.
        await conn.execute(
            text(
                "ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS "
                "default_llm_provider VARCHAR(50)"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS "
                "default_llm_model VARCHAR(255)"
            )
        )

    # 2b. Operational guard: warn when no dedicated encryption key is set.
    if not settings.SECRETS_ENCRYPTION_KEY:
        logger.warning(
            "SECRETS_ENCRYPTION_KEY non défini — les secrets (clés API, mots de "
            "passe de portails) sont chiffrés avec une clé DÉRIVÉE de JWT_SECRET. "
            "En production : définissez une clé Fernet dédiée et ne modifiez pas "
            "JWT_SECRET (sinon les secrets stockés deviennent indéchiffrables)."
        )

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

    # 4. Load API keys from DB into the in-memory hot-reload cache (best-effort).
    try:
        from agents.llm import load_keys_from_db

        async with async_session_maker() as session:
            await load_keys_from_db(session)
    except Exception:  # noqa: BLE001 - never let key loading crash startup
        logger.exception("load_keys_from_db failed; continuing with env keys only.")

    # 4b. Load the cockpit-wide default LLM ("agent chef") from the DB.
    try:
        from agents.llm import set_default_provider_model
        from models import CompanySettings

        async with async_session_maker() as session:
            row = (
                await session.execute(select(CompanySettings).limit(1))
            ).scalar_one_or_none()
            if row is not None and (row.default_llm_provider or row.default_llm_model):
                set_default_provider_model(
                    row.default_llm_provider, row.default_llm_model
                )
    except Exception:  # noqa: BLE001 - never let default loading crash startup
        logger.exception("Default LLM loading failed; continuing with env default.")

    # 5. Start the veille background scheduler.
    try:
        from services.veille_scheduler import scheduler

        await scheduler.start()
    except Exception:  # noqa: BLE001 - never let the scheduler crash startup
        logger.exception("VeilleScheduler failed to start; continuing without it.")

    try:
        yield
    finally:
        # 6. Stop the veille scheduler on shutdown.
        try:
            from services.veille_scheduler import scheduler

            await scheduler.stop()
        except Exception:  # noqa: BLE001
            logger.exception("VeilleScheduler failed to stop cleanly.")


app = FastAPI(title="BTP OpenClaw Cockpit API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Expose Content-Disposition so the browser (cross-origin web→api) can read
    # the real download filename (e.g. "devis-CED.pdf") instead of falling back
    # to a generic name with the format as extension.
    expose_headers=["Content-Disposition"],
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
app.include_router(skills_router, prefix="/skills", tags=["skills"])
app.include_router(settings_router, prefix="/settings", tags=["settings"])
app.include_router(tenders_router, prefix="/tenders", tags=["tenders"])
app.include_router(sources_router, prefix="/sources", tags=["sources"])
app.include_router(veille_router, prefix="/veille", tags=["veille"])


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "llm": llm_available()}
