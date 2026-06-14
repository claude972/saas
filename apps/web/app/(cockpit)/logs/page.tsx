"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Inbox,
  ListFilter,
  Play,
  RefreshCw,
  ScrollText,
  Search,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { LogEntry } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";

const POLL_MS = 5000;

/* ------------------------------------------------------------------ */
/* Severity model. Backend `level` is a free string; we normalise the   */
/* expected values (info / warn / error) and fall back to "info".       */
/* ------------------------------------------------------------------ */

type Severity = "info" | "warn" | "error";

const SEVERITIES: Severity[] = ["info", "warn", "error"];

const SEVERITY_META: Record<
  Severity,
  { label: string; dot: string; text: string; activeBtn: string }
> = {
  info: {
    label: "Info",
    dot: "bg-steel",
    text: "text-text2",
    activeBtn: "border-steel-bg bg-steel-bg text-steel",
  },
  warn: {
    label: "Warn",
    dot: "bg-amber",
    text: "text-amber-2",
    activeBtn: "border-amber-line bg-amber-bg text-amber-2",
  },
  error: {
    label: "Error",
    dot: "bg-stop",
    text: "text-stop",
    activeBtn: "border-[oklch(0.635_0.20_28/.35)] bg-stop-bg text-stop",
  },
};

function normalizeSeverity(level: string): Severity {
  const l = level.toLowerCase();
  if (l === "error" || l === "err" || l === "critical" || l === "fatal") return "error";
  if (l === "warn" || l === "warning") return "warn";
  return "info";
}

/* ------------------------------------------------------------------ */
/* Time formatting (parity with the dashboard console).                 */
/* ------------------------------------------------------------------ */

function timeHMS(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(d);
}

const ALL = "__all__";

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);

  // Filters.
  const [levelFilter, setLevelFilter] = useState<Severity | null>(null);
  const [eventFilter, setEventFilter] = useState<string>(ALL);

  const load = useCallback(async (): Promise<LogEntry[]> => {
    const rows = await api.listLogs();
    // Newest first; backend ordering is not guaranteed.
    return [...rows].sort(
      (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
    );
  }, []);

  // Initial load.
  useEffect(() => {
    let active = true;
    load()
      .then((next) => {
        if (active) {
          setLogs(next);
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

  // Poll every 5s while "live" and the tab is visible. The logs console is
  // append-only, so we refresh unconditionally rather than gating on in-flight
  // work — but we pause when the tab is hidden to avoid wasted requests.
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      load()
        .then((next) => {
          setLogs(next);
          setError(null);
        })
        .catch(() => {
          /* keep the last good snapshot on transient poll failures */
        });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [live, load]);

  // Distinct event types for the dropdown (sorted, from the full dataset).
  const eventTypes = useMemo(() => {
    if (!logs) return [];
    return [...new Set(logs.map((l) => l.event_type))].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [logs]);

  // If the active event filter disappears from the data (e.g. nothing matches
  // anymore), fall back to "all" so the view never gets stuck empty.
  useEffect(() => {
    if (eventFilter !== ALL && logs && !eventTypes.includes(eventFilter)) {
      setEventFilter(ALL);
    }
  }, [eventFilter, eventTypes, logs]);

  const filtered = useMemo(() => {
    if (!logs) return [];
    return logs.filter((l) => {
      if (levelFilter && normalizeSeverity(l.level) !== levelFilter) return false;
      if (eventFilter !== ALL && l.event_type !== eventFilter) return false;
      return true;
    });
  }, [logs, levelFilter, eventFilter]);

  // Per-severity counts (over the full dataset) for the filter chips.
  const severityCounts = useMemo(() => {
    const c: Record<Severity, number> = { info: 0, warn: 0, error: 0 };
    if (logs) for (const l of logs) c[normalizeSeverity(l.level)] += 1;
    return c;
  }, [logs]);

  const hasFilters = levelFilter !== null || eventFilter !== ALL;

  function clearFilters() {
    setLevelFilter(null);
    setEventFilter(ALL);
  }

  async function retry() {
    setError(null);
    setLogs(null);
    try {
      setLogs(await load());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }

  /* ---------- render ---------- */

  return (
    <div className="flex flex-col gap-5 p-[18px_22px]">
      {/* Page header */}
      <header className="oc-fade flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="disp text-[19px] font-semibold tracking-[0.01em]">Logs</h1>
          <p className="mt-1 text-[12.5px] text-text3">
            Journal d&apos;audit du cockpit · chaque étape OpenClaw, agent et
            validation est tracée ici.
          </p>
        </div>
        <LiveToggle
          live={live}
          onToggle={() => setLive((v) => !v)}
          count={logs?.length ?? 0}
        />
      </header>

      {/* Severity strip — instrument-style summary */}
      {logs && <SeverityStrip total={logs.length} counts={severityCounts} />}

      {/* Console section */}
      <section className="oc-fade" style={{ animationDelay: "0.06s" }}>
        <SectionHeader
          title="Console d'audit"
          count={logs ? `${filtered.length}/${logs.length}` : undefined}
          icon={
            <ScrollText size={16} strokeWidth={2} className="text-text2" aria-hidden />
          }
        />

        {/* Filter bar */}
        {logs && logs.length > 0 && (
          <FilterBar
            severityCounts={severityCounts}
            levelFilter={levelFilter}
            onLevelChange={setLevelFilter}
            eventTypes={eventTypes}
            eventFilter={eventFilter}
            onEventChange={setEventFilter}
            hasFilters={hasFilters}
            onClear={clearFilters}
          />
        )}

        {error && !logs ? (
          <ErrorState message={error} onRetry={retry} />
        ) : !logs ? (
          <LoadingState />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={<Inbox size={26} strokeWidth={1.8} aria-hidden />}
            title="Aucun log pour le moment"
            hint="Les événements apparaîtront ici dès qu'OpenClaw traitera une commande."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search size={26} strokeWidth={1.8} aria-hidden />}
            title="Aucun log ne correspond aux filtres"
            hint="Élargissez la sévérité ou le type d'événement."
            action={
              <ClearButton onClick={clearFilters} />
            }
          />
        ) : (
          <>
            {error && <InlineError message={error} />}
            <Console logs={filtered} />
          </>
        )}
      </section>
    </div>
  );
}

/* ================================================================== */
/* Live / pause toggle in the header.                                  */
/* ================================================================== */

function LiveToggle({
  live,
  onToggle,
  count,
}: {
  live: boolean;
  onToggle: () => void;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="mono text-[11px] text-text3 tnum">
        {count} entrée{count > 1 ? "s" : ""}
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={live}
        className={cn(
          "disp flex items-center gap-2 rounded-[8px] border px-3 py-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] transition-colors",
          live
            ? "border-ok-bg bg-ok-bg text-ok"
            : "border-line bg-bg-2 text-text2 hover:border-amber-line hover:text-text",
        )}
        title={live ? "Suspendre l'actualisation" : "Reprendre l'actualisation (5 s)"}
      >
        {live ? (
          <>
            <span
              className="h-[7px] w-[7px] rounded-full bg-ok"
              style={{ animation: "oc-blink 1.3s ease-in-out infinite" }}
              aria-hidden
            />
            Live
          </>
        ) : (
          <>
            <Play size={14} strokeWidth={2.2} aria-hidden />
            En pause
          </>
        )}
      </button>
    </div>
  );
}

/* ================================================================== */
/* Severity summary strip (parity with dashboard instrument strip).    */
/* ================================================================== */

function SeverityStrip({
  total,
  counts,
}: {
  total: number;
  counts: Record<Severity, number>;
}) {
  return (
    <section
      className="oc-fade flex items-stretch overflow-hidden rounded-[11px] border border-line bg-panel"
      style={{ animationDelay: "0.03s" }}
    >
      <StripCell label="Total" value={total} />
      <StripCell label="Info" value={counts.info} dot="bg-steel" tone="text-text" />
      <StripCell label="Warn" value={counts.warn} dot="bg-amber" tone="text-amber-2" />
      <StripCell
        label="Error"
        value={counts.error}
        dot="bg-stop"
        tone={counts.error > 0 ? "text-stop" : "text-text"}
        last
      />
    </section>
  );
}

function StripCell({
  label,
  value,
  dot,
  tone = "text-text",
  last = false,
}: {
  label: string;
  value: number;
  dot?: string;
  tone?: string;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-[7px] px-4 py-[13px]",
        !last && "border-r border-line-soft",
      )}
    >
      <span className="disp flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text3">
        {dot && (
          <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
        )}
        {label}
      </span>
      <span
        className={cn("disp tnum text-[26px] font-semibold leading-none", tone)}
      >
        {value}
      </span>
    </div>
  );
}

/* ================================================================== */
/* Filter bar: severity chips + event-type dropdown.                   */
/* ================================================================== */

function FilterBar({
  severityCounts,
  levelFilter,
  onLevelChange,
  eventTypes,
  eventFilter,
  onEventChange,
  hasFilters,
  onClear,
}: {
  severityCounts: Record<Severity, number>;
  levelFilter: Severity | null;
  onLevelChange: (s: Severity | null) => void;
  eventTypes: string[];
  eventFilter: string;
  onEventChange: (e: string) => void;
  hasFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2.5">
      {/* Severity segmented chips */}
      <div className="flex items-center gap-1.5">
        {SEVERITIES.map((sev) => {
          const active = levelFilter === sev;
          const meta = SEVERITY_META[sev];
          return (
            <button
              key={sev}
              type="button"
              aria-pressed={active}
              onClick={() => onLevelChange(active ? null : sev)}
              className={cn(
                "disp flex items-center gap-2 rounded-[20px] border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] transition-colors",
                active
                  ? meta.activeBtn
                  : "border-line-soft bg-bg-2 text-text2 hover:border-line hover:text-text",
              )}
            >
              <span className={cn("h-[7px] w-[7px] rounded-full", meta.dot)} aria-hidden />
              {meta.label}
              <span className="mono text-[10px] text-text3 tnum">
                {severityCounts[sev]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Event-type dropdown */}
      <label className="relative flex items-center">
        <ListFilter
          size={14}
          strokeWidth={2}
          className="pointer-events-none absolute left-3 text-text3"
          aria-hidden
        />
        <select
          value={eventFilter}
          onChange={(e) => onEventChange(e.target.value)}
          aria-label="Filtrer par type d'événement"
          className="mono cursor-pointer appearance-none rounded-[8px] border border-line-soft bg-bg-2 py-2 pl-[34px] pr-8 text-[11.5px] text-text2 transition-colors hover:border-line focus:border-amber-line focus:outline-none"
        >
          <option value={ALL}>Tous les événements</option>
          {eventTypes.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>
        <span
          className="pointer-events-none absolute right-3 text-text3"
          aria-hidden
        >
          ▾
        </span>
      </label>

      {hasFilters && <ClearButton onClick={onClear} />}
    </div>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-[8px] border border-transparent px-2.5 py-2 text-[11.5px] text-text3 transition-colors hover:border-line hover:bg-bg-2 hover:text-text"
    >
      <X size={13} strokeWidth={2.2} aria-hidden />
      Réinitialiser
    </button>
  );
}

/* ================================================================== */
/* The terminal console itself.                                        */
/* ================================================================== */

function Console({ logs }: { logs: LogEntry[] }) {
  // Insert lightweight day separators when the date changes between rows
  // (logs are newest-first, so this groups them by descending day).
  const items = useMemo(() => {
    const result: Array<
      | { kind: "day"; key: string; label: string }
      | { kind: "log"; log: LogEntry }
    > = [];
    let lastDay = "";
    for (const log of logs) {
      const day = dayLabel(log.created_at);
      if (day && day !== lastDay) {
        result.push({ kind: "day", key: `day-${day}`, label: day });
        lastDay = day;
      }
      result.push({ kind: "log", log });
    }
    return result;
  }, [logs]);

  return (
    <div
      className="oc-fade overflow-hidden rounded-[10px] border border-line-soft"
      style={{ background: "var(--console-bg)" }}
    >
      <div className="max-h-[calc(100vh-330px)] min-h-[220px] overflow-y-auto px-3.5 py-3">
        {items.map((item) =>
          item.kind === "day" ? (
            <DaySeparator key={item.key} label={item.label} />
          ) : (
            <LogLine key={item.log.id} log={item.log} />
          ),
        )}
      </div>
    </div>
  );
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-2 flex items-center gap-2.5 first:mt-0">
      <span className="micro text-[9.5px] tracking-[0.16em] text-text3">{label}</span>
      <span className="h-px flex-1 bg-line-soft" aria-hidden />
    </div>
  );
}

function LogLine({ log }: { log: LogEntry }) {
  const sev = normalizeSeverity(log.level);
  const meta = SEVERITY_META[sev];
  return (
    <div className="mono group flex items-baseline gap-2.5 rounded-[5px] py-[3px] text-[11px] leading-[1.7] transition-colors hover:bg-bg-2/40">
      <span className="flex-none text-text3 tnum">{timeHMS(log.created_at)}</span>
      <span
        className={cn("h-1.5 w-1.5 flex-none self-center rounded-full", meta.dot)}
        aria-hidden
      />
      <span className={cn("flex-none", meta.text)}>{log.event_type}</span>
      <span className="min-w-0 flex-1 truncate text-text3 group-hover:text-text2">
        {log.message}
      </span>
    </div>
  );
}

/* ================================================================== */
/* Loading / empty / error states (page-local, matching agents page).  */
/* ================================================================== */

function LoadingState() {
  return (
    <Panel className="grid place-items-center py-14">
      <div className="flex flex-col items-center gap-3 text-text3">
        <Spinner size={24} />
        <span className="disp text-[11px] font-semibold uppercase tracking-[0.1em]">
          Chargement de la console…
        </span>
      </div>
    </Panel>
  );
}

function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <Panel className="grid place-items-center py-14 text-center">
      <div className="flex max-w-[360px] flex-col items-center gap-2 text-text3">
        {icon}
        <span className="text-[13px] font-medium text-text2">{title}</span>
        <span className="text-[12px]">{hint}</span>
        {action && <div className="mt-1">{action}</div>}
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
          Impossible de charger les logs
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
