"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Braces,
  Camera,
  CheckCircle2,
  ClipboardList,
  FileSearch,
  Play,
  Receipt,
  RotateCcw,
  Save,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Agent, JsonObject, Task } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { RiskBadge } from "@/components/ui/RiskBadge";
import { StatusChip } from "@/components/ui/StatusChip";
import { Spinner } from "@/components/ui/Spinner";

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

/** Pick a métier icon for an agent from its slug (parity with maquette). */
function agentIcon(slug: string): LucideIcon {
  if (slug.includes("photo")) return Camera;
  if (slug.includes("quote")) return Receipt;
  if (slug.includes("report")) return ClipboardList;
  if (slug.includes("tender")) return FileSearch;
  return Bot;
}

/** Default test instruction per agent, used to pre-fill the "Lancer" box. */
function defaultInstruction(slug: string): string {
  if (slug.includes("photo"))
    return "Analyse les photos de chantier fournies et décris les travaux visibles.";
  if (slug.includes("quote"))
    return "Prépare un devis brouillon placo-peinture pour une pièce de 20 m².";
  if (slug.includes("report"))
    return "Rédige un compte-rendu de la visite de chantier de ce matin.";
  if (slug.includes("tender"))
    return "Analyse le DCE de l'appel d'offre et liste les pièces demandées.";
  return "Lance un traitement de test sur cet agent.";
}

const POLL_MS = 3000;
const RUNNING_STATUSES = new Set(["running", "waiting_approval", "assigned"]);

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Pretty-print a config object; empty/absent -> minimal stub for editing. */
function configToText(config: JsonObject | null | undefined): string {
  if (config === null || config === undefined) return "{}";
  try {
    return JSON.stringify(config, null, 2);
  } catch {
    return "{}";
  }
}

/* ------------------------------------------------------------------ */
/* page                                                               */
/* ------------------------------------------------------------------ */

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const agentId = params.id;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load agent + its tasks. Reusable for the poll loop.
  const loadAll = useCallback(async () => {
    const [ag, allTasks] = await Promise.all([
      api.getAgent(agentId),
      api.listTasks(),
    ]);
    setAgent(ag);
    setTasks(allTasks.filter((t) => t.agent_id === agentId));
    return ag;
  }, [agentId]);

  // initial load
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loadAll()
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Chargement impossible.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadAll]);

  // sort newest first; the agent's running tasks drive the poll
  const agentTasks = useMemo(
    () =>
      [...tasks].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [tasks],
  );

  const hasLiveTask = useMemo(
    () => agentTasks.some((t) => RUNNING_STATUSES.has(t.status)),
    [agentTasks],
  );

  // poll while a task is running / waiting on approval
  useEffect(() => {
    if (!hasLiveTask) return;
    const id = setInterval(() => {
      loadAll().catch(() => {
        /* keep the last good state on transient errors */
      });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [hasLiveTask, loadAll]);

  /* ---------- loading / error / empty ---------- */

  if (loading) {
    return (
      <Center>
        <div className="grid place-items-center py-24">
          <Spinner size={26} />
        </div>
      </Center>
    );
  }

  if (error || !agent) {
    return (
      <Center>
        <BackLink onClick={() => router.push("/agents")} />
        <ErrorBox
          message={error ?? "Agent introuvable."}
          onRetry={() => {
            setLoading(true);
            setError(null);
            loadAll()
              .catch((e: unknown) =>
                setError(
                  e instanceof Error ? e.message : "Chargement impossible.",
                ),
              )
              .finally(() => setLoading(false));
          }}
        />
      </Center>
    );
  }

  const Icon = agentIcon(agent.slug);

  return (
    <Center>
      <BackLink onClick={() => router.push("/agents")} />

      {/* ===== header band ===== */}
      <Panel accent className="oc-fade pl-5">
        <div className="flex flex-wrap items-center gap-4">
          <div
            className={cn(
              "relative grid h-12 w-12 flex-none place-items-center rounded-[9px]",
              agent.enabled ? "bg-amber-bg text-amber" : "bg-bg-3 text-text2",
            )}
          >
            <Icon size={24} strokeWidth={2} aria-hidden />
            {agent.status === "running" && (
              <span
                className="absolute -bottom-0.5 -right-0.5 h-[11px] w-[11px] rounded-full border-2 border-panel bg-amber"
                style={{ animation: "oc-blink 1.3s ease-in-out infinite" }}
                aria-hidden
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="disp truncate text-[20px] font-semibold leading-tight tracking-[0.01em] text-text">
              {agent.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-text3">
              <span className="text-text2">{agent.role}</span>
              <Sep />
              <span className="mono text-amber-2">{agent.slug}</span>
              <Sep />
              <span className="mono">v{agent.version}</span>
              {agent.agent_type && (
                <>
                  <Sep />
                  <span className="mono">{agent.agent_type}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-none items-center gap-3">
            <StatusChip status={agent.status} />
            <RiskBadge level={agent.risk_level} />
            <EnableToggle
              agent={agent}
              onChange={(next) => setAgent(next)}
              onError={setError}
            />
          </div>
        </div>

        {agent.description && (
          <p className="mt-3.5 border-t border-line-soft pt-3.5 text-[12.5px] leading-relaxed text-text2">
            {agent.description}
          </p>
        )}
      </Panel>

      {/* ===== two-column body ===== */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* --- main column --- */}
        <div className="flex flex-col gap-5">
          <RunPanel agent={agent} onLaunched={loadAll} />
          <ConfigPanel agent={agent} onSaved={(next) => setAgent(next)} />
          <TasksPanel
            tasks={agentTasks}
            live={hasLiveTask}
            agentName={agent.name}
          />
        </div>

        {/* --- side column --- */}
        <div className="flex flex-col gap-5">
          <MetadataPanel agent={agent} />
          <SchemaPanel agent={agent} />
        </div>
      </div>
    </Center>
  );
}

/* ------------------------------------------------------------------ */
/* layout shell                                                       */
/* ------------------------------------------------------------------ */

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5 px-[22px] py-[18px]">{children}</div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-fit items-center gap-1.5 text-[12px] text-text3 transition-colors hover:text-amber-2"
    >
      <ArrowLeft size={14} strokeWidth={2.2} aria-hidden />
      Sous-agents
    </button>
  );
}

function Sep() {
  return <span className="h-[3px] w-[3px] rounded-full bg-text3" aria-hidden />;
}

/** Dark spinner for use on the amber primary buttons (visible on amber). */
function ButtonSpinner({ size = 15 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Chargement"
      className="inline-block flex-none animate-spin rounded-full"
      style={{
        width: size,
        height: size,
        borderWidth: 2,
        borderStyle: "solid",
        borderColor: "var(--amber-fg)",
        borderTopColor: "transparent",
        opacity: 0.7,
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* enable / disable toggle                                            */
/* ------------------------------------------------------------------ */

function EnableToggle({
  agent,
  onChange,
  onError,
}: {
  agent: Agent;
  onChange: (next: Agent) => void;
  onError: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    onError(null);
    try {
      const next = agent.enabled
        ? await api.disableAgent(agent.id)
        : await api.enableAgent(agent.id);
      onChange(next);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      role="switch"
      aria-checked={agent.enabled}
      aria-label={agent.enabled ? "Désactiver l'agent" : "Activer l'agent"}
      title={agent.enabled ? "Activé — cliquer pour désactiver" : "Désactivé — cliquer pour activer"}
      className={cn(
        "relative h-[18px] w-[32px] flex-none rounded-full transition-colors disabled:opacity-60",
        agent.enabled ? "bg-ok" : "bg-bg-3",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[var(--bg)] transition-all",
          agent.enabled ? "right-[2px]" : "left-[2px]",
        )}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* run / "Lancer" panel                                               */
/* ------------------------------------------------------------------ */

function RunPanel({
  agent,
  onLaunched,
}: {
  agent: Agent;
  onLaunched: () => Promise<unknown>;
}) {
  const [instruction, setInstruction] = useState(() =>
    defaultInstruction(agent.slug),
  );
  const [busy, setBusy] = useState(false);
  const [launched, setLaunched] = useState<Task | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setLaunched(null);
    try {
      const task = await api.runAgent(agent.id, {
        instruction: instruction.trim() || defaultInstruction(agent.slug),
      });
      setLaunched(task);
      // refresh the agent's task list so the new run shows up + polling kicks in
      await onLaunched();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lancement impossible.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || !agent.enabled;

  return (
    <Panel accent className="pl-5">
      <div className="mb-3 flex items-center gap-2">
        <Play size={15} strokeWidth={2.2} className="text-amber" aria-hidden />
        <span className="disp text-[11.5px] font-semibold uppercase tracking-[0.13em] text-amber-2">
          Lancer une exécution de test
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-text3">
          <RotateCcw size={12} strokeWidth={2} aria-hidden />
          brouillon · validé par le backend
        </span>
      </div>

      <label className="mb-1.5 block">
        <span className="micro">Instruction</span>
      </label>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={3}
        spellCheck={false}
        className="w-full resize-y rounded-[9px] border border-line bg-bg-2 px-3.5 py-3 text-[13px] leading-relaxed text-text outline-none transition-colors placeholder:text-text3 focus:border-amber-line"
        placeholder="Décris la tâche de test à confier à cet agent…"
      />

      {!agent.enabled && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-text3">
          <AlertTriangle
            size={13}
            strokeWidth={2.2}
            className="text-amber-2"
            aria-hidden
          />
          Agent désactivé — réactivez-le pour pouvoir le lancer.
        </p>
      )}

      {err && <InlineError className="mt-3" message={err} />}

      {launched && (
        <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-[8px] border border-line-soft bg-bg-2 px-3 py-2.5 text-[12px]">
          <CheckCircle2
            size={15}
            strokeWidth={2.2}
            className="flex-none text-ok"
            aria-hidden
          />
          <span className="text-text2">Tâche créée :</span>
          <span className="truncate text-text">{launched.title}</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="mono text-[10.5px] text-text3">
              #{launched.id.slice(0, 8)}
            </span>
            <StatusChip status={launched.status} />
          </span>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={run}
          disabled={disabled}
          className="disp flex h-[44px] items-center gap-2 rounded-[9px] bg-amber px-5 text-[13px] font-semibold tracking-[0.04em] text-[var(--amber-fg)] transition-colors hover:bg-amber-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? (
            <ButtonSpinner size={16} />
          ) : (
            <Play size={17} strokeWidth={2.4} aria-hidden />
          )}
          {busy ? "Lancement…" : "Lancer l'agent"}
        </button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* config editor                                                      */
/* ------------------------------------------------------------------ */

function ConfigPanel({
  agent,
  onSaved,
}: {
  agent: Agent;
  onSaved: (next: Agent) => void;
}) {
  const initial = useMemo(() => configToText(agent.config), [agent.config]);
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Keep the editor in sync when the agent reloads (e.g. after save/poll),
  // unless the user is mid-edit on a dirty buffer.
  const lastInitial = useRef(initial);
  useEffect(() => {
    if (lastInitial.current !== initial) {
      lastInitial.current = initial;
      setText(initial);
    }
  }, [initial]);

  const dirty = text !== initial;

  // live JSON validity for the editor
  const parsed = useMemo<
    { ok: true; value: JsonObject } | { ok: false; error: string }
  >(() => {
    const trimmed = text.trim();
    if (trimmed === "") return { ok: true, value: {} };
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, error: "La config doit être un objet JSON." };
      }
      return { ok: true, value: value as JsonObject };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "JSON invalide.",
      };
    }
  }, [text]);

  async function save() {
    if (busy || !parsed.ok || !dirty) return;
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const next = await api.updateAgent(agent.id, { config: parsed.value });
      onSaved(next);
      setOk(true);
      window.setTimeout(() => setOk(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel bare>
      <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
        <Braces size={15} strokeWidth={2.2} className="text-text2" aria-hidden />
        <span className="disp text-[11px] font-semibold uppercase tracking-[0.11em] text-text2">
          Configuration
        </span>
        <span className="mono ml-auto text-[10.5px] text-text3">JSON</span>
      </div>

      <div className="p-4">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOk(false);
            setErr(null);
          }}
          rows={10}
          spellCheck={false}
          className={cn(
            "mono w-full resize-y rounded-[9px] border bg-[var(--console-bg)] px-3.5 py-3 text-[12px] leading-[1.7] text-text outline-none transition-colors",
            parsed.ok ? "border-line focus:border-amber-line" : "border-stop/60",
          )}
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {!parsed.ok && (
            <span className="flex items-center gap-1.5 text-[11.5px] text-stop">
              <AlertTriangle size={13} strokeWidth={2.2} aria-hidden />
              {parsed.error}
            </span>
          )}
          {parsed.ok && err && (
            <span className="flex items-center gap-1.5 text-[11.5px] text-stop">
              <AlertTriangle size={13} strokeWidth={2.2} aria-hidden />
              {err}
            </span>
          )}
          {ok && !dirty && (
            <span className="flex items-center gap-1.5 text-[11.5px] text-ok">
              <CheckCircle2 size={13} strokeWidth={2.2} aria-hidden />
              Configuration enregistrée.
            </span>
          )}
          {dirty && parsed.ok && !err && (
            <span className="mono text-[11px] text-text3">
              Modifications non enregistrées
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setText(initial);
                setErr(null);
                setOk(false);
              }}
              disabled={!dirty || busy}
              className="flex h-[36px] items-center gap-1.5 rounded-[7px] border border-line bg-bg-2 px-3.5 text-[12px] font-medium text-text2 transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw size={14} strokeWidth={2} aria-hidden />
              Réinitialiser
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || !parsed.ok || busy}
              className="disp flex h-[36px] items-center gap-1.5 rounded-[7px] bg-amber px-4 text-[12px] font-semibold tracking-[0.03em] text-[var(--amber-fg)] transition-colors hover:bg-amber-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <ButtonSpinner size={14} />
              ) : (
                <Save size={14} strokeWidth={2.2} aria-hidden />
              )}
              Enregistrer
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* recent tasks                                                       */
/* ------------------------------------------------------------------ */

function TasksPanel({
  tasks,
  live,
  agentName,
}: {
  tasks: Task[];
  live: boolean;
  agentName: string;
}) {
  return (
    <section>
      <SectionHeader
        title="Tâches récentes"
        count={tasks.length}
        action={{ label: "File complète", href: "/tasks" }}
        icon={
          live ? (
            <span
              className="h-[7px] w-[7px] flex-none rounded-full bg-amber"
              style={{ animation: "oc-blink 1.3s ease-in-out infinite" }}
              aria-hidden
            />
          ) : undefined
        }
      />

      {tasks.length === 0 ? (
        <div className="rounded-[11px] border border-line bg-panel px-4 py-10 text-center">
          <p className="text-[12.5px] text-text2">
            Aucune tâche pour cet agent.
          </p>
          <p className="mt-1 text-[11.5px] text-text3">
            Lancez {agentName} ci-dessus pour générer une première tâche.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[11px] border border-line bg-panel">
          <div className="grid grid-cols-[1fr_140px_96px] items-center gap-3 bg-bg-2 px-4 py-2.5">
            {["Tâche", "Statut", "Créée"].map((h) => (
              <span
                key={h}
                className="disp text-[10px] font-semibold uppercase tracking-[0.1em] text-text3 last:text-right"
              >
                {h}
              </span>
            ))}
          </div>
          {tasks.map((t) => (
            <div
              key={t.id}
              className="grid grid-cols-[1fr_140px_96px] items-center gap-3 border-t border-line-soft px-4 py-2.5 transition-colors hover:bg-bg-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] font-medium text-text">
                    {t.title}
                  </span>
                  {RUNNING_STATUSES.has(t.status) && (
                    <span className="relative h-[2px] w-[40px] flex-none overflow-hidden rounded-[2px] bg-bg-3">
                      <span
                        className="absolute h-full w-[45%] rounded-[2px] bg-amber"
                        style={{ animation: "oc-slide 1.6s ease-in-out infinite" }}
                        aria-hidden
                      />
                    </span>
                  )}
                </div>
                <div className="mono mt-0.5 truncate text-[10.5px] text-text3">
                  #{t.id.slice(0, 8)}
                  {t.error ? ` · ${t.error}` : ""}
                </div>
              </div>
              <div>
                <StatusChip status={t.status} />
              </div>
              <span className="mono text-right text-[11px] text-text3">
                {fmtTime(t.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* metadata + schema (side column)                                    */
/* ------------------------------------------------------------------ */

function MetadataPanel({ agent }: { agent: Agent }) {
  const rows: Array<{ k: string; v: React.ReactNode; mono?: boolean }> = [
    { k: "Slug", v: agent.slug, mono: true },
    { k: "Type", v: agent.agent_type ?? "—", mono: true },
    { k: "Version", v: `v${agent.version}`, mono: true },
    {
      k: "État",
      v: agent.enabled ? (
        <span className="text-ok">Activé</span>
      ) : (
        <span className="text-text3">Désactivé</span>
      ),
    },
    { k: "Statut", v: agent.status, mono: true },
    { k: "Créé le", v: fmtDateTime(agent.created_at), mono: true },
    { k: "Mis à jour", v: fmtDateTime(agent.updated_at), mono: true },
  ];

  return (
    <Panel bare>
      <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
        <Bot size={15} strokeWidth={2.2} className="text-text2" aria-hidden />
        <span className="disp text-[11px] font-semibold uppercase tracking-[0.11em] text-text2">
          Métadonnées
        </span>
        <RiskBadge level={agent.risk_level} className="ml-auto" />
      </div>
      <div className="px-4 py-2">
        {rows.map((r) => (
          <div
            key={r.k}
            className="flex items-center justify-between gap-3 border-b border-line-soft py-2 last:border-b-0"
          >
            <span className="text-[11.5px] text-text3">{r.k}</span>
            <span
              className={cn(
                "truncate text-[11.5px] text-text2",
                r.mono && "mono",
              )}
            >
              {r.v}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SchemaPanel({ agent }: { agent: Agent }) {
  const input = agent.input_schema ?? {};
  const output = agent.output_schema ?? {};
  const hasInput = Object.keys(input).length > 0;
  const hasOutput = Object.keys(output).length > 0;

  if (!hasInput && !hasOutput) return null;

  return (
    <Panel bare>
      <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
        <Braces size={15} strokeWidth={2.2} className="text-text2" aria-hidden />
        <span className="disp text-[11px] font-semibold uppercase tracking-[0.11em] text-text2">
          Schémas
        </span>
      </div>
      <div className="flex flex-col gap-3 p-4">
        {hasInput && <SchemaBlock label="Entrée" value={input} />}
        {hasOutput && <SchemaBlock label="Sortie" value={output} />}
      </div>
    </Panel>
  );
}

function SchemaBlock({ label, value }: { label: string; value: JsonObject }) {
  return (
    <div>
      <span className="micro">{label}</span>
      <pre className="mono mt-1.5 max-h-48 overflow-auto rounded-[8px] border border-line-soft bg-[var(--console-bg)] px-3 py-2.5 text-[11px] leading-[1.7] text-text2">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* error primitives                                                   */
/* ------------------------------------------------------------------ */

function InlineError({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[8px] border border-stop-bg bg-stop-bg px-3 py-2.5 text-[12px] text-stop",
        className,
      )}
    >
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

function ErrorBox({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Panel className="oc-fade">
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertTriangle
          size={26}
          strokeWidth={2}
          className="text-stop"
          aria-hidden
        />
        <p className="text-[13px] text-text2">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="disp flex h-[38px] items-center gap-1.5 rounded-[8px] border border-line bg-bg-2 px-4 text-[12px] font-semibold text-text2 transition-colors hover:text-text"
        >
          <RotateCcw size={14} strokeWidth={2.2} aria-hidden />
          Réessayer
        </button>
      </div>
    </Panel>
  );
}
