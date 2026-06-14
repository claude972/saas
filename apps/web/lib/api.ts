import { getToken } from "@/lib/auth";
import type {
  Agent,
  AppDocument,
  Approval,
  ApprovalDecisionInput,
  AuthUser,
  CompanySettings,
  CompanySettingsUpdateInput,
  CreateAgentInput,
  CreateProjectInput,
  ExportFormat,
  LLMConfig,
  LogEntry,
  LoginInput,
  LoginResponse,
  OpenClawCommand,
  OpenClawStatus,
  Project,
  SendCommandInput,
  Skill,
  SkillCreateInput,
  SkillUpdateInput,
  Task,
  TenderAnalyzeResult,
  TenderOffer,
  TenderOfferUpdateInput,
  UpdateAgentInput,
  UpdateDocumentInput,
  UpdateProjectInput,
  UpdateTaskInput,
  VeilleConfig,
  VeilleConfigUpdateInput,
} from "@/lib/types";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

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
  createAgent(input: CreateAgentInput): Promise<Agent> {
    return request<Agent>("/agents", { method: "POST", body: input });
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

  // ---------- Skills ----------
  listSkills(): Promise<Skill[]> {
    return request<Skill[]>("/skills");
  },
  getSkill(id: string): Promise<Skill> {
    return request<Skill>(`/skills/${id}`);
  },
  createSkill(input: SkillCreateInput): Promise<Skill> {
    return request<Skill>("/skills", { method: "POST", body: input });
  },
  updateSkill(id: string, input: SkillUpdateInput): Promise<Skill> {
    return request<Skill>(`/skills/${id}`, { method: "PATCH", body: input });
  },
  deleteSkill(id: string): Promise<void> {
    return request<void>(`/skills/${id}`, { method: "DELETE" });
  },
  async importSkill(file: File): Promise<Skill> {
    const form = new FormData();
    form.append("file", file);

    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/skills/import`, {
        method: "POST",
        headers,
        body: form,
        cache: "no-store",
      });
    } catch {
      throw new Error("Impossible de joindre le backend. Vérifiez qu'il est démarré.");
    }

    if (!res.ok) {
      throw new Error(await extractError(res));
    }

    return JSON.parse(await res.text()) as Skill;
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
  updateDocument(id: string, input: UpdateDocumentInput): Promise<AppDocument> {
    return request<AppDocument>(`/documents/${id}`, {
      method: "PATCH",
      body: input,
    });
  },
  /** Returns the URL to fetch directly (StreamingResponse — not JSON). */
  exportDocumentUrl(id: string, format: ExportFormat): string {
    return `${BASE_URL}/documents/${id}/export?format=${format}`;
  },

  // ---------- Logs ----------
  listLogs(): Promise<LogEntry[]> {
    return request<LogEntry[]>("/logs");
  },
  listProjectLogs(projectId: string): Promise<LogEntry[]> {
    return request<LogEntry[]>(`/logs/${projectId}`);
  },

  // ---------- Settings ----------
  getCompanySettings(): Promise<CompanySettings> {
    return request<CompanySettings>("/settings/company");
  },
  updateCompanySettings(input: CompanySettingsUpdateInput): Promise<CompanySettings> {
    return request<CompanySettings>("/settings/company", {
      method: "PATCH",
      body: input,
    });
  },
  getLlmConfig(): Promise<LLMConfig> {
    return request<LLMConfig>("/settings/llm");
  },

  // ---------- OpenClaw status ----------
  getOpenclawStatus(): Promise<OpenClawStatus> {
    return request<OpenClawStatus>("/openclaw/status");
  },

  // ---------- Tenders / Veille ----------

  /**
   * Liste les appels d'offres avec filtres optionnels.
   */
  listTenders(params?: {
    status?: string;
    region?: string;
    source?: string;
    limit?: number;
  }): Promise<TenderOffer[]> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.region) qs.set("region", params.region);
    if (params?.source) qs.set("source", params.source);
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return request<TenderOffer[]>(`/tenders${query ? `?${query}` : ""}`);
  },

  /**
   * Retourne uniquement les offres au statut "new".
   */
  listNewTenders(limit?: number): Promise<TenderOffer[]> {
    const qs = limit !== undefined ? `?limit=${limit}` : "";
    return request<TenderOffer[]>(`/tenders/new${qs}`);
  },

  /**
   * Récupère une offre par son identifiant.
   */
  getTender(id: string): Promise<TenderOffer> {
    return request<TenderOffer>(`/tenders/${id}`);
  },

  /**
   * Crée une offre manuelle.
   */
  createTender(input: {
    title: string;
    source?: string;
    organization?: string | null;
    summary?: string | null;
    location?: string | null;
    region?: string | null;
    url?: string | null;
    lots?: unknown[] | null;
    deadline?: string | null;
    raw?: Record<string, unknown> | null;
    score?: number | null;
  }): Promise<TenderOffer> {
    return request<TenderOffer>("/tenders", { method: "POST", body: input });
  },

  /**
   * Met à jour partiellement une offre (statut, score, etc.).
   */
  updateTender(id: string, input: TenderOfferUpdateInput): Promise<TenderOffer> {
    return request<TenderOffer>(`/tenders/${id}`, {
      method: "PATCH",
      body: input,
    });
  },

  /**
   * Supprime une offre (204 No Content).
   */
  deleteTender(id: string): Promise<void> {
    return request<void>(`/tenders/${id}`, { method: "DELETE" });
  },

  /**
   * Lance l'analyse IA d'une offre et retourne le document généré (analyse_ao).
   */
  analyzeTender(id: string, instruction?: string): Promise<TenderAnalyzeResult> {
    return request<TenderAnalyzeResult>(`/tenders/${id}/analyze`, {
      method: "POST",
      body: instruction ? { instruction } : {},
    });
  },

  /**
   * Déclenche immédiatement un cycle de veille AO.
   */
  runVeille(): Promise<{ count: number; new_ids: string[] }> {
    return request<{ count: number; new_ids: string[] }>("/veille/run", {
      method: "POST",
    });
  },

  /**
   * Récupère la configuration de la veille automatique.
   */
  getVeilleConfig(): Promise<VeilleConfig> {
    return request<VeilleConfig>("/veille/config");
  },

  /**
   * Met à jour la configuration de la veille automatique.
   */
  updateVeilleConfig(input: VeilleConfigUpdateInput): Promise<VeilleConfig> {
    return request<VeilleConfig>("/veille/config", {
      method: "PUT",
      body: input,
    });
  },
};

export type Api = typeof api;
