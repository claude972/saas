"""Idempotent database seeding for the BTP OpenClaw Cockpit.

``seed(db)`` is invoked by the FastAPI lifespan on startup. It populates the
database the first time it runs and is a no-op afterwards:

  1. inserts the four built-in sub-agents from :data:`agents.registry.registry`,
  2. inserts one demo project (Chantier Villa Ducos),
  3. inserts a few demo OpenClaw commands attached to that project,
  4. inserts a couple of audit log lines.

The function short-circuits when the ``agents`` table already holds rows, so
calling it repeatedly never duplicates data.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.registry import registry
from models import Agent, Log, OpenClawCommand, Project


async def seed(db: AsyncSession) -> None:
    """Seed the database with built-in agents and demo data (idempotent)."""
    # Idempotency guard: if any agent already exists, do nothing.
    existing = await db.scalar(select(func.count()).select_from(Agent))
    if existing:
        return

    # 1. Built-in agents from the registry metadata.
    for meta in registry.list():
        db.add(
            Agent(
                name=meta["name"],
                slug=meta["slug"],
                role=meta["role"],
                description=meta["description"],
                agent_type="builtin",
                version=meta["version"],
                risk_level=meta["risk_level"],
                enabled=True,
                config={},
                input_schema={},
                output_schema={},
            )
        )

    # 2. Demo project.
    project = Project(
        name="Chantier Villa Ducos",
        client_name="M. & Mme Ducos",
        address="Ducos",
        project_type="Rénovation intérieure",
        status="active",
        description="Projet de démonstration.",
    )
    db.add(project)
    # Flush so the project gets its UUID before we reference it below.
    await db.flush()

    # 3. Demo OpenClaw commands attached to the project (status: received).
    commands = [
        OpenClawCommand(
            source="openclaw",
            project_id=project.id,
            intent="analyze_photo",
            instruction=(
                "Analyse les photos du chantier Villa Ducos et fais un résumé "
                "des travaux à prévoir."
            ),
        ),
        OpenClawCommand(
            source="openclaw",
            project_id=project.id,
            intent="create_quote",
            instruction=(
                "Prépare un devis en brouillon pour la pose de placo et la "
                "peinture du salon."
            ),
        ),
        OpenClawCommand(
            source="openclaw",
            project_id=project.id,
            intent="create_site_report",
            instruction=(
                "Rédige un compte-rendu de la visite de chantier de ce matin."
            ),
        ),
        OpenClawCommand(
            source="openclaw",
            project_id=project.id,
            intent="analyze_tender",
            instruction=(
                "Analyse l'appel d'offre reçu et identifie les lots et les "
                "points de vigilance."
            ),
        ),
    ]
    db.add_all(commands)

    # 4. A couple of audit log lines.
    db.add_all(
        [
            Log(
                project_id=project.id,
                level="info",
                event_type="seed.project_created",
                message="Projet de démonstration créé (Chantier Villa Ducos).",
                payload={"project": project.name},
            ),
            Log(
                level="info",
                event_type="seed.agents_registered",
                message="Agents intégrés enregistrés depuis le registre.",
                payload={"count": len(registry.list())},
            ),
        ]
    )

    await db.commit()
