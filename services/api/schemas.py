"""Pydantic v2 schemas for the BTP OpenClaw Cockpit API.

For every entity we expose three shapes:

* ``<X>Create`` — payload accepted when creating a row.
* ``<X>Read``   — full representation returned to clients (all columns + id +
  timestamps).
* ``<X>Update`` — partial payload; every field is optional.

Plus the auth helpers (:class:`Token`, :class:`LoginRequest`), the OpenClaw
command intake schema and the approval decision schema.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from enums import (
    ApprovalStatus,
    CommandStatus,
    DocumentStatus,
    LLMProvider,
    RiskLevel,
    SkillSource,
    TaskStatus,
)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: str
    password: str


# ---------------------------------------------------------------------------
# Project
# ---------------------------------------------------------------------------
class ProjectCreate(BaseModel):
    name: str
    client_name: str | None = None
    address: str | None = None
    project_type: str | None = None
    status: str = "active"
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    client_name: str | None = None
    address: str | None = None
    project_type: str | None = None
    status: str | None = None
    description: str | None = None


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    client_name: str | None = None
    address: str | None = None
    project_type: str | None = None
    status: str
    description: str | None = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# OpenClaw command
# ---------------------------------------------------------------------------
class OpenClawCommandCreate(BaseModel):
    source: str = "openclaw"
    instruction: str
    project_id: uuid.UUID | None = None
    intent: str | None = None


class OpenClawCommandUpdate(BaseModel):
    intent: str | None = None
    status: CommandStatus | None = None
    risk_level: RiskLevel | None = None
    requires_approval: bool | None = None
    result: dict | None = None


class OpenClawCommandRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source: str
    project_id: uuid.UUID | None = None
    intent: str | None = None
    instruction: str
    status: str
    risk_level: str
    requires_approval: bool
    result: dict | None = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------
class AgentCreate(BaseModel):
    name: str
    slug: str
    role: str | None = None
    description: str | None = None
    agent_type: str | None = None
    version: str = "1.0.0"
    status: str = "idle"
    enabled: bool = True
    risk_level: str = RiskLevel.LOW.value
    config: dict | None = None
    input_schema: dict | None = None
    output_schema: dict | None = None
    provider: str = LLMProvider.ANTHROPIC.value
    model: str | None = None


class AgentUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    description: str | None = None
    agent_type: str | None = None
    version: str | None = None
    status: str | None = None
    enabled: bool | None = None
    risk_level: str | None = None
    config: dict | None = None
    input_schema: dict | None = None
    output_schema: dict | None = None
    provider: str | None = None
    model: str | None = None


class AgentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    role: str | None = None
    description: str | None = None
    agent_type: str | None = None
    version: str
    status: str
    enabled: bool
    risk_level: str
    config: dict | None = None
    input_schema: dict | None = None
    output_schema: dict | None = None
    provider: str
    model: str | None = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Task
# ---------------------------------------------------------------------------
class TaskCreate(BaseModel):
    title: str
    instruction: str
    project_id: uuid.UUID | None = None
    command_id: uuid.UUID | None = None
    agent_id: uuid.UUID | None = None
    status: str = TaskStatus.PENDING.value
    priority: str = "normal"


class TaskUpdate(BaseModel):
    title: str | None = None
    instruction: str | None = None
    project_id: uuid.UUID | None = None
    command_id: uuid.UUID | None = None
    agent_id: uuid.UUID | None = None
    status: TaskStatus | None = None
    priority: str | None = None
    result: dict | None = None
    error: str | None = None
    completed_at: datetime | None = None


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID | None = None
    command_id: uuid.UUID | None = None
    agent_id: uuid.UUID | None = None
    title: str
    instruction: str
    status: str
    priority: str
    result: dict | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


# ---------------------------------------------------------------------------
# Approval
# ---------------------------------------------------------------------------
class ApprovalCreate(BaseModel):
    title: str
    description: str | None = None
    project_id: uuid.UUID | None = None
    command_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    status: str = ApprovalStatus.PENDING.value
    risk_level: str = RiskLevel.MEDIUM.value
    payload: dict | None = None


class ApprovalUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: ApprovalStatus | None = None
    risk_level: RiskLevel | None = None
    payload: dict | None = None
    decision_by: str | None = None
    decision_note: str | None = None
    decided_at: datetime | None = None


class ApprovalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID | None = None
    command_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    title: str
    description: str | None = None
    status: str
    risk_level: str
    payload: dict | None = None
    decision_by: str | None = None
    decision_note: str | None = None
    created_at: datetime
    decided_at: datetime | None = None


class ApprovalDecision(BaseModel):
    note: str | None = None


# ---------------------------------------------------------------------------
# Document
# ---------------------------------------------------------------------------
class DocumentCreate(BaseModel):
    document_type: str
    title: str
    project_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    file_path: str | None = None
    content: dict | None = None
    status: str = DocumentStatus.DRAFT.value


class DocumentUpdate(BaseModel):
    content: dict | None = None
    title: str | None = None
    status: str | None = None


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    document_type: str
    title: str
    file_path: str | None = None
    content: dict | None = None
    status: str
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Log
# ---------------------------------------------------------------------------
class LogCreate(BaseModel):
    event_type: str
    message: str
    level: str = "info"
    project_id: uuid.UUID | None = None
    command_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    agent_id: uuid.UUID | None = None
    payload: dict | None = None


class LogUpdate(BaseModel):
    level: str | None = None
    event_type: str | None = None
    message: str | None = None
    payload: dict | None = None


class LogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID | None = None
    command_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    agent_id: uuid.UUID | None = None
    level: str
    event_type: str
    message: str
    payload: dict | None = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Skill
# ---------------------------------------------------------------------------
class SkillCreate(BaseModel):
    name: str
    slug: str
    description: str | None = None
    source: str = SkillSource.MAISON.value
    instructions: str | None = None
    anthropic_skill_id: str | None = None
    enabled: bool = True


class SkillUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    source: str | None = None
    instructions: str | None = None
    anthropic_skill_id: str | None = None
    enabled: bool | None = None


class SkillRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    description: str | None = None
    source: str
    instructions: str | None = None
    anthropic_skill_id: str | None = None
    enabled: bool
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# CompanySettings
# ---------------------------------------------------------------------------
class CompanySettingsUpdate(BaseModel):
    company_name: str | None = None
    siret: str | None = None
    vat_number: str | None = None
    address: str | None = None
    email: str | None = None
    phone: str | None = None
    logo_url: str | None = None
    legal_mentions: str | None = None
    default_tva_rate: float | None = None


class CompanySettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_name: str
    siret: str | None = None
    vat_number: str | None = None
    address: str | None = None
    email: str | None = None
    phone: str | None = None
    logo_url: str | None = None
    legal_mentions: str | None = None
    default_tva_rate: float
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# OpenClaw status (Vague 6)
# ---------------------------------------------------------------------------
class OpenClawStatus(BaseModel):
    connected: bool
    last_seen: datetime | None = None
    model_info: dict | None = None


# ---------------------------------------------------------------------------
# TenderOffer (Veille AO)
# ---------------------------------------------------------------------------

def _validate_tender_url(v: str | None) -> str | None:
    """Valide qu'une URL d'offre est de schéma http ou https.

    Rejette silencieusement (retourne ``None``) toute valeur qui ne commence
    pas par ``http://`` ou ``https://``, évitant ainsi d'exposer des URLs
    ``javascript:``, ``data:`` ou ``vbscript:`` comme liens cliquables dans
    le frontend (XSS stocké) ou de transmettre des hôtes internes à
    browser-use (SSRF).
    """
    if v is None:
        return None
    stripped = v.strip()
    if not stripped:
        return None
    lower = stripped.lower()
    if lower.startswith("http://") or lower.startswith("https://"):
        return stripped
    return None


class TenderOfferCreate(BaseModel):
    title: str
    source: str = "manual"
    organization: str | None = None
    summary: str | None = None
    location: str | None = None
    region: str | None = None
    url: str | None = None
    lots: list | None = None
    deadline: datetime | None = None
    raw: dict | None = None
    score: float | None = None

    @field_validator("url", mode="before")
    @classmethod
    def _check_url(cls, v: object) -> str | None:
        """N'accepte que les URLs http/https (rejette javascript:, data:, etc.)."""
        return _validate_tender_url(str(v) if v is not None else None)


class TenderOfferUpdate(BaseModel):
    title: str | None = None
    source: str | None = None
    organization: str | None = None
    summary: str | None = None
    location: str | None = None
    region: str | None = None
    url: str | None = None
    lots: list | None = None
    deadline: datetime | None = None
    status: str | None = None
    score: float | None = None
    keywords_matched: list | None = None
    raw: dict | None = None
    document_id: uuid.UUID | None = None

    @field_validator("url", mode="before")
    @classmethod
    def _check_url(cls, v: object) -> str | None:
        """N'accepte que les URLs http/https (rejette javascript:, data:, etc.)."""
        return _validate_tender_url(str(v) if v is not None else None)


class TenderOfferRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    source: str
    organization: str | None = None
    summary: str | None = None
    lots: list | None = None
    location: str | None = None
    region: str | None = None
    deadline: datetime | None = None
    url: str | None = None
    status: str
    score: float | None = None
    keywords_matched: list | None = None
    raw: dict | None = None
    dedup_key: str | None = None
    document_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# VeilleConfig (singleton de configuration de la veille AO)
# ---------------------------------------------------------------------------
class VeilleConfigUpdate(BaseModel):
    # Bornes de sécurité : interval_minutes >= 15 min (l'API Perplexity est
    # payante — empêche une veille en boucle quasi-continue) et <= 7 jours ;
    # les heures de silence restent dans 0..23 ; les listes sont plafonnées
    # pour borner la taille du prompt envoyé au LLM.
    enabled: bool | None = None
    interval_minutes: int | None = Field(default=None, ge=15, le=10080)
    quiet_start: int | None = Field(default=None, ge=0, le=23)
    quiet_end: int | None = Field(default=None, ge=0, le=23)
    keywords: list | None = Field(default=None, max_length=50)
    regions: list | None = Field(default=None, max_length=50)
    sources: list | None = Field(default=None, max_length=10)
    perplexity_model: str | None = Field(default=None, max_length=100)
    search_prompt: str | None = Field(default=None, max_length=4000)
    timezone: str | None = Field(default=None, max_length=64)

    @field_validator("timezone")
    @classmethod
    def _check_timezone(cls, v: str | None) -> str | None:
        """Refuse un fuseau IANA inconnu (sinon quiet hours seraient ignorées)."""
        if v is None:
            return None
        try:
            from zoneinfo import ZoneInfo

            ZoneInfo(v)
        except Exception as exc:  # ZoneInfoNotFoundError, etc.
            raise ValueError(f"Fuseau horaire invalide : {v!r}") from exc
        return v


class VeilleConfigRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    enabled: bool
    interval_minutes: int
    quiet_start: int | None = None
    quiet_end: int | None = None
    timezone: str = "America/Martinique"
    keywords: list | None = None
    regions: list | None = None
    sources: list | None = None
    perplexity_model: str = "sonar"
    search_prompt: str | None = None
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None
    last_status: str | None = None
    last_error: str | None = None
    last_count: int | None = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# TenderAnalyzeRequest (body de POST /{tender_id}/analyze)
# ---------------------------------------------------------------------------
class TenderAnalyzeRequest(BaseModel):
    instruction: str | None = None
    provider: str | None = None
    model: str | None = None
