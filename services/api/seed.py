"""Idempotent database seeding for the BTP OpenClaw Cockpit.

``seed(db)`` is invoked by the FastAPI lifespan on startup. It populates the
database the first time it runs and is a no-op afterwards:

  1. inserts the four built-in sub-agents from :data:`agents.registry.registry`,
  2. inserts one demo project (Chantier Villa Ducos),
  3. inserts a few demo OpenClaw commands attached to that project,
  4. inserts a couple of audit log lines,
  5. inserts built-in Skills (maison),
  6. inserts a default CompanySettings singleton.

Each section has its own idempotency guard so the function stays safe even if
called after a partial previous run.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.registry import registry
from models import Agent, CompanySettings, Log, OpenClawCommand, Project, Skill


async def seed(db: AsyncSession) -> None:
    """Seed the database with built-in agents and demo data (idempotent)."""
    # ------------------------------------------------------------------
    # Section 1 – Built-in agents + demo project/commands/logs
    # Idempotency guard: skip if any agent already exists.
    # ------------------------------------------------------------------
    existing_agents = await db.scalar(select(func.count()).select_from(Agent))
    if not existing_agents:
        # 1a. Built-in agents from the registry metadata.
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
                    provider="anthropic",
                    model=None,  # None => use provider default (OPENCLAW_MODEL)
                    config={},
                    input_schema={},
                    output_schema={},
                )
            )

        # 1b. Demo project.
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

        # 1c. Demo OpenClaw commands attached to the project (status: received).
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

        # 1d. A couple of audit log lines.
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

    # ------------------------------------------------------------------
    # Section 2 – Built-in Skills (maison)
    # Idempotency guard: skip if any skill already exists.
    # ------------------------------------------------------------------
    existing_skills = await db.scalar(select(func.count()).select_from(Skill))
    if not existing_skills:
        skills = [
            Skill(
                name="Métré prudent BTP",
                slug="metre-prudent-btp",
                description=(
                    "Applique un métré conservateur : ajoute 5 % de réserve sur "
                    "toutes les quantités et signale explicitement les zones "
                    "d'incertitude. Utilisé pour les devis en phase esquisse."
                ),
                source="maison",
                instructions=(
                    "Lors de l'estimation des quantités de matériaux et des surfaces, "
                    "majore systématiquement chaque poste de 5 % pour tenir compte "
                    "des chutes et imprévus. Indique clairement dans le document "
                    "généré les postes où la mesure est approximative et précise "
                    "la réserve appliquée."
                ),
                enabled=True,
            ),
            Skill(
                name="Mentions légales devis FR",
                slug="mentions-legales-devis-fr",
                description=(
                    "Injecte les mentions légales obligatoires sur les devis "
                    "français (délai de validité, TVA, conditions de paiement, "
                    "garanties légales)."
                ),
                source="maison",
                instructions=(
                    "Ajoute obligatoirement les mentions légales suivantes en bas "
                    "de chaque devis :\n"
                    "- Devis valable 30 jours à compter de sa date d'émission.\n"
                    "- TVA applicable selon le taux en vigueur (taux réduit 10 % "
                    "pour travaux de rénovation sur locaux d'habitation de plus de "
                    "2 ans, taux normal 20 % sinon).\n"
                    "- Paiement : 30 % à la commande, solde à la réception des "
                    "travaux. Pénalités de retard : taux légal en vigueur.\n"
                    "- Garantie décennale et assurance responsabilité civile "
                    "professionnelle souscrites. Attestations disponibles sur "
                    "demande.\n"
                    "- Droit de rétractation : 14 jours pour les contrats conclus "
                    "hors établissement (art. L221-18 Code de la consommation)."
                ),
                enabled=True,
            ),
            Skill(
                name="Sécurité chantier rappel",
                slug="securite-chantier-rappel",
                description=(
                    "Rappelle les points de sécurité essentiels dans les comptes-rendus "
                    "et rapports de chantier (EPI, balisage, consignations)."
                ),
                source="maison",
                instructions=(
                    "Dans tout compte-rendu ou rapport de chantier, ajoute une section "
                    "'Points sécurité' listant :\n"
                    "- Vérification du port des EPI obligatoires (casque, chaussures de "
                    "sécurité, gilet haute visibilité).\n"
                    "- État du balisage et des protections collectives (garde-corps, "
                    "filets, barrières).\n"
                    "- Signalement de toute situation dangereuse observée avec action "
                    "corrective proposée.\n"
                    "- Respect des procédures de consignation avant intervention sur "
                    "réseaux (électricité, gaz, eau)."
                ),
                enabled=True,
            ),
        ]
        db.add_all(skills)
        db.add(
            Log(
                level="info",
                event_type="seed.skills_created",
                message="Skills maison initiaux créés.",
                payload={"count": len(skills)},
            )
        )
        await db.commit()

    # ------------------------------------------------------------------
    # Section 3 – CompanySettings singleton
    # Idempotency guard: skip if a row already exists.
    # ------------------------------------------------------------------
    existing_settings = await db.scalar(
        select(func.count()).select_from(CompanySettings)
    )
    if not existing_settings:
        db.add(
            CompanySettings(
                company_name="Mon Entreprise BTP",
                siret=None,
                vat_number=None,
                address=None,
                email=None,
                phone=None,
                logo_url=None,
                legal_mentions=(
                    "Devis valable 30 jours. TVA selon taux en vigueur. "
                    "Garantie décennale souscrite."
                ),
                default_tva_rate=0.20,
            )
        )
        await db.commit()
