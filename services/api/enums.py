"""Shared string enums for the BTP OpenClaw Cockpit backend.

Each enum inherits from ``str`` so values serialize transparently to JSON and
persist as plain text columns in PostgreSQL.
"""

from enum import Enum


class TaskStatus(str, Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    BLOCKED = "blocked"


class DocumentStatus(str, Enum):
    DRAFT = "draft"
    WAITING_APPROVAL = "waiting_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    SENT = "sent"
    ARCHIVED = "archived"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class CommandStatus(str, Enum):
    RECEIVED = "received"
    ROUTING = "routing"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"


class LLMProvider(str, Enum):
    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    GOOGLE = "google"
    DEEPSEEK = "deepseek"


class SkillSource(str, Enum):
    MAISON = "maison"
    ANTHROPIC = "anthropic"


class TenderStatus(str, Enum):
    NEW = "new"
    SEEN = "seen"
    ANALYZING = "analyzing"
    RESPONDED = "responded"
    IGNORED = "ignored"


class TenderSource(str, Enum):
    PERPLEXITY = "perplexity"
    BROWSER_USE = "browser_use"
    OFFICIAL = "official"
    MANUAL = "manual"


class DocumentType(str, Enum):
    QUOTE = "quote"
    SITE_REPORT = "site_report"
    TENDER_RESPONSE = "tender_response"
    RAPPORT_CHANTIER = "rapport_chantier"
    ANALYSE_AO = "analyse_ao"
    DPGF = "dpgf"
    DCE = "dce"
    CCTP = "cctp"
    CCAP = "ccap"
    INTERVENTION = "intervention"
