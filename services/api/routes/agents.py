"""Agents API routes.

CRUD over the ``agents`` registry table plus three operational endpoints:

* ``POST /{id}/run``     — load the in-memory agent by slug, create a task and
  execute it detached via ``BackgroundTasks`` (mirroring the command router's
  lifecycle), then return the created task immediately.
* ``POST /{id}/enable``  — flip ``enabled`` to ``True``.
* ``POST /{id}/disable`` — flip ``enabled`` to ``False``.

The backend is the authority: agents never persist anything themselves. This
route is the only place a *manual* (command-less) agent run is orchestrated, and
it reuses the exact same risk / approval / audit machinery as OpenClaw commands.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.registry import build_agent, registry
from core import risk_engine
from core.approval_engine import create_approval
from core.audit_logger import log_event
from core.security import get_current_user
from database import async_session_maker
from deps import get_db
from enums import DocumentStatus, TaskStatus
from models import Agent, Document, Task
from schemas import AgentCreate, AgentRead, AgentUpdate, TaskRead

router = APIRouter()


class AgentRunRequest(BaseModel):
    """Optional body for a manual agent run.

    ``instruction`` overrides the agent description as the task instruction;
    ``project_id`` optionally attaches the run to a chantier.
    """

    instruction: str | None = None
    project_id: uuid.UUID | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _get_agent_or_404(db: AsyncSession, agent_id: uuid.UUID) -> Agent:
    """Fetch an agent row by id or raise ``404``."""
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent introuvable.",
        )
    return agent


# ---------------------------------------------------------------------------
# Background runner for a manual (command-less) agent run
# ---------------------------------------------------------------------------
async def _run_agent_task(task_id: uuid.UUID, agent_id: uuid.UUID, slug: str) -> None:
    """Execute a manually-triggered agent run detached from the request.

    Owns its own session. Never raises: any failure is recorded on the task and
    in the audit log. Mirrors the command router: run -> persist any document as
    a draft -> score risk -> gate behind approval when needed -> complete.
    """
    async with async_session_maker() as db:
        task = await db.get(Task, task_id)
        agent_row = await db.get(Agent, agent_id)
        if task is None or agent_row is None:
            return

        await log_event(
            db,
            event_type="task.created",
            message=f"Tache creee et demarree (run manuel): {task.title}",
            project_id=task.project_id,
            task_id=task.id,
            agent_id=agent_row.id,
            payload={"task_id": str(task.id), "slug": slug, "manual": True},
        )

        # Run the agent ----------------------------------------------------
        agent_input = {
            "instruction": task.instruction,
            "intent": None,
            "project_id": str(task.project_id) if task.project_id else None,
            "command_id": None,
            "manual": True,
            "provider": agent_row.provider or "anthropic",
            "model": agent_row.model,
            "skills_text": "",
        }
        try:
            agent = build_agent(agent_row)
            result = await agent.run(agent_input)
            if not isinstance(result, dict):
                result = {"raw": result}
        except Exception as exc:  # noqa: BLE001 - a run must never crash the worker
            task.status = TaskStatus.FAILED.value
            task.error = str(exc)
            agent_row.status = "idle"
            await db.commit()
            await log_event(
                db,
                event_type="agent.run",
                message=f"Echec de l'agent {slug}: {exc}",
                level="error",
                project_id=task.project_id,
                task_id=task.id,
                agent_id=agent_row.id,
                payload={"task_id": str(task.id)},
            )
            return

        task.result = result
        await db.commit()

        await log_event(
            db,
            event_type="agent.run",
            message=f"Agent {slug} execute (run manuel).",
            project_id=task.project_id,
            task_id=task.id,
            agent_id=agent_row.id,
            payload={"stub": bool(result.get("stub"))},
        )

        # Persist any generated document as a DRAFT ------------------------
        document: Document | None = None
        document_type = result.get("document_type")
        if document_type:
            document = Document(
                project_id=task.project_id,
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
                project_id=task.project_id,
                task_id=task.id,
                agent_id=agent_row.id,
                payload={
                    "document_id": str(document.id),
                    "document_type": document_type,
                },
            )

        # Risk + approval gate --------------------------------------------
        risk = risk_engine.compute_risk(document_type=document_type)
        needs_validation = risk_engine.requires_human_validation(
            risk,
            document_type=document_type,
        )

        if needs_validation:
            await create_approval(
                db,
                title=f"Validation requise — {document_type or slug}",
                description=(
                    result.get("title")
                    or f"Sortie de l'agent {slug} en attente de validation."
                ),
                risk_level=risk,
                project_id=task.project_id,
                command_id=None,
                task_id=task.id,
                payload={
                    "slug": slug,
                    "document_id": str(document.id) if document else None,
                    "result": result,
                },
            )

            task.status = TaskStatus.WAITING_APPROVAL.value
            if document is not None:
                document.status = DocumentStatus.WAITING_APPROVAL.value
            agent_row.status = "idle"
            await db.commit()
            # approval.requested is logged inside create_approval.
            return

        # No validation needed: complete the run --------------------------
        task.status = TaskStatus.COMPLETED.value
        task.completed_at = datetime.now(timezone.utc)
        agent_row.status = "idle"
        await db.commit()

        await log_event(
            db,
            event_type="task.completed",
            message=f"Run manuel termine: {slug}",
            project_id=task.project_id,
            task_id=task.id,
            agent_id=agent_row.id,
            payload={
                "risk_level": risk.value,
                "document_id": str(document.id) if document else None,
            },
        )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
@router.get("", response_model=list[AgentRead])
async def list_agents(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> list[Agent]:
    """List every registered agent, newest first."""
    result = await db.execute(select(Agent).order_by(Agent.created_at.desc()))
    return list(result.scalars().all())


@router.post("", response_model=AgentRead, status_code=status.HTTP_201_CREATED)
async def create_agent(
    payload: AgentCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Agent:
    """Create a new agent registry row."""
    existing = await db.execute(select(Agent).where(Agent.slug == payload.slug))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Un agent avec le slug '{payload.slug}' existe deja.",
        )

    data = payload.model_dump()
    # Agents whose slug is not a hard-coded registered class are always custom.
    if not registry.is_registered(data.get("slug", "")) and data.get("agent_type") is None:
        data["agent_type"] = "custom"
    agent = Agent(**data)
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    await log_event(
        db,
        event_type="agent.created",
        message=f"Agent cree: {agent.name} ({agent.slug})",
        agent_id=agent.id,
        payload={"slug": agent.slug},
    )
    return agent


@router.get("/{agent_id}", response_model=AgentRead)
async def get_agent(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Agent:
    """Fetch a single agent by id."""
    return await _get_agent_or_404(db, agent_id)


@router.patch("/{agent_id}", response_model=AgentRead)
async def update_agent(
    agent_id: uuid.UUID,
    payload: AgentUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Agent:
    """Partially update an agent. Only provided fields are written."""
    agent = await _get_agent_or_404(db, agent_id)

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(agent, field, value)

    await db.commit()
    await db.refresh(agent)

    await log_event(
        db,
        event_type="agent.updated",
        message=f"Agent mis a jour: {agent.name} ({agent.slug})",
        agent_id=agent.id,
        payload={"fields": list(data.keys())},
    )
    return agent


# ---------------------------------------------------------------------------
# Operational endpoints
# ---------------------------------------------------------------------------
@router.post("/{agent_id}/run", response_model=TaskRead, status_code=status.HTTP_202_ACCEPTED)
async def run_agent(
    agent_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    payload: AgentRunRequest | None = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Task:
    """Manually run an agent: create a task and execute it in the background.

    Rejects (``400``) a disabled agent or a slug not present in the in-memory
    registry, mirroring the command router's whitelist enforcement. Returns the
    freshly-created task (status ``running``) immediately; the actual execution
    happens detached via ``BackgroundTasks``.
    """
    agent = await _get_agent_or_404(db, agent_id)
    payload = payload or AgentRunRequest()

    if not agent.enabled:
        await log_event(
            db,
            event_type="agent.run_rejected",
            message=f"Run refuse — agent desactive: {agent.slug}",
            level="error",
            agent_id=agent.id,
            payload={"slug": agent.slug, "reason": "disabled"},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Agent desactive: {agent.slug}.",
        )

    # Hard-coded agents must be in the registry; custom agents are always allowed.
    if agent.agent_type != "custom" and not registry.is_registered(agent.slug):
        await log_event(
            db,
            event_type="agent.run_rejected",
            message=f"Run refuse — agent non enregistre: {agent.slug}",
            level="error",
            agent_id=agent.id,
            payload={"slug": agent.slug, "reason": "not_registered"},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Aucun agent enregistre pour le slug '{agent.slug}'.",
        )

    instruction = payload.instruction or agent.description or agent.name
    task = Task(
        project_id=payload.project_id,
        command_id=None,
        agent_id=agent.id,
        title=f"Run manuel — {agent.name}",
        instruction=instruction,
        status=TaskStatus.RUNNING.value,
        priority="normal",
    )
    db.add(task)
    agent.status = "running"
    await db.commit()
    await db.refresh(task)

    background_tasks.add_task(_run_agent_task, task.id, agent.id, agent.slug)
    return task


@router.post("/{agent_id}/enable", response_model=AgentRead)
async def enable_agent(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Agent:
    """Enable an agent (``enabled = True``)."""
    agent = await _get_agent_or_404(db, agent_id)
    agent.enabled = True
    await db.commit()
    await db.refresh(agent)

    await log_event(
        db,
        event_type="agent.enabled",
        message=f"Agent active: {agent.name} ({agent.slug})",
        agent_id=agent.id,
        payload={"slug": agent.slug},
    )
    return agent


@router.post("/{agent_id}/disable", response_model=AgentRead)
async def disable_agent(
    agent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
) -> Agent:
    """Disable an agent (``enabled = False``)."""
    agent = await _get_agent_or_404(db, agent_id)
    agent.enabled = False
    await db.commit()
    await db.refresh(agent)

    await log_event(
        db,
        event_type="agent.disabled",
        message=f"Agent desactive: {agent.name} ({agent.slug})",
        agent_id=agent.id,
        payload={"slug": agent.slug},
    )
    return agent
