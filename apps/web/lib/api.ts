import { getToken } from "@/lib/auth";
import type {
  Agent,
  AppDocument,
  Approval,
  ApprovalDecisionInput,
  AuthUser,
  CreateProjectInput,
  LogEntry,
  LoginInput,
  LoginResponse,
  OpenClawCommand,
  Project,
  SendCommandInput,
  Task,
  UpdateAgentInput,
  UpdateProjectInput,
  UpdateTaskInput,
} from "@/lib/types";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Method = "GET" | "POST" | "PATCH";

interface RequestOptions {
  method?: Method;
  body?: unknown;
  /** When false, do not attach the Authorization header (used for /auth/login). */
  auth?: boolean;
}

async function request<T>(
  path: string,
  { method = "GET", body, auth = true }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    const token = getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new Error("Impossible de joindre le backend. Vérifiez qu'il est démarré.");
  }

  if (!res.ok) {
    throw new Error(await extractError(res));
  }

  // Some endpoints may legitimately return an empty body.
  const text = await res.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

async function extractError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
    if (detail) return JSON.stringify(detail);
  } catch {
    // fall through to status text
  }
  return `Erreur ${res.status} ${res.statusText}`.trim();
}

export const api = {
  // ---------- Auth ----------
  login(input: LoginInput): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: input,
      auth: false,
    });
  },
  me(): Promise<AuthUser> {
    return request<AuthUser>("/auth/me");
  },

  // ---------- OpenClaw ----------
  sendCommand(input: SendCommandInput): Promise<OpenClawCommand> {
    return request<OpenClawCommand>("/openclaw/command", {
      method: "POST",
      body: input,
    });
  },
  listCommands(): Promise<OpenClawCommand[]> {
    return request<OpenClawCommand[]>("/openclaw/commands");
  },
  getCommand(id: string): Promise<OpenClawCommand> {
    return request<OpenClawCommand>(`/openclaw/commands/${id}`);
  },

  // ---------- Projects ----------
  listProjects(): Promise<Project[]> {
    return request<Project[]>("/projects");
  },
  getProject(id: string): Promise<Project> {
    return request<Project>(`/projects/${id}`);
  },
  createProject(input: CreateProjectInput): Promise<Project> {
    return request<Project>("/projects", { method: "POST", body: input });
  },
  updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
    return request<Project>(`/projects/${id}`, {
      method: "PATCH",
      body: input,
    });
  },

  // ---------- Agents ----------
  listAgents(): Promise<Agent[]> {
    return request<Agent[]>("/agents");
  },
  getAgent(id: string): Promise<Agent> {
    return request<Agent>(`/agents/${id}`);
  },
  updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
    return request<Agent>(`/agents/${id}`, { method: "PATCH", body: input });
  },
  runAgent(id: string, input?: Record<string, unknown>): Promise<Task> {
    return request<Task>(`/agents/${id}/run`, {
      method: "POST",
      body: input ?? {},
    });
  },
  enableAgent(id: string): Promise<Agent> {
    return request<Agent>(`/agents/${id}/enable`, { method: "POST" });
  },
  disableAgent(id: string): Promise<Agent> {
    return request<Agent>(`/agents/${id}/disable`, { method: "POST" });
  },

  // ---------- Tasks ----------
  listTasks(): Promise<Task[]> {
    return request<Task[]>("/tasks");
  },
  getTask(id: string): Promise<Task> {
    return request<Task>(`/tasks/${id}`);
  },
  updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
    return request<Task>(`/tasks/${id}`, { method: "PATCH", body: input });
  },

  // ---------- Approvals ----------
  listApprovals(): Promise<Approval[]> {
    return request<Approval[]>("/approvals");
  },
  acceptApproval(id: string, input?: ApprovalDecisionInput): Promise<Approval> {
    return request<Approval>(`/approvals/${id}/accept`, {
      method: "POST",
      body: input ?? {},
    });
  },
  rejectApproval(id: string, input?: ApprovalDecisionInput): Promise<Approval> {
    return request<Approval>(`/approvals/${id}/reject`, {
      method: "POST",
      body: input ?? {},
    });
  },

  // ---------- Documents ----------
  listDocuments(): Promise<AppDocument[]> {
    return request<AppDocument[]>("/documents");
  },
  getDocument(id: string): Promise<AppDocument> {
    return request<AppDocument>(`/documents/${id}`);
  },

  // ---------- Logs ----------
  listLogs(): Promise<LogEntry[]> {
    return request<LogEntry[]>("/logs");
  },
  listProjectLogs(projectId: string): Promise<LogEntry[]> {
    return request<LogEntry[]>(`/logs/${projectId}`);
  },
};

export type Api = typeof api;
