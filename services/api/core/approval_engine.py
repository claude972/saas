"""Human-in-the-loop approval workflow.

Sensitive results (quotes, tender responses, client-facing outputs, anything
high risk) are not finalised by the agents. Instead the command router creates
an :class:`Approval` and pauses. A human then accepts or rejects it, and
:func:`apply_decision` propagates that decision to the linked task and document.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.audit_logger import log_event
from enums import ApprovalStatus, DocumentStatus, RiskLevel, TaskStatus
from models import Approval, Document, Task


async def create_approval(
    db: AsyncSession,
    *,
    title: str,
    description: str | None,
    risk_level: RiskLevel | str,
    project_id: uuid.UUID | None,
    command_id: uuid.UUID | None,
    task_id: uuid.UUID | None,
    payload: dict | None,
) -> Approval:
    """Create a pending approval and commit it.

    ``risk_level`` accepts either a :class:`RiskLevel` or its raw string value.
    """
    risk_value = risk_level.value if isinstance(risk_level, RiskLevel) else risk_level

    approval = Approval(
        title=title,
        description=description,
        status=ApprovalStatus.PENDING.value,
        risk_level=risk_value,
        project_id=project_id,
        command_id=command_id,
        task_id=task_id,
        payload=payload,
    )
    db.add(approval)
    await db.commit()
    await db.refresh(approval)

    await log_event(
        db,
        event_type="approval.requested",
        message=f"Validation humaine requise: {title}",
        level="warning",
        project_id=project_id,
        command_id=command_id,
        task_id=task_id,
        payload={"approval_id": str(approval.id), "risk_level": risk_value},
    )
    return approval


async def apply_decision(
    db: AsyncSession,
    approval: Approval,
    accepted: bool,
    note: str | None,
    decided_by: str,
) -> Approval:
    """Apply a human decision to an approval and its linked entities.

    Accepted  -> linked document(s) approved, linked task completed.
    Rejected  -> linked document(s) rejected, linked task cancelled.

    Stamps the approval with its outcome, decision metadata and timestamp, then
    journalises the decision. Returns the updated approval.
    """
    now = datetime.now(timezone.utc)

    approval.status = (
        ApprovalStatus.ACCEPTED.value if accepted else ApprovalStatus.REJECTED.value
    )
    approval.decision_note = note
    approval.decision_by = decided_by
    approval.decided_at = now

    # Resolve the linked task (if any).
    task: Task | None = None
    if approval.task_id is not None:
        task = await db.get(Task, approval.task_id)

    # Resolve the linked document(s): documents attached to the same task.
    documents: list[Document] = []
    if approval.task_id is not None:
        result = await db.execute(
            select(Document).where(Document.task_id == approval.task_id)
        )
        documents = list(result.scalars().all())

    if accepted:
        for document in documents:
            document.status = DocumentStatus.APPROVED.value
        if task is not None:
            task.status = TaskStatus.COMPLETED.value
            task.completed_at = now
    else:
        for document in documents:
            document.status = DocumentStatus.REJECTED.value
        if task is not None:
            task.status = TaskStatus.CANCELLED.value

    await db.commit()
    await db.refresh(approval)

    await log_event(
        db,
        event_type="approval.decided",
        message=(
            f"Validation {'acceptee' if accepted else 'refusee'} par {decided_by}: "
            f"{approval.title}"
        ),
        level="info" if accepted else "warning",
        project_id=approval.project_id,
        command_id=approval.command_id,
        task_id=approval.task_id,
        payload={
            "approval_id": str(approval.id),
            "accepted": accepted,
            "decided_by": decided_by,
            "note": note,
            "documents": [str(d.id) for d in documents],
        },
    )
    return approval
