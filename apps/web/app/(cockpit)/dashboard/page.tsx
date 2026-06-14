"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { RiskBadge } from "@/components/ui/RiskBadge";
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

const RISK_DOT: Record<RiskLevel, string> = {
  low: "var(--ok)",
  medium: "var(--amber)",
  high: "var(--hot)",
  blocked: "var(--stop)",
};

const PRIORITY_LABEL: Record<string, { label: string; cls: string }> = {
  high: { label: "Haute", cls: "text-hot" },
  normal: { label: "Normale", cls: "text-text3" },
  low: { label: "Basse", cls: "text-text3 opacity-70" },
};

const LOG_DOT: Record<string, string> = {
  info: "bg-steel",
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

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size={26} />
          <span className="disp text-[11px] uppercase tracking-[0.13em] text-text3">
            Chargement du cockpit…
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-full grid-cols-1 xl:grid-cols-[minmax(0,1fr)_334px]">
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
            <Terminal size={17} strokeWidth={2} className="text-amber" aria-hidden />
            <span className="disp text-[11.5px] font-semibold uppercase tracking-[0.13em] text-amber-2">
              Centre de commande · OpenClaw
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-text3">
              <Lock size={13} strokeWidth={2} aria-hidden />
              OpenClaw propose · le backend valide
            </span>
          </div>
          <div className="flex items-end gap-2.5">
            <button
              type="button"
              onClick={() => goToCommand()}
              className="min-h-[54px] flex-1 rounded-[9px] border border-line bg-bg-2 px-3.5 py-3 text-left text-[13.5px] leading-[1.55] text-text3 transition-colors hover:border-amber-line"
            >
              Ex : Analyse les photos du chantier Villa Ducos et prépare un devis
              placo-peinture…
            </button>
            <button
              type="button"
              onClick={() => goToCommand()}
              className="disp flex h-[54px] flex-none items-center gap-2 rounded-[9px] bg-amber px-5 text-[13px] font-semibold tracking-[0.04em] text-[var(--amber-fg)] transition-colors hover:bg-amber-2"
            >
              <Send size={18} strokeWidth={2.2} aria-hidden />
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
                  className="group flex items-center gap-[7px] rounded-[20px] border border-line-soft bg-bg-2 px-[11px] py-1.5 text-[12px] text-text2 transition-colors hover:border-amber-line hover:text-text"
                >
                  <Icon
                    size={15}
                    strokeWidth={2}
                    className="text-text3 transition-colors group-hover:text-amber"
                    aria-hidden
                  />
                  {c.label}
                </button>
              );
            })}
          </div>
        </Panel>

        {/* ---- Instrument strip (KPIs) ---- */}
        <section className="oc-fade flex items-stretch overflow-hidden rounded-[11px] border border-line bg-panel">
          <StripCell label="OpenClaw" live />
          <StripCell label="Projets actifs" value={activeProjects.length} />
          <StripCell
            label="Sous-agents"
            value={enabledAgents.length}
            suffix={`/${data.agents.length} actifs`}
            tone="ok"
          />
          <StripCell label="Tâches en cours" value={activeTasks.length} />
          <StripCell label="Validations urgentes" value={pendingApprovals.length} tone="amber" />
          <StripCell label="Documents · 7 j" value={recentDocs.length} last />
        </section>

        {/* ---- Recent OpenClaw commands ---- */}
        <section className="oc-fade">
          <SectionHeader
            title="Commandes OpenClaw récentes"
            count={`· ${recentCommands.length}`}
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
      </div>

      {/* ===================== RIGHT RAIL ===================== */}
      <aside className="flex flex-col gap-[18px] border-line bg-bg-1 px-3.5 py-3.5 xl:border-l">
        {/* sub-agents */}
        <div className="oc-fade overflow-hidden rounded-[10px] border border-line-soft bg-bg-2">
          <RailHeader
            icon={<Bot size={16} strokeWidth={2} className="text-text2" aria-hidden />}
            title="Sous-agents actifs"
            count={`${enabledAgents.length}/${data.agents.length}`}
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
            icon={<ShieldCheck size={16} strokeWidth={2} className="text-hot" aria-hidden />}
            title="Validations urgentes"
            count={pendingApprovals.length}
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
            <span className="disp text-[11px] font-semibold uppercase tracking-[0.1em] text-text2">
              Logs récents
            </span>
            <span className="mono text-[11px] text-text3">live</span>
            <Link
              href="/logs"
              className="ml-auto flex items-center gap-1 text-[11.5px] text-text3 transition-colors hover:text-amber-2"
            >
              Console
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

function StripCell({
  label,
  value,
  suffix,
  tone,
  live = false,
  last = false,
}: {
  label: string;
  value?: number;
  suffix?: string;
  tone?: "amber" | "ok";
  live?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-[7px] px-4 py-[13px]",
        !last && "border-r border-line-soft",
      )}
    >
      <span className="disp text-[10px] font-semibold uppercase tracking-[0.12em] text-text3">
        {label}
      </span>
      {live ? (
        <span className="disp flex items-center gap-[7px] text-[14px] font-semibold uppercase tracking-[0.06em] text-ok">
          <Pulse />
          Opér.
        </span>
      ) : (
        <span
          className={cn(
            "disp tnum flex items-baseline gap-1.5 text-[26px] font-semibold leading-none",
            tone === "amber" && "text-amber-2",
            tone === "ok" && "text-ok",
          )}
        >
          {value ?? 0}
          {suffix && <small className="text-[12px] font-medium text-text3">{suffix}</small>}
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
  return (
    <div
      className={cn(
        "relative grid grid-cols-[52px_1fr_auto] items-center gap-3.5 border-b border-line-soft px-3.5 py-2.5 last:border-b-0 transition-colors hover:bg-bg-2",
        active && "bg-[oklch(0.805_0.155_72/.05)]",
      )}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[2px] bg-amber" aria-hidden />}
      <span className="mono text-[11px] text-text3">{timeHM(command.created_at)}</span>
      <div className="min-w-0">
        <div className="mb-1 truncate text-[13px] text-text">{command.instruction}</div>
        <div className="flex flex-wrap items-center gap-2">
          {project && (
            <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-bg-3 px-2 py-0.5 text-[10.5px] text-text2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: RISK_DOT[command.risk_level] ?? "var(--text-3)" }}
                aria-hidden
              />
              {project.name}
            </span>
          )}
          {intent && (
            <span className="mono inline-flex items-center gap-1.5 text-[10.5px] text-text3">
              {intent}
              <ArrowRightToLine size={12} strokeWidth={2} aria-hidden />
              {agentSlug ? <b className="font-medium text-amber-2">{agentSlug}</b> : null}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2.5 justify-self-end">
        <RiskBadge level={command.risk_level} />
        <StatusChip status={command.status} />
      </div>
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
}: {
  icon: React.ReactNode;
  title: string;
  count: string | number;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2.5">
      {icon}
      <span className="disp text-[11px] font-semibold uppercase tracking-[0.11em] text-text2">
        {title}
      </span>
      <span className="mono ml-auto text-[10.5px] text-text3">{count}</span>
    </div>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const Icon = AGENT_ICON[agent.slug] ?? Bot;
  const running = agent.status === "running";
  return (
    <div className="flex items-center gap-2.5 border-b border-line-soft px-3 py-2.5 last:border-b-0 transition-colors hover:bg-bg-3">
      <div
        className={cn(
          "relative grid h-[30px] w-[30px] flex-none place-items-center rounded-[7px]",
          running ? "bg-amber-bg text-amber" : "bg-bg-3 text-text2",
        )}
      >
        <Icon size={16} strokeWidth={2} aria-hidden />
        {running && (
          <span className="absolute -bottom-0.5 -right-0.5 h-[9px] w-[9px] rounded-full border-2 border-bg-2 bg-amber" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-text">{agent.name}</div>
        <div className="truncate text-[10.5px] text-text3">{agent.role}</div>
      </div>
      <div className="flex flex-none flex-col items-end gap-1.5">
        <RiskBadge level={agent.risk_level} />
        <span className="mono text-[10px] text-text3">v{agent.version}</span>
      </div>
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
  const med = approval.risk_level === "medium";
  return (
    <div
      className="relative border-b border-line-soft border-l-[3px] p-3 last:border-b-0"
      style={{ borderLeftColor: med ? "var(--amber)" : "var(--hot)" }}
    >
      <div className="mb-[7px] text-[12.5px] font-medium leading-[1.4] text-text">
        {approval.title}
      </div>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <RiskBadge level={approval.risk_level} />
        {project && (
          <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-bg-3 px-2 py-0.5 text-[10.5px] text-text2">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: RISK_DOT[approval.risk_level] ?? "var(--text-3)" }}
              aria-hidden
            />
            {project.name}
          </span>
        )}
        <span className="mono text-[10.5px] text-text3">
          {agent ? `${agent.slug} · ` : ""}
          {relTime(approval.created_at)}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={busy}
          className="disp flex flex-1 items-center justify-center gap-1.5 rounded-[7px] border border-[oklch(0.77_0.14_152/.3)] bg-ok-bg py-[7px] text-[11.5px] font-semibold tracking-[0.04em] text-ok transition-colors hover:bg-[oklch(0.77_0.14_152/.22)] disabled:opacity-50"
        >
          {busy ? <Spinner size={14} /> : <Check size={15} strokeWidth={2.2} aria-hidden />}
          Accepter
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="disp flex flex-1 items-center justify-center gap-1.5 rounded-[7px] border border-line py-[7px] text-[11.5px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:border-[oklch(0.635_0.20_28/.3)] hover:bg-stop-bg hover:text-stop disabled:opacity-50"
        >
          <X size={15} strokeWidth={2.2} aria-hidden />
          Refuser
        </button>
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
