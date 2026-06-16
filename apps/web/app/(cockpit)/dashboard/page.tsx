"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OpenClawStatus } from "@/lib/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Terminal,
  Lock,
  Send,
  Camera,
  Receipt,
  ClipboardList,
  FileSearch,
  ArrowRight,
  ArrowRightToLine,
  Bot,
  ShieldCheck,
  Check,
  X,
  Ruler,
  Home,
  School,
  Warehouse,
  Building,
  Building2,
  type LucideIcon,
} from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type {
  Agent,
  AppDocument,
  Approval,
  LogEntry,
  OpenClawCommand,
  Project,
  RiskLevel,
  Task,
} from "@/lib/types";

/* ============================================================
   Static reference maps (icons / labels only — data is live)
   ============================================================ */

// intent -> agent slug (mirrors backend command_router.INTENT_TO_AGENT)
const INTENT_TO_AGENT: Record<string, string> = {
  analyze_photo: "photo_analysis_agent",
  create_quote: "quote_agent",
  create_quote_from_photo: "quote_agent",
  create_site_report: "site_report_agent",
  analyze_tender: "tender_agent",
};

// per-agent icon (UI only; falls back to a robot)
const AGENT_ICON: Record<string, LucideIcon> = {
  photo_analysis_agent: Camera,
  quote_agent: Receipt,
  site_report_agent: ClipboardList,
  tender_agent: FileSearch,
};

// short 2-letter monogram for agent avatars on project cards
const AGENT_MONO: Record<string, string> = {
  photo_analysis_agent: "PH",
  quote_agent: "DV",
  site_report_agent: "CR",
  tender_agent: "AO",
};

// quick-action chips -> intent forwarded to the OpenClaw command page
const CHIPS: { label: string; icon: LucideIcon; intent: string }[] = [
  { label: "Analyse photo", icon: Camera, intent: "analyze_photo" },
  { label: "Créer un devis", icon: Receipt, intent: "create_quote" },
  { label: "Compte-rendu chantier", icon: ClipboardList, intent: "create_site_report" },
  { label: "Analyser appel d'offre", icon: FileSearch, intent: "analyze_tender" },
];

// project-type icon heuristic (UI only)
function projectIcon(p: Project): LucideIcon {
  const hay = `${p.project_type ?? ""} ${p.name}`.toLowerCase();
  if (hay.includes("école") || hay.includes("scol") || hay.includes("group")) return School;
  if (hay.includes("entrep") || hay.includes("logist") || hay.includes("warehouse")) return Warehouse;
  if (hay.includes("copro") || hay.includes("façade") || hay.includes("raval") || hay.includes("immeu"))
    return Building;
  if (hay.includes("villa") || hay.includes("maison") || hay.includes("réno") || hay.includes("home"))
    return Home;
  return Building2;
}

/* ============================================================
   Small helpers
   ============================================================ */

const LIVE_TASK = new Set<Task["status"]>(["pending", "assigned", "running", "waiting_approval"]);
const LIVE_CMD = new Set<OpenClawCommand["status"]>(["received", "routing", "running", "waiting_approval"]);

function isLiveTask(t: Task): boolean {
  return LIVE_TASK.has(t.status);
}
function isLiveCommand(c: OpenClawCommand): boolean {
  return LIVE_CMD.has(c.status);
}

function timeHM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(d);
}

function timeHMS(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Math.max(0, Date.now() - d);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}

function withinDays(iso: string, days: number): boolean {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return false;
  return Date.now() - d <= days * 86400000;
}

const PRIORITY_LABEL: Record<string, { label: string; cls: string }> = {
  high: { label: "Haute", cls: "text-hot" },
  normal: { label: "Normale", cls: "text-text3" },
  low: { label: "Basse", cls: "text-text3 opacity-70" },
};

const LOG_DOT: Record<string, string> = {
  info: "bg-ok",
  warn: "bg-amber",
  error: "bg-stop",
};

/* ============================================================
   Data shape + fetch
   ============================================================ */

interface Bundle {
  projects: Project[];
  agents: Agent[];
  tasks: Task[];
  approvals: Approval[];
  commands: OpenClawCommand[];
  logs: LogEntry[];
  documents: AppDocument[];
}

const EMPTY: Bundle = {
  projects: [],
  agents: [],
  tasks: [],
  approvals: [],
  commands: [],
  logs: [],
  documents: [],
};

export default function DashboardPage() {
  const router = useRouter();

  const [data, setData] = useState<Bundle>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null); // approval id being decided
  const [ocStatus, setOcStatus] = useState<OpenClawStatus | null>(null);

  // keep a ref so the poller reads the freshest data without re-subscribing
  const dataRef = useRef<Bundle>(EMPTY);
  dataRef.current = data;

  const loadAll = useCallback(async (initial: boolean) => {
    try {
      const [projects, agents, tasks, approvals, commands, logs, documents] = await Promise.all([
        api.listProjects(),
        api.listAgents(),
        api.listTasks(),
        api.listApprovals(),
        api.listCommands(),
        api.listLogs(),
        api.listDocuments(),
      ]);
      setData({ projects, agents, tasks, approvals, commands, logs, documents });
      setError(null);
    } catch (e) {
      // On the initial load a failure is fatal for the page; on a poll we keep
      // the last good snapshot and just surface the message.
      setError(e instanceof Error ? e.message : "Erreur de chargement.");
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  // initial load
  useEffect(() => {
    loadAll(true);
  }, [loadAll]);

  // poll every 3s, but only when something is actually in flight
  useEffect(() => {
    const id = setInterval(() => {
      const d = dataRef.current;
      const live =
        d.tasks.some(isLiveTask) ||
        d.commands.some(isLiveCommand) ||
        d.approvals.some((a) => a.status === "pending");
      if (live) void loadAll(false);
    }, 3000);
    return () => clearInterval(id);
  }, [loadAll]);

  // poll OpenClaw connection status every 15s
  useEffect(() => {
    let cancelled = false;
    async function pollOc() {
      try {
        const status = await api.getOpenclawStatus();
        if (!cancelled) setOcStatus(status);
      } catch {
        // keep previous state on error
      }
    }
    void pollOc();
    const id = setInterval(() => void pollOc(), 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  /* ---------- derived ---------- */

  const projectById = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of data.projects) m.set(p.id, p);
    return m;
  }, [data.projects]);

  const taskCountByProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data.tasks) {
      if (!t.project_id) continue;
      m.set(t.project_id, (m.get(t.project_id) ?? 0) + 1);
    }
    return m;
  }, [data.tasks]);

  // agents working on a given project (via that project's tasks)
  const agentsByProject = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const t of data.tasks) {
      if (!t.project_id || !t.agent_id) continue;
      if (!m.has(t.project_id)) m.set(t.project_id, new Set());
      m.get(t.project_id)!.add(t.agent_id);
    }
    return m;
  }, [data.tasks]);

  const agentById = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of data.agents) m.set(a.id, a);
    return m;
  }, [data.agents]);

  const activeProjects = useMemo(
    () => data.projects.filter((p) => p.status === "active"),
    [data.projects],
  );

  const enabledAgents = useMemo(() => data.agents.filter((a) => a.enabled), [data.agents]);

  const activeTasks = useMemo(() => data.tasks.filter(isLiveTask), [data.tasks]);

  const pendingApprovals = useMemo(
    () => data.approvals.filter((a) => a.status === "pending"),
    [data.approvals],
  );

  const recentDocs = useMemo(
    () => data.documents.filter((d) => withinDays(d.created_at, 7)),
    [data.documents],
  );

  const recentCommands = useMemo(
    () =>
      [...data.commands]
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        .slice(0, 6),
    [data.commands],
  );

  const recentLogs = useMemo(
    () =>
      [...data.logs]
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        .slice(0, 8),
    [data.logs],
  );

  const sortedActiveTasks = useMemo(() => {
    const order: Record<string, number> = {
      running: 0,
      waiting_approval: 1,
      assigned: 2,
      pending: 3,
    };
    return [...activeTasks].sort((a, b) => {
      const oa = order[a.status] ?? 9;
      const ob = order[b.status] ?? 9;
      if (oa !== ob) return oa - ob;
      return +new Date(b.created_at) - +new Date(a.created_at);
    });
  }, [activeTasks]);

  /* ---------- actions ---------- */

  async function decide(id: string, accept: boolean) {
    setActing(id);
    try {
      if (accept) await api.acceptApproval(id);
      else await api.rejectApproval(id);
      await loadAll(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Décision impossible.");
    } finally {
      setActing(null);
    }
  }

  function goToCommand(intent?: string) {
    router.push(intent ? `/openclaw?intent=${encodeURIComponent(intent)}` : "/openclaw");
  }

  /* ---------- render ---------- */

  /* terminal-green token overrides — scoped to dashboard only */
  const terminalVars = {
    "--amber":     "#86E0A1",
    "--amber-2":   "#A8EBB8",
    "--amber-bg":  "rgba(134,224,161,.12)",
    "--amber-line":"rgba(134,224,161,.35)",
    "--amber-fg":  "#08140C",
    "--ok":        "#86E0A1",
    "--ok-bg":     "rgba(134,224,161,.14)",
    "--console-bg":"#0D0F13",
  } as React.CSSProperties;

  if (loading) {
    return (
      <div className="grid h-full place-items-center" style={terminalVars}>
        <div className="flex flex-col items-center gap-3">
          <Spinner size={26} />
          <span className="mono text-[10px] uppercase tracking-[0.2em] text-text3">
            Chargement du cockpit…
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="grid min-h-full grid-cols-1 xl:grid-cols-[minmax(0,1fr)_334px]"
      style={terminalVars}
    >
      {/* ===================== CENTER COLUMN ===================== */}
      <div className="flex min-w-0 flex-col gap-5 px-[22px] py-[18px]">
        {error && (
          <div className="flex items-center gap-2 rounded-[9px] border border-stop/40 bg-stop-bg px-3.5 py-2.5 text-[12.5px] text-stop">
            <X size={15} strokeWidth={2.2} aria-hidden />
            {error}
          </div>
        )}

        {/* ---- Command center ---- */}
        <Panel accent className="oc-fade pb-3.5">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="mono text-[13px] text-amber">&rsaquo;_</span>
            <span className="mono text-[10px] font-semibold uppercase tracking-[1.2px] text-text2">
              Centre de commande
            </span>
            <span
              className="mono ml-1 rounded-[5px] border px-2 py-[2px] text-[9px] font-medium uppercase tracking-[0.8px]"
              style={{
                color: "var(--amber)",
                borderColor: "var(--amber-line)",
                background: "var(--amber-bg)",
              }}
            >
              interne
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-text3">
              <Lock size={13} strokeWidth={2} aria-hidden />
              OpenClaw propose · le backend valide
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => goToCommand()}
              className="flex h-[46px] flex-1 items-center gap-2.5 rounded-[11px] border border-line bg-bg-2 px-3.5 text-left transition-colors hover:border-amber-line"
            >
              <Terminal size={16} strokeWidth={2} className="flex-none text-amber" aria-hidden />
              <span className="mono flex-1 truncate text-[12.5px] text-text3">
                Analyse les photos du chantier Villa Ducos…
              </span>
              <BlinkCursor />
            </button>
            <button
              type="button"
              onClick={() => goToCommand()}
              className="mono flex h-[46px] flex-none items-center gap-2 rounded-[11px] bg-amber px-4 text-[13px] font-semibold text-[var(--amber-fg)] transition-all hover:brightness-110"
            >
              <Send size={16} strokeWidth={2.2} aria-hidden />
              Exécuter
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {CHIPS.map((c) => {
              const Icon = c.icon;
              return (
                <button
                  key={c.intent}
                  type="button"
                  onClick={() => goToCommand(c.intent)}
                  className="group flex items-center gap-[7px] rounded-[9px] border border-line-soft bg-bg-2 px-[11px] py-[6px] text-[12px] text-text2 transition-colors hover:border-amber-line hover:text-text"
                >
                  <Icon
                    size={14}
                    strokeWidth={2}
                    className="text-amber transition-colors"
                    aria-hidden
                  />
                  {c.label}
                </button>
              );
            })}
          </div>
        </Panel>

        {/* ---- KPI cards ---- */}
        <section className="oc-fade grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="OpenClaw" live connected={ocStatus?.connected ?? false} />
          <KpiCard label="Projets actifs" value={activeProjects.length} />
          <KpiCard
            label="Sous-agents"
            value={enabledAgents.length}
            suffix={`/${data.agents.length}`}
            tone="ok"
          />
          <KpiCard label="Tâches en cours" value={activeTasks.length} />
          <KpiCard label="Validations" value={pendingApprovals.length} tone="amber" accent />
          <KpiCard label="Docs · 7 j" value={recentDocs.length} />
        </section>

        {/* ---- Recent OpenClaw commands ---- */}
        <section className="oc-fade">
          <SectionHeader
            title={`Commandes récentes · ${recentCommands.length}`}
            action={{ label: "Tout voir", href: "/openclaw" }}
          />
          {recentCommands.length === 0 ? (
            <EmptyState label="Aucune commande pour le moment." />
          ) : (
            <div className="flex flex-col overflow-hidden rounded-[11px] border border-line bg-panel">
              {recentCommands.map((c) => (
                <CommandRow
                  key={c.id}
                  command={c}
                  project={c.project_id ? projectById.get(c.project_id) : undefined}
                />
              ))}
            </div>
          )}
        </section>

        {/* ---- Active tasks ---- */}
        <section className="oc-fade">
          <SectionHeader
            title="Tâches actives"
            count={activeTasks.length}
            action={{ label: "File complète", href: "/tasks" }}
          />
          {sortedActiveTasks.length === 0 ? (
            <EmptyState label="Aucune tâche active." />
          ) : (
            <div className="overflow-hidden rounded-[11px] border border-line bg-panel">
              <div className="grid grid-cols-[1fr_150px_140px_auto] gap-3 bg-bg-2 px-3.5 py-2.5">
                <HeadCell>Tâche</HeadCell>
                <HeadCell>Agent</HeadCell>
                <HeadCell>Statut</HeadCell>
                <HeadCell>Prio.</HeadCell>
              </div>
              {sortedActiveTasks.map((t) => (
                <TaskRow key={t.id} task={t} agent={t.agent_id ? agentById.get(t.agent_id) : undefined} />
              ))}
            </div>
          )}
        </section>

        {/* ---- Projects ---- */}
        <section className="oc-fade">
          <SectionHeader
            title="Projets en cours"
            count={activeProjects.length}
            action={{ label: "Tous les projets", href: "/projects" }}
          />
          {activeProjects.length === 0 ? (
            <EmptyState label="Aucun projet actif." />
          ) : (
            <div className="flex flex-col gap-2.5">
              {activeProjects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  taskCount={taskCountByProject.get(p.id) ?? 0}
                  agentIds={[...(agentsByProject.get(p.id) ?? new Set<string>())]}
                  agentById={agentById}
                />
              ))}
            </div>
          )}
        </section>

        {/* ---- Status bar ---- */}
        <div className="mono flex items-center gap-2 px-[2px] pb-2 text-[10px] text-text3">
          <span
            className="h-[6px] w-[6px] flex-none rounded-full"
            style={{ background: "var(--amber)" }}
            aria-hidden
          />
          <span>
            backend · {ocStatus?.connected ? "connecté" : "local"}
            {"  ·  "}modèle anthropic
            {"  ·  "}⌘K commande
          </span>
        </div>
      </div>

      {/* ===================== RIGHT RAIL ===================== */}
      <aside className="flex flex-col gap-[18px] border-line bg-bg-1 px-3.5 py-3.5 xl:border-l">
        {/* sub-agents */}
        <div className="oc-fade overflow-hidden rounded-[10px] border border-line-soft bg-bg-2">
          <RailHeader
            icon={<Bot size={16} strokeWidth={2} className="text-text2" aria-hidden />}
            title="Sous-agents actifs"
            count={`${enabledAgents.length}/${data.agents.length}`}
            accentCount
          />
          {data.agents.length === 0 ? (
            <EmptyState label="Aucun sous-agent." bare />
          ) : (
            data.agents.map((a) => <AgentRow key={a.id} agent={a} />)
          )}
        </div>

        {/* approvals */}
        <div className="oc-fade overflow-hidden rounded-[10px] border border-line-soft bg-bg-2">
          <RailHeader
            icon={<ShieldCheck size={16} strokeWidth={2} className="text-amber" aria-hidden />}
            title="Validations urgentes"
            count={pendingApprovals.length}
            accentCount
          />
          {pendingApprovals.length === 0 ? (
            <EmptyState label="Aucune validation en attente." bare />
          ) : (
            pendingApprovals.map((a) => (
              <ApprovalRow
                key={a.id}
                approval={a}
                project={a.project_id ? projectById.get(a.project_id) : undefined}
                agent={resolveApprovalAgent(a, agentById)}
                busy={acting === a.id}
                onAccept={() => decide(a.id, true)}
                onReject={() => decide(a.id, false)}
              />
            ))
          )}
        </div>

        {/* logs */}
        <div className="oc-fade">
          <div className="mb-2.5 flex items-center gap-2.5">
            <span className="mono text-[9.5px] font-semibold uppercase tracking-[0.4px] text-text2">
              Logs récents
            </span>
            <span
              className="mono rounded-[4px] px-[6px] py-[1px] text-[9px] uppercase tracking-[0.4px]"
              style={{ color: "var(--amber)", background: "var(--amber-bg)" }}
            >
              live
            </span>
            <Link
              href="/logs"
              className="mono ml-auto flex items-center gap-1 text-[11px] text-text3 transition-colors hover:text-amber"
            >
              tout voir
              <ArrowRight size={13} strokeWidth={2.2} aria-hidden />
            </Link>
          </div>
          {recentLogs.length === 0 ? (
            <EmptyState label="Aucun log récent." />
          ) : (
            <div
              className="relative max-h-[260px] overflow-hidden rounded-[10px] border border-line-soft px-3 py-2.5"
              style={{ background: "var(--console-bg)" }}
            >
              {recentLogs.map((l) => (
                <LogLine key={l.id} log={l} />
              ))}
              <span
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[46px]"
                style={{
                  background:
                    "linear-gradient(to bottom, transparent, var(--console-bg))",
                }}
                aria-hidden
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function KpiCard({
  label,
  value,
  suffix,
  tone,
  live = false,
  connected = false,
  accent = false,
}: {
  label: string;
  value?: number;
  suffix?: string;
  tone?: "amber" | "ok";
  live?: boolean;
  connected?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-[5px] rounded-[13px] border px-3 py-[11px]",
        accent
          ? "border-amber-line bg-amber-bg"
          : "border-line bg-bg-1",
      )}
    >
      <span
        className={cn(
          "mono flex items-center gap-[5px] text-[9px] uppercase tracking-[0.4px]",
          accent ? "text-amber" : "text-text3",
        )}
      >
        {label}
      </span>
      {live ? (
        connected ? (
          <span className="mono flex items-center gap-[7px] text-[13px] font-medium uppercase tracking-[0.06em] text-amber">
            <Pulse />
            Connecté
          </span>
        ) : (
          <span className="mono flex items-center gap-[7px] text-[13px] font-medium uppercase tracking-[0.06em] text-text3">
            <span className="h-2 w-2 flex-none rounded-full bg-text3" aria-hidden />
            Hors ligne
          </span>
        )
      ) : (
        <span
          className={cn(
            "tnum flex items-baseline gap-1 text-[23px] font-semibold leading-none",
            tone === "amber" || accent ? "text-amber" : tone === "ok" ? "text-ok" : "text-text",
          )}
        >
          {value ?? 0}
          {suffix && (
            <small className="text-[13px] font-medium text-text3">{suffix}</small>
          )}
        </span>
      )}
    </div>
  );
}

function CommandRow({
  command,
  project,
}: {
  command: OpenClawCommand;
  project?: Project;
}) {
  const active = isLiveCommand(command);
  const intent = command.intent ?? undefined;
  const agentSlug = intent ? INTENT_TO_AGENT[intent] : undefined;
  const isValidation = command.status === "waiting_approval";
  return (
    <div
      className={cn(
        "relative flex items-center gap-[10px] border-b border-line-soft px-[14px] py-[9px] last:border-b-0 transition-colors hover:bg-bg-2",
        active && "bg-amber-bg",
      )}
    >
      {/* status dot */}
      <span
        className="h-[7px] w-[7px] flex-none rounded-full"
        style={{ background: active ? "var(--amber)" : "var(--text-3)" }}
        aria-hidden
      />
      <span className="mono flex-none text-[10.5px] text-text3">{timeHM(command.created_at)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-text">{command.instruction}</div>
        {(intent || project) && (
          <div className="mono mt-[2px] truncate text-[10px] text-text3">
            {intent && (
              <span>
                {intent}
                {agentSlug ? ` → ${agentSlug}` : ""}
              </span>
            )}
            {intent && project && " · "}
            {project && <span>{project.name}</span>}
          </div>
        )}
      </div>
      {isValidation ? (
        <span
          className="mono flex-none rounded-[6px] border px-2 py-[3px] text-[10px]"
          style={{
            color: "var(--amber)",
            background: "var(--amber-bg)",
            borderColor: "var(--amber-line)",
          }}
        >
          validation
        </span>
      ) : (
        <StatusChip status={command.status} />
      )}
    </div>
  );
}

function HeadCell({ children }: { children: React.ReactNode }) {
  return (
    <span className="disp text-[10px] font-semibold uppercase tracking-[0.1em] text-text3">
      {children}
    </span>
  );
}

function TaskRow({ task, agent }: { task: Task; agent?: Agent }) {
  const slug = agent?.slug ?? "";
  const Icon = AGENT_ICON[slug] ?? Ruler;
  const running = task.status === "running" || task.status === "assigned";
  const prio = PRIORITY_LABEL[task.priority] ?? PRIORITY_LABEL.normal;
  const iconColor =
    task.status === "running"
      ? "text-amber"
      : task.status === "waiting_approval"
        ? "text-hot"
        : task.status === "completed"
          ? "text-ok"
          : "text-text2";
  return (
    <div className="grid grid-cols-[1fr_150px_140px_auto] items-center gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-b-0 transition-colors hover:bg-bg-2">
      <div className="flex min-w-0 items-center gap-2.5 text-[12.5px] font-medium text-text">
        <Icon size={16} strokeWidth={2} className={cn("flex-none", iconColor)} aria-hidden />
        <span className="truncate">{task.title}</span>
        {running && <IndeterminateBar />}
      </div>
      <span className="mono truncate text-[11px] text-text2">{slug || "—"}</span>
      <span>
        <StatusChip status={task.status} />
      </span>
      <span className={cn("disp text-[10px] font-semibold uppercase tracking-[0.06em]", prio.cls)}>
        {prio.label}
      </span>
    </div>
  );
}

function ProjectCard({
  project,
  taskCount,
  agentIds,
  agentById,
}: {
  project: Project;
  taskCount: number;
  agentIds: string[];
  agentById: Map<string, Agent>;
}) {
  const Icon = projectIcon(project);
  const monos = agentIds
    .map((id) => agentById.get(id))
    .filter((a): a is Agent => Boolean(a))
    .map((a) => AGENT_MONO[a.slug] ?? a.slug.slice(0, 2).toUpperCase());
  return (
    <Link
      href="/projects"
      className="grid grid-cols-[auto_1fr_auto] items-center gap-3.5 rounded-[10px] border border-line bg-panel px-3.5 py-3 transition-colors hover:border-amber-line"
    >
      <div className="grid h-9 w-9 flex-none place-items-center rounded-[8px] bg-bg-3 text-text2">
        <Icon size={18} strokeWidth={2} aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="mb-[3px] truncate text-[13px] font-medium text-text">{project.name}</div>
        <div className="flex items-center gap-2 text-[11px] text-text3">
          <span className="truncate">{project.client_name}</span>
          {project.project_type && (
            <>
              <Dot />
              <span className="truncate">{project.project_type}</span>
            </>
          )}
          <Dot />
          <span className="flex-none">
            {taskCount} tâche{taskCount > 1 ? "s" : ""}
          </span>
        </div>
      </div>
      <div className="flex flex-none items-center">
        {monos.length > 0 ? (
          monos.map((m, i) => (
            <span
              key={i}
              className="disp -ml-[6px] grid h-[22px] w-[22px] place-items-center rounded-full border-[1.5px] border-panel bg-bg-3 text-[9px] font-semibold text-amber-2 first:ml-0"
            >
              {m}
            </span>
          ))
        ) : (
          <span className="mono text-[10.5px] text-text3">—</span>
        )}
      </div>
    </Link>
  );
}

function RailHeader({
  icon,
  title,
  count,
  accentCount = false,
}: {
  icon: React.ReactNode;
  title: string;
  count: string | number;
  accentCount?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line-soft px-3 py-[11px]">
      {icon}
      <span className="mono text-[9.5px] font-semibold uppercase tracking-[0.4px] text-text2">
        {title}
      </span>
      <span
        className="mono ml-auto rounded-[5px] border px-[7px] py-[2px] text-[10px]"
        style={
          accentCount
            ? { color: "var(--amber)", background: "var(--amber-bg)", borderColor: "var(--amber-line)" }
            : { color: "var(--text-2)", background: "transparent", borderColor: "transparent" }
        }
      >
        {count}
      </span>
    </div>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const Icon = AGENT_ICON[agent.slug] ?? Bot;
  const online = agent.enabled;
  return (
    <div className="flex items-center gap-[9px] border-b border-line-soft px-3 py-[7px] last:border-b-0 transition-colors hover:bg-bg-3">
      <div className="relative flex-none">
        <div className="grid h-[27px] w-[27px] place-items-center rounded-[7px] bg-bg-3 text-text2">
          <Icon size={15} strokeWidth={2} aria-hidden />
        </div>
        {online && (
          <span
            className="absolute -bottom-[2px] -right-[2px] h-[8px] w-[8px] rounded-full border-2"
            style={{
              background: "var(--amber)",
              borderColor: "var(--bg-2)",
            }}
            aria-hidden
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] font-medium text-text">{agent.name}</div>
        <div className="mono truncate text-[9.5px] text-text3">{agent.slug}</div>
      </div>
      <span
        className="mono flex-none rounded-[5px] border px-[6px] py-[2px] text-[8.5px] uppercase tracking-[0.4px]"
        style={
          agent.risk_level === "medium" || agent.risk_level === "high"
            ? { color: "var(--amber)", background: "var(--amber-bg)", borderColor: "var(--amber-line)" }
            : { color: "var(--text-2)", background: "var(--bg-2)", borderColor: "var(--line)" }
        }
      >
        {agent.risk_level === "high"
          ? "élevé"
          : agent.risk_level === "medium"
          ? "moyen"
          : "faible"}
      </span>
    </div>
  );
}

function ApprovalRow({
  approval,
  project,
  agent,
  busy,
  onAccept,
  onReject,
}: {
  approval: Approval;
  project?: Project;
  agent?: Agent;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="border-b border-line-soft p-3 last:border-b-0">
      <div
        className="rounded-[10px] border p-[10px] pb-[11px]"
        style={{ background: "var(--bg-2)", borderColor: "var(--line)" }}
      >
        <div className="mb-[6px] flex items-center justify-between gap-2">
          <span className="text-[11.5px] font-semibold text-text">{approval.title}</span>
          <span className="mono flex-none text-[10px] text-text3">{relTime(approval.created_at)}</span>
        </div>
        {(project || agent) && (
          <div className="mb-[11px] flex items-center gap-[5px]">
            <span
              className="h-[6px] w-[6px] flex-none rounded-full"
              style={{ background: "var(--amber)" }}
              aria-hidden
            />
            <span className="truncate text-[10.5px] text-text2">
              {project?.name ?? ""}
              {agent && project ? ` – ${agent.slug}` : agent?.slug ?? ""}
            </span>
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            className="mono flex flex-1 items-center justify-center gap-[5px] rounded-[8px] border py-[7px] text-[11.5px] font-semibold transition-all disabled:opacity-50 hover:brightness-110"
            style={{
              background: "var(--amber)",
              borderColor: "var(--amber)",
              color: "var(--amber-fg)",
            }}
          >
            {busy ? <Spinner size={14} /> : <Check size={14} strokeWidth={2.2} aria-hidden />}
            Accepter
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="mono flex flex-1 items-center justify-center gap-[5px] rounded-[8px] border border-line py-[7px] text-[11.5px] font-medium text-text2 transition-colors hover:border-stop hover:text-stop disabled:opacity-50"
          >
            <X size={14} strokeWidth={2.2} aria-hidden />
            Refuser
          </button>
        </div>
      </div>
    </div>
  );
}

function LogLine({ log }: { log: LogEntry }) {
  const level = String(log.level);
  const dot = LOG_DOT[level] ?? "bg-steel";
  const evCls = level === "error" ? "text-stop" : level === "warn" ? "text-amber-2" : "text-text2";
  return (
    <div className="mono flex items-baseline gap-2.5 whitespace-nowrap text-[11px] leading-[1.75]">
      <span className="flex-none text-text3">{timeHMS(log.created_at)}</span>
      <span className={cn("h-1.5 w-1.5 flex-none self-center rounded-full", dot)} aria-hidden />
      <span className={cn("flex-none", evCls)}>{log.event_type}</span>
      <span className="overflow-hidden text-ellipsis text-text3">{log.message}</span>
    </div>
  );
}

function EmptyState({ label, bare = false }: { label: string; bare?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center text-[12px] text-text3",
        bare
          ? "px-3 py-6"
          : "rounded-[11px] border border-dashed border-line-soft bg-panel px-4 py-8",
      )}
    >
      {label}
    </div>
  );
}

function Dot() {
  return <span className="h-[3px] w-[3px] flex-none rounded-full bg-text3" aria-hidden />;
}

function IndeterminateBar() {
  return (
    <span className="relative h-[2px] w-[46px] flex-none overflow-hidden rounded-[2px] bg-bg-3">
      <span
        className="absolute h-full w-[45%] rounded-[2px] bg-amber"
        style={{ animation: "oc-slide 1.6s ease-in-out infinite" }}
        aria-hidden
      />
    </span>
  );
}

function Pulse() {
  return (
    <span className="relative h-2 w-2 flex-none rounded-full bg-ok">
      <span
        className="absolute -inset-1 rounded-full border-[1.5px] border-ok opacity-60"
        style={{ animation: "oc-ring 2.4s ease-out infinite" }}
        aria-hidden
      />
    </span>
  );
}

function BlinkCursor() {
  return (
    <span
      className="inline-block h-[15px] w-[7px] flex-none rounded-[1px] bg-amber"
      style={{ animation: "oc-blink 1.1s steps(1) infinite" }}
      aria-hidden
    />
  );
}

/* ============================================================
   Helpers needing maps
   ============================================================ */

// An approval may carry its originating agent in payload; otherwise infer
// from the linked task's agent. Returns undefined if unknown.
function resolveApprovalAgent(a: Approval, agentById: Map<string, Agent>): Agent | undefined {
  const payload = a.payload as { agent_slug?: unknown } | null | undefined;
  if (payload && typeof payload.agent_slug === "string") {
    for (const agent of agentById.values()) {
      if (agent.slug === payload.agent_slug) return agent;
    }
  }
  return undefined;
}
