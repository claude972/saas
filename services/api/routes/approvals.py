"""Human-in-the-loop approval routes.

Sensitive agent outputs (quotes, tender responses, client-facing documents,
anything high risk) are paused as pending :class:`Approval` rows by the command
router. A human operator then accepts or rejects each one here; the decision is
propagated to the linked task and document(s) by
:func:`core.approval_engine.apply_decision`, which also writes the authoritative
``approval.decided`` audit log.

All routes require an authenticated user.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.approval_engine import apply_decision
from core.security import get_current_user
from deps import get_db
from enums import ApprovalStatus
from models import Approval
from schemas import ApprovalDecision, ApprovalRead

router = APIRouter()


async def _get_approval_or_404(db: AsyncSession, approval_id: uuid.UUID) -> Approval:
    """Load an approval by id or raise ``404``."""
    approval = await db.get(Approval, approval_id)
    if approval is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Validation introuvable.",
        )
    return approval


@router.get("", response_model=list[ApprovalRead])
async def list_approvals(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> list[Approval]:
    """List approvals, most recent first.

    When ``status`` is provided the result is filtered to that status
    (``pending`` | ``accepted`` | ``rejected``); otherwise every approval is
    returned.
    """
    query = select(Approval)
    if status is not None:
        query = query.where(Approval.status == status)
    query = query.order_by(Approval.created_at.desc())

    result = await db.execute(query)
    return list(result.scalars().all())


@router.post("/{approval_id}/accept", response_model=ApprovalRead)
async def accept_approval(
    approval_id: uuid.UUID,
    decision: ApprovalDecision,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> Approval:
    """Accept a pending approval and finalise its linked task and document(s)."""
    approval = await _get_approval_or_404(db, approval_id)

    if approval.status != ApprovalStatus.PENDING.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cette validation a deja ete tranchee.",
        )

    return await apply_decision(
        db,
        approval,
        accepted=True,
        note=decision.note,
        decided_by=current_user["email"],
    )


@router.post("/{approval_id}/reject", response_model=ApprovalRead)
async def reject_approval(
    approval_id: uuid.UUID,
    decision: ApprovalDecision,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> Approval:
    """Reject a pending approval and cancel its linked task and document(s)."""
    approval = await _get_approval_or_404(db, approval_id)

    if approval.status != ApprovalStatus.PENDING.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cette validation a deja ete tranchee.",
        )

    return await apply_decision(
        db,
        approval,
        accepted=False,
        note=decision.note,
        decided_by=current_user["email"],
    )
