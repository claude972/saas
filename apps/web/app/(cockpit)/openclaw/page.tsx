"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Terminal,
  Lock,
  Send,
  Camera,
  Receipt,
  ClipboardList,
  FileSearch,
  MoveRight,
  ShieldCheck,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { StatusChip } from "@/components/ui/StatusChip";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { OpenClawCommand, Project } from "@/lib/types";

/* ------------------------------------------------------------------
   Intent whitelist — mirrors backend core/command_router.INTENT_TO_AGENT.
   The chips expose the four operator-facing intents; the route preview
   reuses the same map so the UI shows the same agent the backend picks.
   ------------------------------------------------------------------ */
type IntentKey =
  | "analyze_photo"
  | "create_quote"
  | "create_quote_from_photo"
  | "create_site_report"
  | "analyze_tender";

const INTENT_TO_AGENT: Record<IntentKey, string> = {
  analyze_photo: "photo_analysis_agent",
  create_quote: "quote_agent",
  create_quote_from_photo: "quote_agent",
  create_site_report: "site_report_agent",
  analyze_tender: "tender_agent",
};

interface IntentChip {
  key: IntentKey;
  label: string;
  icon: LucideIcon;
}

// Order/labels follow the maquette command-center chips.
const CHIPS: IntentChip[] = [
  { key: "analyze_photo", label: "Analyse photo", icon: Camera },
  { key: "create_quote", label: "Créer un devis", icon: Receipt },
  { key: "create_site_report", label: "Compte-rendu", icon: ClipboardList },
  { key: "analyze_tender", label: "Appel d'offre", icon: FileSearch },
];

// Commands the backend is still working on -> keep polling while present.
const IN_FLIGHT: ReadonlySet<string> = new Set([
  "received",
  "routing",
  "running",
  "waiting_approval",
]);

const POLL_MS = 3000;

export default function OpenClawPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [commands, setCommands] = useState<OpenClawCommand[]>([]);

  const [instruction, setInstruction] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [intent, setIntent] = useState<IntentKey | "">("");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Keep the latest commands in a ref so the interval reads fresh state
  // without being re-created on every render.
  const commandsRef = useRef<OpenClawCommand[]>([]);
  commandsRef.current = commands;

  const refreshCommands = useCallback(async () => {
    const next = await api.listCommands();
    setCommands(next);
  }, []);

  // Initial load: projects + commands together.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [proj, cmds] = await Promise.all([
          api.listProjects(),
          api.listCommands(),
        ]);
        if (!alive) return;
        setProjects(proj);
        setCommands(cmds);
        setLoadError(null);
      } catch (err) {
        if (!alive) return;
        setLoadError(err instanceof Error ? err.message : "Erreur de chargement.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Poll only while at least one command is still being processed.
  useEffect(() => {
    const id = window.setInterval(() => {
      const hasInFlight = commandsRef.current.some((c) =>
        IN_FLIGHT.has(c.status),
      );
      if (hasInFlight) {
        refreshCommands().catch(() => {
          /* transient poll error: keep last good state */
        });
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshCommands]);

  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return (id?: string | null) => (id ? map.get(id) ?? null : null);
  }, [projects]);

  const canSend = instruction.trim().length > 0 && !sending;

  async function onSend() {
    if (!canSend) return;
    setSending(true);
    setSendError(null);
    try {
      await api.sendCommand({
        source: "openclaw",
        instruction: instruction.trim(),
        project_id: projectId || null,
        intent: intent || null,
      });
      setInstruction("");
      setIntent("");
      // Surface the new command immediately; polling takes over from there.
      await refreshCommands();
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Échec de l'envoi de la commande.",
      );
    } finally {
      setSending(false);
    }
  }

  function onTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl + Enter sends (the maquette implies a fast command flow).
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void onSend();
    }
  }

  return (
    <div className="flex flex-col gap-5 p-[18px] sm:px-[22px]">
      {/* ===== Command center ===== */}
      <Panel accent className="oc-fade">
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

        <div className="flex flex-col gap-2.5 md:flex-row md:items-stretch">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            rows={2}
            placeholder="Ex : Analyse les photos du chantier Villa Ducos et prépare un devis placo-peinture…"
            className={cn(
              "min-h-[54px] flex-1 resize-y rounded-[9px] border border-line bg-bg-2 px-3.5 py-3",
              "text-[13.5px] leading-[1.55] text-text placeholder:text-text3",
              "outline-none transition-colors focus:border-amber-line",
            )}
          />

          <div className="flex gap-2.5 md:flex-col">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              aria-label="Projet associé"
              className={cn(
                "h-[54px] flex-1 rounded-[9px] border border-line bg-bg-2 px-3 md:h-auto md:flex-none md:py-3",
                "text-[12.5px] text-text2 outline-none transition-colors focus:border-amber-line",
                "md:min-w-[200px]",
              )}
            >
              <option value="">Aucun projet</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              className={cn(
                "disp flex h-[54px] flex-none items-center justify-center gap-2 rounded-[9px] px-5",
                "text-[13px] font-semibold tracking-[0.04em] transition-colors",
                "bg-amber text-[var(--amber-fg)] hover:bg-amber-2",
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-amber",
              )}
            >
              {sending ? (
                <Spinner size={16} />
              ) : (
                <Send size={18} strokeWidth={2} aria-hidden />
              )}
              Exécuter
            </button>
          </div>
        </div>

        {/* intent chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          {CHIPS.map((chip) => {
            const ChipIcon = chip.icon;
            const active = intent === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setIntent(active ? "" : chip.key)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-[11px] py-1.5 text-xs transition-colors",
                  active
                    ? "border-amber-line bg-amber-bg text-amber-2"
                    : "border-line-soft bg-bg-2 text-text2 hover:border-amber-line hover:text-text",
                )}
              >
                <ChipIcon
                  size={15}
                  strokeWidth={2}
                  className={active ? "text-amber" : "text-text3"}
                  aria-hidden
                />
                {chip.label}
              </button>
            );
          })}
          {intent && (
            <span className="mono ml-1 flex items-center gap-1.5 self-center text-[11px] text-text3">
              <MoveRight size={13} aria-hidden />
              <b className="font-medium text-amber-2">
                {INTENT_TO_AGENT[intent]}
              </b>
            </span>
          )}
        </div>

        {sendError && (
          <div className="mt-3 flex items-center gap-2 rounded-[7px] border border-[color:var(--stop-bg)] bg-stop-bg px-3 py-2 text-[12px] text-stop">
            <AlertTriangle size={14} strokeWidth={2} aria-hidden />
            {sendError}
          </div>
        )}
      </Panel>

      {/* ===== Recent commands ===== */}
      <section className="oc-fade" style={{ animationDelay: "0.08s" }}>
        <SectionHeader
          title="Commandes OpenClaw récentes"
          count={loading ? undefined : commands.length}
          icon={
            <ShieldCheck
              size={16}
              strokeWidth={2}
              className="text-text2"
              aria-hidden
            />
          }
        />

        {loading ? (
          <Panel className="grid place-items-center py-14">
            <Spinner size={24} />
          </Panel>
        ) : loadError ? (
          <Panel className="flex flex-col items-center gap-2 py-12 text-center">
            <AlertTriangle
              size={22}
              strokeWidth={2}
              className="text-stop"
              aria-hidden
            />
            <p className="text-[13px] text-text2">{loadError}</p>
          </Panel>
        ) : commands.length === 0 ? (
          <Panel className="flex flex-col items-center gap-2 py-12 text-center">
            <Terminal
              size={22}
              strokeWidth={2}
              className="text-text3"
              aria-hidden
            />
            <p className="text-[13px] text-text2">
              Aucune commande pour l'instant.
            </p>
            <p className="text-[12px] text-text3">
              Lancez une instruction depuis le centre de commande ci-dessus.
            </p>
          </Panel>
        ) : (
          <Panel bare>
            <div className="flex flex-col">
              {commands.map((cmd) => (
                <CommandRow
                  key={cmd.id}
                  command={cmd}
                  projectName={projectName(cmd.project_id)}
                />
              ))}
            </div>
          </Panel>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------
   A single command row (.crow parity): time · instruction + route ·
   risk badge + status chip + "validation requise" marker.
   ------------------------------------------------------------------ */
function CommandRow({
  command,
  projectName,
}: {
  command: OpenClawCommand;
  projectName: string | null;
}) {
  const active = IN_FLIGHT.has(command.status);
  const agent = command.intent
    ? INTENT_TO_AGENT[command.intent as IntentKey]
    : undefined;

  return (
    <div
      className={cn(
        "relative grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line-soft px-3.5 py-3 last:border-b-0",
        "transition-colors hover:bg-bg-2",
        active && "bg-amber-bg",
      )}
    >
      {active && (
        <span
          className="absolute inset-y-0 left-0 w-[2px] bg-amber"
          aria-hidden
        />
      )}

      <span className="mono text-[11px] text-text3">
        {formatTime(command.created_at)}
      </span>

      <div className="min-w-0">
        <div className="mb-1 truncate text-[13px] text-text">
          {command.instruction}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projectName && (
            <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-bg-3 px-2 py-0.5 text-[10.5px] text-text2">
              <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden />
              {projectName}
            </span>
          )}
          {command.intent && (
            <span className="mono inline-flex items-center gap-1.5 text-[10.5px] text-text3">
              {command.intent}
              {agent && (
                <>
                  <MoveRight size={13} aria-hidden />
                  <b className="font-medium text-amber-2">{agent}</b>
                </>
              )}
            </span>
          )}
          {command.requires_approval && (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-hot">
              <ShieldCheck size={12} strokeWidth={2.2} aria-hidden />
              Validation requise
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2.5">
        <RiskBadge level={command.risk_level} />
        <StatusChip status={command.status} />
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
