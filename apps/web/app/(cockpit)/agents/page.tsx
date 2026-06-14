"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Bot,
  Camera,
  ChevronRight,
  ClipboardList,
  FileSearch,
  Inbox,
  Receipt,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Agent, Task } from "@/lib/types";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";

const POLL_MS = 3000;

/* Map an agent slug to the maquette's pictogram (right-rail "Sous-agents"). */
const AGENT_ICONS: Record<string, LucideIcon> = {
  photo_analysis_agent: Camera,
  quote_agent: Receipt,
  site_report_agent: ClipboardList,
  tender_agent: FileSearch,
};

function iconFor(slug: string): LucideIcon {
  return AGENT_ICONS[slug] ?? Bot;
}

/* Count active (non-finished) tasks per agent for the dense list pill. */
function taskCountsByAgent(tasks: readonly Task[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    if (!task.agent_id) continue;
    counts[task.agent_id] = (counts[task.agent_id] ?? 0) + 1;
  }
  return counts;
}

interface ViewState {
  agents: Agent[];
  taskCounts: Record<string, number>;
}

export default function AgentsPage() {
  const [state, setState] = useState<ViewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Slug-level guard so a toggle in flight can't be double-fired or polled over.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    // Tasks are best-effort: agents must still render if /tasks fails.
    const [agents, tasks] = await Promise.all([
      api.listAgents(),
      api.listTasks().catch((): Task[] => []),
    ]);
    return { agents, taskCounts: taskCountsByAgent(tasks) };
  }, []);

  // Initial load.
  useEffect(() => {
    let active = true;
    load()
      .then((next) => {
        if (active) {
          setState(next);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Chargement impossible.");
        }
      });
    return () => {
      active = false;
    };
  }, [load]);

  // Poll while at least one agent is running. Skip refresh during a toggle so we
  // don't clobber the optimistic state with a stale snapshot.
  const hasRunning = state?.agents.some((a) => a.status === "running") ?? false;
  useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => {
      if (pendingRef.current) return;
      load()
        .then((next) => {
          if (!pendingRef.current) {
            setState(next);
            setError(null);
          }
        })
        .catch(() => {
          /* keep the last good snapshot on transient poll failures */
        });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [hasRunning, load]);

  async function toggle(agent: Agent) {
    if (pendingRef.current) return;
    pendingRef.current = agent.id;
    setPendingId(agent.id);
    const next = !agent.enabled;
    // Optimistic flip.
    setState((prev) =>
      prev
        ? {
            ...prev,
            agents: prev.agents.map((a) =>
              a.id === agent.id ? { ...a, enabled: next } : a,
            ),
          }
        : prev,
    );
    try {
      const updated = next
        ? await api.enableAgent(agent.id)
        : await api.disableAgent(agent.id);
      setState((prev) =>
        prev
          ? {
              ...prev,
              agents: prev.agents.map((a) =>
                a.id === agent.id ? updated : a,
              ),
            }
          : prev,
      );
    } catch (err: unknown) {
      // Roll back on failure.
      setState((prev) =>
        prev
          ? {
              ...prev,
              agents: prev.agents.map((a) =>
                a.id === agent.id ? { ...a, enabled: agent.enabled } : a,
              ),
            }
          : prev,
      );
      setError(err instanceof Error ? err.message : "Action impossible.");
    } finally {
      pendingRef.current = null;
      setPendingId(null);
    }
  }

  async function retry() {
    setError(null);
    setState(null);
    try {
      setState(await load());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }

  return (
    <div className="flex flex-col gap-5 p-[18px_22px]">
      <header className="oc-fade">
        <h1 className="disp text-[19px] font-semibold tracking-[0.01em]">
          Sous-agents
        </h1>
        <p className="mt-1 text-[12.5px] text-text3">
          Agents métier pilotés par OpenClaw · activez ou suspendez chaque agent
          de la flotte.
        </p>
      </header>

      {state && <FleetStrip agents={state.agents} />}

      <section className="oc-fade" style={{ animationDelay: "0.06s" }}>
        <SectionHeader
          title="Flotte d'agents"
          count={state ? state.agents.length : undefined}
          icon={
            <Bot
              size={16}
              strokeWidth={2}
              className="text-text2"
              aria-hidden
            />
          }
        />

        {error && !state ? (
          <ErrorState message={error} onRetry={retry} />
        ) : !state ? (
          <LoadingState />
        ) : state.agents.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {error && <InlineError message={error} />}
            <Panel bare>
              {state.agents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  taskCount={state.taskCounts[agent.id] ?? 0}
                  busy={pendingId === agent.id}
                  onToggle={() => toggle(agent)}
                />
              ))}
            </Panel>
          </>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fleet summary strip — parity with the dashboard instrument strip.    */
/* ------------------------------------------------------------------ */

function FleetStrip({ agents }: { agents: readonly Agent[] }) {
  const total = agents.length;
  const enabled = agents.filter((a) => a.enabled).length;
  const running = agents.filter((a) => a.status === "running").length;

  return (
    <section
      className="oc-fade flex items-stretch overflow-hidden rounded-[11px] border border-line bg-panel"
      style={{ animationDelay: "0.03s" }}
    >
      <StripCell label="Agents" value={total} />
      <StripCell label="Actifs" value={`${enabled}/${total}`} tone="ok" />
      <StripCell
        label="En exécution"
        value={running}
        tone={running > 0 ? "amber" : undefined}
      />
    </section>
  );
}

function StripCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "amber" | "ok";
}) {
  return (
    <div className="flex flex-1 flex-col gap-[7px] border-r border-line-soft px-4 py-[13px] last:border-r-0">
      <span className="disp text-[10px] font-semibold uppercase tracking-[0.12em] text-text3">
        {label}
      </span>
      <span
        className={cn(
          "disp tnum text-[26px] font-semibold leading-none tracking-[0.01em]",
          tone === "amber" && "text-amber-2",
          tone === "ok" && "text-ok",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agent row — dense list item ported from the maquette `.agent-row`.   */
/* ------------------------------------------------------------------ */

function AgentRow({
  agent,
  taskCount,
  busy,
  onToggle,
}: {
  agent: Agent;
  taskCount: number;
  busy: boolean;
  onToggle: () => void;
}) {
  const Icon = iconFor(agent.slug);
  const running = agent.status === "running";

  return (
    <div className="flex items-center gap-3 border-b border-line-soft px-3.5 py-3 transition-colors last:border-b-0 hover:bg-bg-2">
      {/* pictogram tile */}
      <div
        className={cn(
          "relative grid h-[34px] w-[34px] flex-none place-items-center rounded-[8px]",
          running ? "bg-amber-bg text-amber" : "bg-bg-3 text-text2",
        )}
      >
        <Icon size={17} strokeWidth={2} aria-hidden />
        {running && (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-[9px] w-[9px] rounded-full bg-amber"
            style={{ animation: "oc-blink 1.3s ease-in-out infinite" }}
            aria-hidden
          />
        )}
      </div>

      {/* name + role */}
      <Link
        href={`/agents/${agent.id}`}
        className="group min-w-0 flex-1"
        aria-label={`Ouvrir l'agent ${agent.name}`}
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-text transition-colors group-hover:text-amber-2">
            {agent.name}
          </span>
          <span className="mono flex-none text-[10px] text-text3">
            {agent.slug}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-text3">
          {agent.role}
        </div>
      </Link>

      {/* version */}
      <span
        className="mono hidden flex-none text-[10.5px] text-text3 sm:inline"
        title="Version"
      >
        v{agent.version}
      </span>

      {/* task count */}
      <span
        className="mono flex-none rounded-[10px] bg-bg-3 px-[7px] py-px text-[11px] text-text3 tnum"
        title="Tâches rattachées"
      >
        {taskCount} tâ.
      </span>

      {/* risk */}
      <RiskBadge level={agent.risk_level} className="flex-none" />

      {/* enable / disable toggle */}
      <Toggle on={agent.enabled} busy={busy} onClick={onToggle} label={agent.name} />

      {/* detail affordance */}
      <Link
        href={`/agents/${agent.id}`}
        className="grid h-7 w-7 flex-none place-items-center rounded-[6px] text-text3 transition-colors hover:bg-bg-3 hover:text-text"
        aria-label={`Détails de l'agent ${agent.name}`}
      >
        <ChevronRight size={16} strokeWidth={2.2} aria-hidden />
      </Link>
    </div>
  );
}

function Toggle({
  on,
  busy,
  onClick,
  label,
}: {
  on: boolean;
  busy: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${on ? "Désactiver" : "Activer"} l'agent ${label}`}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "relative h-[17px] w-[30px] flex-none rounded-[10px] transition-colors disabled:opacity-60",
        on ? "bg-ok" : "bg-bg-3",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] h-[13px] w-[13px] rounded-full bg-[var(--bg)] transition-[left]",
          on ? "left-[15px]" : "left-[2px]",
        )}
        aria-hidden
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Loading / empty / error states.                                      */
/* ------------------------------------------------------------------ */

function LoadingState() {
  return (
    <Panel className="grid place-items-center py-14">
      <div className="flex flex-col items-center gap-3 text-text3">
        <Spinner size={24} />
        <span className="disp text-[11px] font-semibold uppercase tracking-[0.1em]">
          Chargement de la flotte…
        </span>
      </div>
    </Panel>
  );
}

function EmptyState() {
  return (
    <Panel className="grid place-items-center py-14 text-center">
      <div className="flex max-w-[320px] flex-col items-center gap-2 text-text3">
        <Inbox size={26} strokeWidth={1.8} aria-hidden />
        <span className="text-[13px] font-medium text-text2">
          Aucun sous-agent enregistré
        </span>
        <span className="text-[12px]">
          Les agents sont créés au démarrage du backend. Vérifiez que le seed a
          bien été exécuté.
        </span>
      </div>
    </Panel>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Panel className="grid place-items-center py-14 text-center">
      <div className="flex max-w-[360px] flex-col items-center gap-3">
        <Activity size={26} strokeWidth={1.8} className="text-stop" aria-hidden />
        <span className="text-[13px] font-medium text-text2">
          Impossible de charger les agents
        </span>
        <span className="text-[12px] text-text3">{message}</span>
        <button
          type="button"
          onClick={onRetry}
          className="disp mt-1 flex items-center gap-2 rounded-[8px] border border-line bg-bg-2 px-3.5 py-2 text-[12px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:border-amber-line hover:text-text"
        >
          <RefreshCw size={14} strokeWidth={2.2} aria-hidden />
          Réessayer
        </button>
      </div>
    </Panel>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="mb-2.5 flex items-start gap-2 rounded-[8px] border border-stop-bg bg-stop-bg px-3 py-2.5 text-[12px] text-stop">
      <AlertTriangle
        size={14}
        strokeWidth={2.2}
        className="mt-px flex-none"
        aria-hidden
      />
      <span>{message}</span>
    </div>
  );
}
