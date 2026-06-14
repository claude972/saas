"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Approval, Project, RiskLevel } from "@/lib/types";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";

const POLL_MS = 3000;

/* ------------------------------------------------------------------
   Validations humaines — file d'attente human-in-the-loop.
   Liste api.listApprovals (pending d'abord), cartes à liseré risque
   (façon `.appr` de design/cockpit-dashboard.html), boutons
   Accepter (api.acceptApproval) / Refuser (api.rejectApproval) avec
   note facultative. Rafraîchit la liste après chaque décision et
   poll tant qu'il reste des validations en attente.
   ------------------------------------------------------------------ */

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  accepted: 1,
  rejected: 1,
};

// Left-border accent per risk, mirroring `.appr` (high → terracotta, medium → amber).
const RISK_BORDER: Record<RiskLevel, string> = {
  low: "var(--ok)",
  medium: "var(--amber)",
  high: "var(--hot)",
  blocked: "var(--stop)",
};

function riskBorder(level: RiskLevel): string {
  return RISK_BORDER[level] ?? RISK_BORDER.medium;
}

// Stable colour for a project dot, keyed off its id (parity with the maquette pills).
const DOT_COLORS = [
  "var(--amber)",
  "var(--ok)",
  "var(--steel)",
  "var(--hot)",
] as const;

function dotColor(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i += 1) {
    hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  }
  return DOT_COLORS[hash % DOT_COLORS.length];
}

/** "à l'instant" / "il y a 4 min" / "il y a 2 h" / "il y a 3 j" from an ISO date. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

/** Pending first, then most recent first. */
function sortApprovals(list: readonly Approval[]): Approval[] {
  return [...list].sort((a, b) => {
    const rankA = STATUS_RANK[a.status] ?? 2;
    const rankB = STATUS_RANK[b.status] ?? 2;
    if (rankA !== rankB) return rankA - rankB;
    return b.created_at.localeCompare(a.created_at);
  });
}

/** The agent slug attached to an approval, if any (payload is free-form). */
function agentLabel(approval: Approval): string | null {
  const slug = approval.payload?.["agent_slug"];
  if (typeof slug === "string" && slug.trim()) return slug;
  const agent = approval.payload?.["agent"];
  if (typeof agent === "string" && agent.trim()) return agent;
  return null;
}

interface ViewState {
  approvals: Approval[];
  projects: Record<string, Project>;
}

export default function ApprovalsPage() {
  const [state, setState] = useState<ViewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Id-level guard so a decision in flight isn't double-fired or polled over.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  const load = useCallback(async (): Promise<ViewState> => {
    // Projects are best-effort: approvals must still render if /projects fails.
    const [approvals, projects] = await Promise.all([
      api.listApprovals(),
      api.listProjects().catch((): Project[] => []),
    ]);
    const byId: Record<string, Project> = {};
    for (const project of projects) byId[project.id] = project;
    return { approvals: sortApprovals(approvals), projects: byId };
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

  // Poll while validations are still pending. Skip during an in-flight decision
  // so we don't clobber optimistic state with a stale snapshot.
  const hasPending =
    state?.approvals.some((a) => a.status === "pending") ?? false;
  useEffect(() => {
    if (!hasPending) return;
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
  }, [hasPending, load]);

  const decide = useCallback(
    async (approval: Approval, accept: boolean, note: string) => {
      if (pendingRef.current) return;
      pendingRef.current = approval.id;
      setPendingId(approval.id);
      const trimmed = note.trim();
      const body = trimmed ? { note: trimmed } : undefined;
      try {
        const updated = accept
          ? await api.acceptApproval(approval.id, body)
          : await api.rejectApproval(approval.id, body);
        // Reflect the decision immediately, then re-sort so it leaves the queue head.
        setState((prev) =>
          prev
            ? {
                ...prev,
                approvals: sortApprovals(
                  prev.approvals.map((a) =>
                    a.id === approval.id ? updated : a,
                  ),
                ),
              }
            : prev,
        );
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Décision impossible.");
      } finally {
        pendingRef.current = null;
        setPendingId(null);
      }
    },
    [],
  );

  async function retry() {
    setError(null);
    setState(null);
    try {
      setState(await load());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }

  const pendingCount = useMemo(
    () => state?.approvals.filter((a) => a.status === "pending").length ?? 0,
    [state],
  );

  return (
    <div className="flex flex-col gap-5 px-[22px] py-[18px]">
      <header className="oc-fade">
        <div className="flex items-center gap-2.5">
          <ShieldCheck
            size={18}
            strokeWidth={2}
            className={pendingCount > 0 ? "text-hot" : "text-text2"}
            aria-hidden
          />
          <h1 className="disp text-[19px] font-semibold tracking-[0.01em]">
            Validations
          </h1>
        </div>
        <p className="mt-1 text-[12.5px] text-text3">
          File d&apos;attente des actions sensibles · OpenClaw propose, vous
          décidez. Chaque validation est journalisée.
        </p>
      </header>

      {state && <SummaryStrip approvals={state.approvals} />}

      <section className="oc-fade" style={{ animationDelay: "0.06s" }}>
        <SectionHeader
          title="À valider"
          count={state ? pendingCount : undefined}
          icon={
            <ShieldCheck
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
        ) : state.approvals.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {error && <InlineError message={error} />}
            <div className="flex flex-col gap-2.5">
              {state.approvals.map((approval, i) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  project={
                    approval.project_id
                      ? state.projects[approval.project_id]
                      : undefined
                  }
                  busy={pendingId === approval.id}
                  index={i}
                  onDecide={(accept, note) => decide(approval, accept, note)}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Summary strip — parity with the dashboard instrument strip.          */
/* ------------------------------------------------------------------ */

function SummaryStrip({ approvals }: { approvals: readonly Approval[] }) {
  const pending = approvals.filter((a) => a.status === "pending").length;
  const high = approvals.filter(
    (a) => a.status === "pending" && (a.risk_level === "high" || a.risk_level === "blocked"),
  ).length;
  const decided = approvals.length - pending;

  return (
    <section
      className="oc-fade flex items-stretch overflow-hidden rounded-[11px] border border-line bg-panel"
      style={{ animationDelay: "0.03s" }}
    >
      <StripCell
        label="En attente"
        value={pending}
        tone={pending > 0 ? "amber" : undefined}
      />
      <StripCell
        label="Risque élevé"
        value={high}
        tone={high > 0 ? "hot" : undefined}
      />
      <StripCell label="Traitées" value={decided} tone="ok" />
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
  tone?: "amber" | "ok" | "hot";
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
          tone === "hot" && "text-hot",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Approval card — ported from the maquette `.appr` block.              */
/* ------------------------------------------------------------------ */

const DECISION_META: Record<
  string,
  { label: string; tone: string; icon: LucideIcon }
> = {
  accepted: { label: "Acceptée", tone: "text-ok bg-ok-bg", icon: Check },
  rejected: { label: "Refusée", tone: "text-stop bg-stop-bg", icon: X },
};

function ApprovalCard({
  approval,
  project,
  busy,
  index,
  onDecide,
}: {
  approval: Approval;
  project?: Project;
  busy: boolean;
  index: number;
  onDecide: (accept: boolean, note: string) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const decided = approval.status !== "pending";
  const decision = DECISION_META[approval.status];
  const agent = agentLabel(approval);

  return (
    <section
      className="oc-fade relative overflow-hidden rounded-[11px] border border-line bg-panel px-3.5 py-3"
      style={{
        animationDelay: `${Math.min(index, 12) * 0.03}s`,
        borderLeftWidth: "3px",
        borderLeftColor: riskBorder(approval.risk_level),
      }}
    >
      {/* title */}
      <div className="text-[13px] font-medium leading-[1.4] text-text">
        {approval.title}
      </div>

      {/* meta row: risk + project pill + who/when */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <RiskBadge level={approval.risk_level} />
        {project ? (
          <ProjectPill name={project.name} color={dotColor(project.id)} />
        ) : approval.project_id ? (
          <ProjectPill name="Projet" color={dotColor(approval.project_id)} />
        ) : null}
        <span className="mono text-[10.5px] text-text3">
          {[agent, relativeTime(approval.created_at)]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>

      {/* description (optional) */}
      {approval.description && (
        <p className="mt-2 text-[12px] leading-[1.5] text-text3">
          {approval.description}
        </p>
      )}

      {/* decided state vs. action buttons */}
      {decided ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          {decision && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                decision.tone,
              )}
            >
              <decision.icon size={13} strokeWidth={2.2} aria-hidden />
              {decision.label}
            </span>
          )}
          {approval.decision_by && (
            <span className="mono text-[10.5px] text-text3">
              par {approval.decision_by}
            </span>
          )}
          {approval.decision_note && (
            <span className="text-[11.5px] italic text-text3">
              « {approval.decision_note} »
            </span>
          )}
        </div>
      ) : (
        <>
          {noteOpen && (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note de décision (facultatif)…"
              rows={2}
              disabled={busy}
              className="mt-2.5 w-full resize-none rounded-[8px] border border-line bg-bg-2 px-3 py-2 text-[12.5px] leading-[1.5] text-text outline-none transition-colors placeholder:text-text3 focus:border-amber-line disabled:opacity-60"
            />
          )}
          <div className="mt-2.5 flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => onDecide(true, note)}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-[7px] border border-[oklch(0.77_0.14_152_/_0.3)] bg-ok-bg px-0 py-[7px] font-[var(--font-saira)] text-[11.5px] font-semibold tracking-[0.04em] text-ok transition-colors hover:bg-[oklch(0.77_0.14_152_/_0.22)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <Spinner size={14} />
              ) : (
                <Check size={15} strokeWidth={2.4} aria-hidden />
              )}
              Accepter
            </button>
            <button
              type="button"
              onClick={() => onDecide(false, note)}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-[7px] border border-line bg-transparent px-0 py-[7px] font-[var(--font-saira)] text-[11.5px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:border-[oklch(0.635_0.2_28_/_0.3)] hover:bg-stop-bg hover:text-stop disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X size={15} strokeWidth={2.4} aria-hidden />
              Refuser
            </button>
            <button
              type="button"
              onClick={() => setNoteOpen((v) => !v)}
              disabled={busy}
              aria-pressed={noteOpen}
              aria-label="Ajouter une note de décision"
              title="Ajouter une note"
              className={cn(
                "grid w-9 flex-none place-items-center rounded-[7px] border transition-colors disabled:opacity-60",
                noteOpen
                  ? "border-amber-line bg-amber-bg text-amber-2"
                  : "border-line text-text3 hover:bg-bg-2 hover:text-text",
              )}
            >
              <MessageSquare size={15} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ProjectPill({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-bg-3 px-2 py-[2px] text-[10.5px] text-text2">
      <span
        className="h-[6px] w-[6px] flex-none rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="max-w-[160px] truncate">{name}</span>
    </span>
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
          Chargement des validations…
        </span>
      </div>
    </Panel>
  );
}

function EmptyState() {
  return (
    <Panel className="grid place-items-center py-14 text-center">
      <div className="flex max-w-[340px] flex-col items-center gap-2 text-text3">
        <ShieldCheck size={26} strokeWidth={1.8} className="text-ok" aria-hidden />
        <span className="text-[13px] font-medium text-text2">
          Aucune validation en attente
        </span>
        <span className="text-[12px]">
          Les actions sensibles proposées par OpenClaw (envoi client, devis,
          réponse à un appel d&apos;offre…) apparaîtront ici pour décision.
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
          Impossible de charger les validations
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
