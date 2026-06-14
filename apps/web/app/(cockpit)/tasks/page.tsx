"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Receipt,
  ClipboardList,
  FileSearch,
  Ruler,
  ListChecks,
  X,
  type LucideIcon,
} from "lucide-react";
import { StatusChip } from "@/components/ui/StatusChip";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import type { Agent, Project, Task, TaskStatus } from "@/lib/types";

const AGENT_ICON: Record<string, LucideIcon> = {
  photo_analysis_agent: Camera,
  quote_agent: Receipt,
  site_report_agent: ClipboardList,
  tender_agent: FileSearch,
};

const PRIORITY: Record<string, { label: string; cls: string }> = {
  high: { label: "Haute", cls: "text-hot" },
  normal: { label: "Normale", cls: "text-text3" },
  low: { label: "Basse", cls: "text-text3 opacity-70" },
};

type Filter = "all" | TaskStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "running", label: "En cours" },
  { value: "waiting_approval", label: "Validation" },
  { value: "pending", label: "En attente" },
  { value: "completed", label: "Terminées" },
  { value: "failed", label: "Échouées" },
  { value: "cancelled", label: "Annulées" },
];

const LIVE = new Set<TaskStatus>(["pending", "assigned", "running", "waiting_approval"]);

function timeHM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(d);
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;

  const load = useCallback(async (initial: boolean) => {
    try {
      const [t, a, p] = await Promise.all([
        api.listTasks(),
        api.listAgents(),
        api.listProjects(),
      ]);
      setTasks(t);
      setAgents(a);
      setProjects(p);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement.");
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      if (tasksRef.current.some((t) => LIVE.has(t.status))) void load(false);
    }, 3000);
    return () => clearInterval(id);
  }, [load]);

  const agentById = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  const projectById = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tasks.length };
    for (const t of tasks) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [tasks]);

  const visible = useMemo(() => {
    const list = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);
    const order: Record<string, number> = { running: 0, waiting_approval: 1, assigned: 2, pending: 3 };
    return [...list].sort((a, b) => {
      const oa = order[a.status] ?? 9;
      const ob = order[b.status] ?? 9;
      if (oa !== ob) return oa - ob;
      return +new Date(b.created_at) - +new Date(a.created_at);
    });
  }, [tasks, filter]);

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size={26} />
          <span className="disp text-[11px] uppercase tracking-[0.13em] text-text3">
            Chargement des tâches…
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5 px-[22px] py-[18px]">
      <div className="flex items-center gap-2.5">
        <ListChecks size={18} strokeWidth={2} className="text-amber" aria-hidden />
        <h1 className="disp text-[15px] font-semibold tracking-[0.02em]">Tâches</h1>
        <span className="mono text-[12px] text-text3">{tasks.length}</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-[9px] border border-stop/40 bg-stop-bg px-3.5 py-2.5 text-[12.5px] text-stop">
          <X size={15} strokeWidth={2.2} aria-hidden />
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = counts[f.value] ?? 0;
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition-colors",
                active
                  ? "border-amber-line bg-amber-bg text-amber-2"
                  : "border-line-soft bg-bg-2 text-text2 hover:border-amber-line hover:text-text",
              )}
            >
              {f.label}
              <span className="mono text-[10.5px] opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="flex items-center justify-center rounded-[11px] border border-dashed border-line-soft bg-panel px-4 py-10 text-[12px] text-text3">
          Aucune tâche {filter === "all" ? "" : "dans cet état"}.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[11px] border border-line bg-panel">
          <div className="grid grid-cols-[1fr_170px_180px_150px_90px] gap-3 border-b border-line-soft bg-bg-2 px-3.5 py-2.5">
            <HeadCell>Tâche</HeadCell>
            <HeadCell>Agent</HeadCell>
            <HeadCell>Projet</HeadCell>
            <HeadCell>Statut</HeadCell>
            <HeadCell>Prio.</HeadCell>
          </div>
          {visible.map((t) => {
            const agent = t.agent_id ? agentById.get(t.agent_id) : undefined;
            const project = t.project_id ? projectById.get(t.project_id) : undefined;
            const Icon = AGENT_ICON[agent?.slug ?? ""] ?? Ruler;
            const prio = PRIORITY[t.priority] ?? PRIORITY.normal;
            const iconColor =
              t.status === "running"
                ? "text-amber"
                : t.status === "waiting_approval"
                  ? "text-hot"
                  : t.status === "completed"
                    ? "text-ok"
                    : t.status === "failed" || t.status === "cancelled"
                      ? "text-stop"
                      : "text-text2";
            return (
              <div
                key={t.id}
                className="grid grid-cols-[1fr_170px_180px_150px_90px] items-center gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-b-0 transition-colors hover:bg-bg-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Icon size={16} strokeWidth={2} className={cn("flex-none", iconColor)} aria-hidden />
                  <span className="truncate text-[12.5px] font-medium text-text">{t.title}</span>
                  <span className="mono flex-none text-[10.5px] text-text3">{timeHM(t.created_at)}</span>
                </div>
                <span className="mono truncate text-[11px] text-text2">{agent?.slug ?? "—"}</span>
                <span className="truncate text-[12px] text-text2">{project?.name ?? "—"}</span>
                <span>
                  <StatusChip status={t.status} />
                </span>
                <span className={cn("disp text-[10px] font-semibold uppercase tracking-[0.06em]", prio.cls)}>
                  {prio.label}
                </span>
              </div>
            );
          })}
        </div>
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
