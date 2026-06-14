"""OpenClaw command orchestration.

The backend is the authority. OpenClaw only *submits* an instruction; this
module decides what happens next:

1. classify the instruction into an intent (whitelist > LLM > heuristic),
2. resolve the responsible sub-agent (rejecting anything off the whitelist or a
   disabled agent),
3. create a task and run the agent,
4. persist any generated document as a *draft*,
5. score the risk and, when needed, open a human approval (pausing the flow),
6. journalise every single step.

``process_command`` owns its own database session because it runs detached from
the request via FastAPI ``BackgroundTasks``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agents import llm
from agents.registry import registry
from core import risk_engine
from core.approval_engine import create_approval
from core.audit_logger import log_event
from database import async_session_maker
from enums import CommandStatus, DocumentStatus, TaskStatus
from models import Agent, Document, OpenClawCommand, Task

# Whitelist: the ONLY intents OpenClaw may trigger and the agent each maps to.
INTENT_TO_AGENT: dict[str, str] = {
    "analyze_photo": "photo_analysis_agent",
    "create_quote": "quote_agent",
    "create_quote_from_photo": "quote_agent",
    "create_site_report": "site_report_agent",
    "analyze_tender": "tender_agent",
}

_DEFAULT_INTENT = "analyze_photo"


# ---------------------------------------------------------------------------
# Intent classification
# ---------------------------------------------------------------------------
def _heuristic_intent(instruction: str) -> str:
    """Keyword-based French fallback when no LLM is available."""
    text = instruction.lower()

    # Order matters: a photo-derived quote should still route to the quote agent.
    if "devis" in text:
        if "photo" in text:
            return "create_quote_from_photo"
        return "create_quote"
    if any(kw in text for kw in ("appel d'offre", "appel d offre", "ao", "dce")):
        return "analyze_tender"
    if any(kw in text for kw in ("compte-rendu", "compte rendu", "visite")):
        return "create_site_report"
    if "photo" in text:
        return "analyze_photo"
    return _DEFAULT_INTENT


async def classify_intent(
    instruction: str,
    provided_intent: str | None = None,
) -> str:
    """Resolve the intent for an instruction.

    Priority:
      1. an explicitly provided intent, if it is on the whitelist,
      2. the LLM classifier (when a client is configured),
      3. a French keyword heuristic,
      4. the default intent.
    """
    if provided_intent and provided_intent in INTENT_TO_AGENT:
        return provided_intent

    allowed = list(INTENT_TO_AGENT.keys())
    if llm.llm_available():
        try:
            intent = await llm.classify_intent_llm(instruction, allowed)
            if intent in INTENT_TO_AGENT:
                return intent
        except Exception:
            # Never let a classifier hiccup break routing — fall through.
            pass

    return _heuristic_intent(instruction)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
async def _fail_command(
    db: AsyncSession,
    command: OpenClawCommand,
    message: str,
    *,
    agent_id: uuid.UUID | None = None,
    payload: dict | None = None,
) -> None:
    """Mark a command failed and journalise the reason."""
    command.status = CommandStatus.FAILED.value
    command.result = {"error": message}
    await db.commit()
    await log_event(
        db,
        event_type="command.failed",
        message=message,
        level="error",
        project_id=command.project_id,
        command_id=command.id,
        agent_id=agent_id,
        payload=payload,
    )


async def process_command(command_id: uuid.UUID) -> None:
    """Full orchestration for a single OpenClaw command.

    Runs detached (BackgroundTasks) with its own session. Never raises: any
    failure is recorded on the command and in the audit log.
    """
    async with async_session_maker() as db:
        command = await db.get(OpenClawCommand, command_id)
        if command is None:
            # Nothing we can attach a log to reliably; just stop.
            return

        await log_event(
            db,
            event_type="command.received",
            message=f"Commande recue: {command.instruction[:200]}",
            project_id=command.project_id,
            command_id=command.id,
            payload={"source": command.source, "intent": command.intent},
        )

        # 1. Classify -------------------------------------------------------
        command.status = CommandStatus.ROUTING.value
        await db.commit()

        intent = await classify_intent(command.instruction, command.intent)
        command.intent = intent
        await db.commit()

        await log_event(
            db,
            event_type="command.routing",
            message=f"Intention classee: {intent}",
            project_id=command.project_id,
            command_id=command.id,
            payload={"intent": intent},
        )

        # 2. Resolve the agent (whitelist + enabled) ------------------------
        slug = INTENT_TO_AGENT.get(intent)
        if slug is None:
            await _fail_command(
                db,
                command,
                f"Intention hors whitelist: {intent}",
                payload={"intent": intent},
            )
            return

        agent_row = await _get_agent_by_slug(db, slug)
        if agent_row is None:
            await _fail_command(
                db,
                command,
                f"Agent introuvable pour le slug: {slug}",
                payload={"intent": intent, "slug": slug},
            )
            return
        if not agent_row.enabled:
            await _fail_command(
                db,
                command,
                f"Agent desactive: {slug}",
                agent_id=agent_row.id,
                payload={"intent": intent, "slug": slug},
            )
            return

        # 3. Create the task and flip statuses to running -------------------
        task = Task(
            project_id=command.project_id,
            command_id=command.id,
            agent_id=agent_row.id,
            title=f"{intent} — {command.instruction[:80]}",
            instruction=command.instruction,
            status=TaskStatus.RUNNING.value,
            priority="normal",
        )
        db.add(task)
        command.status = CommandStatus.RUNNING.value
        agent_row.status = "running"
        await db.commit()
        await db.refresh(task)

        await log_event(
            db,
            event_type="task.created",
            message=f"Tache creee et demarree: {task.title}",
            project_id=command.project_id,
            command_id=command.id,
            task_id=task.id,
            agent_id=agent_row.id,
            payload={"task_id": str(task.id)},
        )

        # 4. Run the agent --------------------------------------------------
        agent_input = {
            "instruction": command.instruction,
            "intent": intent,
            "project_id": str(command.project_id) if command.project_id else None,
            "command_id": str(command.id),
        }
        try:
            agent = registry.get(slug)
            result = await agent.run(agent_input)
            if not isinstance(result, dict):
                result = {"raw": result}
        except Exception as exc:  # noqa: BLE001 - agent must never crash routing
            task.status = TaskStatus.FAILED.value
            task.error = str(exc)
            agent_row.status = "idle"
            await db.commit()
            await _fail_command(
                db,
                command,
                f"Echec de l'agent {slug}: {exc}",
                agent_id=agent_row.id,
                payload={"task_id": str(task.id)},
            )
            return

        task.result = result
        await db.commit()

        await log_event(
            db,
            event_type="agent.run",
            message=f"Agent {slug} execute.",
            project_id=command.project_id,
            command_id=command.id,
            task_id=task.id,
            agent_id=agent_row.id,
            payload={"stub": bool(result.get("stub"))},
        )

        # 5. Persist any generated document as a DRAFT ----------------------
        document: Document | None = None
        document_type = result.get("document_type")
        if document_type:
            document = Document(
                project_id=command.project_id,
                task_id=task.id,
                document_type=document_type,
                title=result.get("title") or f"{document_type} (brouillon)",
                content=result.get("content"),
                status=DocumentStatus.DRAFT.value,
            )
            db.add(document)
            await db.commit()
            await db.refresh(document)

            await log_event(
                db,
                event_type="document.generated",
                message=f"Document genere (brouillon): {document.title}",
                project_id=command.project_id,
                command_id=command.id,
                task_id=task.id,
                agent_id=agent_row.id,
                payload={
                    "document_id": str(document.id),
                    "document_type": document_type,
                },
            )

        # 6. Risk + approval gate ------------------------------------------
        risk = risk_engine.compute_risk(intent=intent, document_type=document_type)
        needs_validation = risk_engine.requires_human_validation(
            risk,
            document_type=document_type,
            requires_approval=command.requires_approval,
        )

        command.risk_level = risk.value

        if needs_validation:
            await create_approval(
                db,
                title=f"Validation requise — {document_type or intent}",
                description=(
                    result.get("title")
                    or f"Sortie de l'agent {slug} en attente de validation."
                ),
                risk_level=risk,
                project_id=command.project_id,
                command_id=command.id,
                task_id=task.id,
                payload={
                    "intent": intent,
                    "slug": slug,
                    "document_id": str(document.id) if document else None,
                    "result": result,
                },
            )

            task.status = TaskStatus.WAITING_APPROVAL.value
            if document is not None:
                document.status = DocumentStatus.WAITING_APPROVAL.value
            command.status = CommandStatus.WAITING_APPROVAL.value
            command.requires_approval = True
            command.result = result
            agent_row.status = "idle"
            await db.commit()
            # approval.requested is logged inside create_approval.
            return

        # 7. No validation needed: complete the flow ------------------------
        task.status = TaskStatus.COMPLETED.value
        task.completed_at = datetime.now(timezone.utc)
        command.status = CommandStatus.COMPLETED.value
        command.result = result
        agent_row.status = "idle"
        await db.commit()

        await log_event(
            db,
            event_type="command.completed",
            message=f"Commande terminee: {intent}",
            project_id=command.project_id,
            command_id=command.id,
            task_id=task.id,
            agent_id=agent_row.id,
            payload={
                "intent": intent,
                "risk_level": risk.value,
                "document_id": str(document.id) if document else None,
            },
        )


async def _get_agent_by_slug(db: AsyncSession, slug: str) -> Agent | None:
    """Fetch the registered :class:`Agent` row for a slug, or ``None``."""
    result = await db.execute(select(Agent).where(Agent.slug == slug))
    return result.scalar_one_or_none()
