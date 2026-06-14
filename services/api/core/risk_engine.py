"""Risk classification rules for the cockpit.

Two pure functions implement the V1 security policy described in the brief:

``compute_risk``
    Maps an (intent, document_type, action) triple to a :class:`RiskLevel`.

``requires_human_validation``
    Decides whether a result must be gated behind a human approval before it is
    considered done.

The rules are intentionally conservative: anything that could leave the system
(send to client, external action) or touch validated/critical data escalates.
"""

from __future__ import annotations

from enums import RiskLevel

# Intents that, on their own, carry a given baseline risk.
_LOW_INTENTS = {"analyze_photo"}
_MEDIUM_INTENTS = {
    "create_quote",
    "create_quote_from_photo",
    "create_site_report",
    "analyze_tender",
}

# Document types whose creation is a medium-risk drafting operation.
_MEDIUM_DOCUMENT_TYPES = {
    "quote",
    "tender_response",
    "site_report",
    "document_update",
}

# Actions that escalate to high risk (anything leaving the system or mutating
# validated data).
_HIGH_ACTIONS = {
    "send_to_client",
    "delete",
    "external_action",
    "update_validated_data",
}

# Actions that are outright blocked in V1.
_BLOCKED_ACTIONS = {
    "delete_database",
    "expose_secrets",
}

# Document types considered a client-facing output (sortie client).
_CLIENT_FACING_DOCUMENT_TYPES = {"quote", "tender_response"}


def compute_risk(
    intent: str | None = None,
    document_type: str | None = None,
    action: str | None = None,
) -> RiskLevel:
    """Compute the risk level of an operation.

    Highest matching tier wins: blocked > high > medium > low.
    """
    if action in _BLOCKED_ACTIONS:
        return RiskLevel.BLOCKED

    if action in _HIGH_ACTIONS:
        return RiskLevel.HIGH

    if document_type in _MEDIUM_DOCUMENT_TYPES:
        return RiskLevel.MEDIUM

    if intent in _MEDIUM_INTENTS:
        return RiskLevel.MEDIUM

    if intent in _LOW_INTENTS:
        return RiskLevel.LOW

    # Default: low-risk (analysis, draft, task creation, summary).
    return RiskLevel.LOW


def requires_human_validation(
    risk: RiskLevel,
    document_type: str | None = None,
    requires_approval: bool = False,
    action: str | None = None,
) -> bool:
    """Return True when a human must validate before the result is final.

    Triggers:
      * risk is high (or above),
      * the caller explicitly flagged ``requires_approval``,
      * the document is a quote or a tender response,
      * the action sends something to the client,
      * risk is medium AND the output is client-facing.
    """
    if risk in (RiskLevel.HIGH, RiskLevel.BLOCKED):
        return True

    if requires_approval:
        return True

    if document_type in ("quote", "tender_response"):
        return True

    if action == "send_to_client":
        return True

    if risk == RiskLevel.MEDIUM and document_type in _CLIENT_FACING_DOCUMENT_TYPES:
        return True

    return False
