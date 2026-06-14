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

from pydantic import BaseModel, ConfigDict, Field

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
