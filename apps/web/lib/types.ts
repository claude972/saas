/* ============================================================
   Shared types — aligned with backend Pydantic schemas + enums.
   UI text is French; types/code are English.
   ============================================================ */

// ---------- Enums (string literals, mirror backend enums.py) ----------

export type RiskLevel = "low" | "medium" | "high" | "blocked";

export type TaskStatus =
  | "pending"
  | "assigned"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type DocumentStatus =
  | "draft"
  | "waiting_approval"
  | "approved"
  | "rejected"
  | "sent"
  | "archived";

export type ApprovalStatus = "pending" | "accepted" | "rejected";

export type CommandStatus =
  | "received"
  | "routing"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed";

export type TaskPriority = "low" | "normal" | "high";

export type ProjectStatus = "active" | "archived" | "on_hold";

export type LogLevel = "info" | "warn" | "error";

// Generic JSON payload shape for free-form result/content/config fields.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

// ---------- Auth ----------

export interface AuthUser {
  email: string;
  name?: string | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

// ---------- Entities (mirror the 7 tables) ----------

export interface Project {
  id: string;
  name: string;
  client_name: string;
  address?: string | null;
  project_type?: string | null;
  status: ProjectStatus | string;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpenClawCommand {
  id: string;
  source: string;
  project_id?: string | null;
  intent?: string | null;
  instruction: string;
  status: CommandStatus;
  risk_level: RiskLevel;
  requires_approval: boolean;
  result?: JsonObject | null;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  name: string;
  slug: string;
  role: string;
  description?: string | null;
  agent_type?: string | null;
  version: string;
  status: string;
  enabled: boolean;
  risk_level: RiskLevel;
  config?: JsonObject | null;
  input_schema?: JsonObject | null;
  output_schema?: JsonObject | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id?: string | null;
  command_id?: string | null;
  agent_id?: string | null;
  title: string;
  instruction: string;
  status: TaskStatus;
  priority: TaskPriority | string;
  result?: JsonObject | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface Approval {
  id: string;
  project_id?: string | null;
  command_id?: string | null;
  task_id?: string | null;
  title: string;
  description?: string | null;
  status: ApprovalStatus;
  risk_level: RiskLevel;
  payload?: JsonObject | null;
  decision_by?: string | null;
  decision_note?: string | null;
  created_at: string;
  decided_at?: string | null;
}

// Named AppDocument to avoid clashing with the DOM `Document` global.
export interface AppDocument {
  id: string;
  project_id?: string | null;
  task_id?: string | null;
  document_type: string;
  title: string;
  file_path?: string | null;
  content?: JsonObject | null;
  status: DocumentStatus;
  created_at: string;
  updated_at: string;
}

export interface LogEntry {
  id: string;
  project_id?: string | null;
  command_id?: string | null;
  task_id?: string | null;
  agent_id?: string | null;
  level: LogLevel | string;
  event_type: string;
  message: string;
  payload?: JsonObject | null;
  created_at: string;
}

// ---------- Request bodies ----------

export interface LoginInput {
  email: string;
  password: string;
}

export interface SendCommandInput {
  source: string;
  instruction: string;
  project_id?: string | null;
  intent?: string | null;
}

export interface CreateProjectInput {
  name: string;
  client_name: string;
  address?: string | null;
  project_type?: string | null;
  description?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  client_name?: string;
  address?: string | null;
  project_type?: string | null;
  status?: string;
  description?: string | null;
}

export interface UpdateAgentInput {
  name?: string;
  role?: string;
  description?: string | null;
  enabled?: boolean;
  status?: string;
  config?: JsonObject | null;
}

export interface UpdateTaskInput {
  title?: string;
  status?: TaskStatus;
  priority?: string;
  result?: JsonObject | null;
  error?: string | null;
}

export interface ApprovalDecisionInput {
  note?: string;
}
