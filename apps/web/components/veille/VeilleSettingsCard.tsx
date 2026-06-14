"use client";

import { useCallback, useEffect, useId, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Eye,
  Play,
  RefreshCw,
  Save,
} from "lucide-react";
import { api } from "@/lib/api";
import type { VeilleConfig, VeilleConfigUpdateInput } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ */
/* Frequency presets (interval_minutes).                                */
/* ------------------------------------------------------------------ */

interface FrequencyOption {
  label: string;
  minutes: number;
}

const FREQUENCY_OPTIONS: FrequencyOption[] = [
  { label: "1 heure", minutes: 60 },
  { label: "2 heures", minutes: 120 },
  { label: "3 heures", minutes: 180 },
  { label: "4 heures", minutes: 240 },
  { label: "6 heures", minutes: 360 },
  { label: "12 heures", minutes: 720 },
  { label: "24 heures", minutes: 1440 },
];

const CUSTOM_VALUE = -1;

/* Modèles Perplexity sélectionnables depuis le cockpit. */
const MODEL_OPTIONS = ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro"];
const CUSTOM_MODEL = "__custom__";

/* Fuseaux horaires DOM-TOM (pour l'interprétation des heures de silence). */
const TIMEZONE_OPTIONS: { label: string; value: string }[] = [
  { label: "Martinique (UTC-4)", value: "America/Martinique" },
  { label: "Guadeloupe (UTC-4)", value: "America/Guadeloupe" },
  { label: "Guyane (UTC-3)", value: "America/Cayenne" },
  { label: "La Réunion (UTC+4)", value: "Indian/Reunion" },
  { label: "Mayotte (UTC+3)", value: "Indian/Mayotte" },
  { label: "Métropole (Paris)", value: "Europe/Paris" },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** Formats an ISO datetime string to a locale-friendly French label. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Returns the matching preset minutes value, or CUSTOM_VALUE if none. */
function detectPreset(minutes: number): number {
  const found = FREQUENCY_OPTIONS.find((o) => o.minutes === minutes);
  return found ? found.minutes : CUSTOM_VALUE;
}

/** Maps a last_status string to a tone class and label. */
function statusTone(s: string | null | undefined): { cls: string; label: string } {
  if (!s) return { cls: "text-text3", label: "—" };
  if (s === "ok" || s === "success") return { cls: "text-ok", label: "Succès" };
  if (s === "error" || s === "failed") return { cls: "text-stop", label: "Erreur" };
  return { cls: "text-amber-2", label: s };
}

/* ------------------------------------------------------------------ */
/* Reusable primitives — scoped to this file.                           */
/* ------------------------------------------------------------------ */

const fieldCls =
  "w-full rounded-[6px] border border-line bg-bg-2 px-2.5 py-1.5 text-[12.5px] text-text placeholder:text-text3 focus:border-amber-line focus:outline-none";

function PanelHead({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-line-soft px-3.5 py-3">
      <Eye size={15} strokeWidth={2} className="flex-none text-amber-2" aria-hidden />
      <span className="disp text-[11px] font-semibold uppercase tracking-[0.11em] text-text2">
        {title}
      </span>
    </div>
  );
}

function FieldRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-line-soft px-3.5 py-3 last:border-b-0">
      <div className="flex w-[148px] flex-none flex-col pt-1">
        <label
          htmlFor={htmlFor}
          className="text-[11px] font-medium text-text2"
        >
          {label}
        </label>
      </div>
      <div className="flex flex-1 flex-col gap-1 min-w-0">{children}</div>
    </div>
  );
}

function ReadRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-b-0">
      <span className="w-[148px] flex-none text-[11px] text-text3">{label}</span>
      <span className={cn("mono text-[11.5px]", valueClass ?? "text-text2")}>{value}</span>
    </div>
  );
}

/* Interactive toggle — visually matches StaticToggle in settings/page.tsx */
function Toggle({
  id,
  checked,
  onChange,
  disabled,
}: {
  id?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[17px] w-[30px] flex-none rounded-[10px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber",
        checked ? "bg-ok" : "bg-bg-3",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] h-[13px] w-[13px] rounded-full bg-[var(--bg)] transition-[right,left]",
          checked ? "right-[2px]" : "left-[2px]",
        )}
        aria-hidden
      />
    </button>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-[8px] border border-stop-bg bg-stop-bg px-3 py-2.5 text-[12px] text-stop">
      <AlertTriangle size={14} strokeWidth={2.2} className="mt-px flex-none" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                       */
/* ------------------------------------------------------------------ */

export function VeilleSettingsCard() {
  const toggleId = useId();
  const freqId = useId();
  const customId = useId();
  const quietStartId = useId();
  const quietEndId = useId();
  const tzId = useId();
  const modelId = useId();
  const customModelId = useId();
  const promptId = useId();

  // Remote state
  const [config, setConfig] = useState<VeilleConfig | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state (mirrors VeilleConfigUpdateInput)
  const [enabled, setEnabled] = useState(false);
  const [preset, setPreset] = useState<number>(180); // selected preset minutes or CUSTOM_VALUE
  const [customMinutes, setCustomMinutes] = useState<string>("180");
  const [quietStart, setQuietStart] = useState<string>("");
  const [quietEnd, setQuietEnd] = useState<string>("");
  const [timezone, setTimezone] = useState<string>("America/Martinique");
  const [perplexityModel, setPerplexityModel] = useState<string>("sonar");
  const [customModel, setCustomModel] = useState<string>("");
  const [searchPrompt, setSearchPrompt] = useState<string>("");

  // Save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Run-now state
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ count: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  /** Populate form fields from a VeilleConfig object. */
  const applyConfig = useCallback((c: VeilleConfig) => {
    setEnabled(c.enabled);
    const detected = detectPreset(c.interval_minutes);
    setPreset(detected);
    setCustomMinutes(String(c.interval_minutes));
    setQuietStart(c.quiet_start != null ? String(c.quiet_start) : "");
    setQuietEnd(c.quiet_end != null ? String(c.quiet_end) : "");
    setTimezone(c.timezone || "America/Martinique");
    const m = c.perplexity_model || "sonar";
    setPerplexityModel(MODEL_OPTIONS.includes(m) ? m : CUSTOM_MODEL);
    setCustomModel(MODEL_OPTIONS.includes(m) ? "" : m);
    setSearchPrompt(c.search_prompt ?? "");
  }, []);

  useEffect(() => {
    api
      .getVeilleConfig()
      .then((c) => {
        setConfig(c);
        applyConfig(c);
      })
      .catch((e: unknown) =>
        setLoadError(
          e instanceof Error
            ? e.message
            : "Impossible de charger la configuration veille.",
        ),
      )
      .finally(() => setLoadingData(false));
  }, [applyConfig]);

  /** The effective interval_minutes derived from current form state. */
  function resolvedMinutes(): number {
    if (preset === CUSTOM_VALUE) {
      const n = parseInt(customMinutes, 10);
      return isNaN(n) || n < 1 ? 60 : n;
    }
    return preset;
  }

  /** The effective perplexity model derived from current form state. */
  function resolvedModel(): string {
    if (perplexityModel === CUSTOM_MODEL) {
      return customModel.trim() || "sonar";
    }
    return perplexityModel;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const payload: VeilleConfigUpdateInput = {
        enabled,
        interval_minutes: resolvedMinutes(),
        quiet_start: quietStart !== "" ? parseInt(quietStart, 10) : null,
        quiet_end: quietEnd !== "" ? parseInt(quietEnd, 10) : null,
        timezone,
        perplexity_model: resolvedModel(),
        search_prompt: searchPrompt.trim() === "" ? null : searchPrompt,
      };
      const updated = await api.updateVeilleConfig(payload);
      setConfig(updated);
      applyConfig(updated);
      setSaved(true);
    } catch (e: unknown) {
      setSaveError(
        e instanceof Error ? e.message : "Erreur lors de la sauvegarde.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      const result = await api.runVeille();
      setRunResult({ count: result.count });
      // Refresh config to update last_run_at / last_count / next_run_at
      const updated = await api.getVeilleConfig().catch(() => null);
      if (updated) {
        setConfig(updated);
        applyConfig(updated);
      }
    } catch (e: unknown) {
      setRunError(
        e instanceof Error ? e.message : "Erreur lors du lancement de la veille.",
      );
    } finally {
      setRunning(false);
    }
  }

  /* -------- Render states -------- */

  if (loadingData) {
    return (
      <Panel bare className="flex items-center justify-center py-8">
        <Spinner size={20} />
        <span className="ml-3 text-[12px] text-text3">Chargement…</span>
      </Panel>
    );
  }

  if (loadError && !config) {
    return (
      <Panel bare className="px-3.5 py-4">
        <InlineError message={loadError} />
      </Panel>
    );
  }

  const lastStatusInfo = statusTone(config?.last_status);

  return (
    <Panel bare>
      <PanelHead title="Veille appels d'offres" />

      {/* ---- Execution readout strip ---- */}
      <div className="grid grid-cols-1 divide-y divide-line-soft sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <ReadRow
          label="Derniere execution"
          value={fmtDate(config?.last_run_at)}
        />
        <ReadRow
          label="Prochaine execution"
          value={fmtDate(config?.next_run_at)}
          valueClass={config?.enabled ? "text-amber-2" : "text-text3"}
        />
        <div className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-b-0">
          <span className="w-[148px] flex-none text-[11px] text-text3 sm:w-auto">
            Derniere statut
          </span>
          <div className="flex items-center gap-3 ml-auto sm:ml-0">
            <span className={cn("mono text-[11.5px]", lastStatusInfo.cls)}>
              {lastStatusInfo.label}
            </span>
            {config?.last_count != null && (
              <span className="disp rounded-[5px] border border-line bg-bg-3 px-[7px] py-[2px] text-[10.5px] font-semibold text-text2">
                {config.last_count} offre{config.last_count !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ---- Error on last run ---- */}
      {config?.last_error && (
        <div className="border-t border-line-soft px-3.5 py-2.5">
          <div className="flex items-start gap-2 text-[11.5px] text-stop">
            <AlertTriangle size={13} strokeWidth={2.2} className="mt-[1px] flex-none" aria-hidden />
            <span className="mono">{config.last_error}</span>
          </div>
        </div>
      )}

      {/* ---- Settings form ---- */}
      <form onSubmit={(e) => void handleSave(e)}>
        <div className="border-t border-line-soft">

          {/* Toggle activer */}
          <FieldRow label="Veille automatique" htmlFor={toggleId}>
            <div className="flex items-center gap-3 pt-0.5">
              <Toggle
                id={toggleId}
                checked={enabled}
                onChange={(v) => {
                  setEnabled(v);
                  setSaved(false);
                }}
              />
              <span className="text-[12px] text-text2">
                {enabled ? "Activee" : "Desactivee"}
              </span>
            </div>
          </FieldRow>

          {/* Frequence */}
          <FieldRow label="Frequence" htmlFor={freqId}>
            <select
              id={freqId}
              value={preset}
              onChange={(e) => {
                const v = Number(e.target.value);
                setPreset(v);
                if (v !== CUSTOM_VALUE) {
                  setCustomMinutes(String(v));
                }
                setSaved(false);
              }}
              className={fieldCls}
            >
              {FREQUENCY_OPTIONS.map((o) => (
                <option key={o.minutes} value={o.minutes}>
                  {o.label}
                </option>
              ))}
              <option value={CUSTOM_VALUE}>Personnalise…</option>
            </select>

            {/* Custom minutes field — shown only when preset is custom */}
            {preset === CUSTOM_VALUE && (
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  id={customId}
                  type="number"
                  min={1}
                  step={1}
                  value={customMinutes}
                  onChange={(e) => {
                    setCustomMinutes(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="ex. 90"
                  className={cn(fieldCls, "w-24")}
                  aria-label="Intervalle en minutes"
                />
                <span className="text-[12px] text-text3">minutes</span>
              </div>
            )}
          </FieldRow>

          {/* Quiet hours */}
          <FieldRow label="Silence (heures)">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <label htmlFor={quietStartId} className="text-[11.5px] text-text3 whitespace-nowrap">
                  De
                </label>
                <input
                  id={quietStartId}
                  type="number"
                  min={0}
                  max={23}
                  step={1}
                  value={quietStart}
                  onChange={(e) => {
                    setQuietStart(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="22"
                  className={cn(fieldCls, "w-16")}
                  aria-label="Heure de debut silence"
                />
                <span className="text-[11.5px] text-text3">h</span>
              </div>
              <div className="flex items-center gap-1.5">
                <label htmlFor={quietEndId} className="text-[11.5px] text-text3 whitespace-nowrap">
                  a
                </label>
                <input
                  id={quietEndId}
                  type="number"
                  min={0}
                  max={23}
                  step={1}
                  value={quietEnd}
                  onChange={(e) => {
                    setQuietEnd(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="7"
                  className={cn(fieldCls, "w-16")}
                  aria-label="Heure de fin silence"
                />
                <span className="text-[11.5px] text-text3">h</span>
              </div>
              {(quietStart || quietEnd) && (
                <button
                  type="button"
                  onClick={() => {
                    setQuietStart("");
                    setQuietEnd("");
                    setSaved(false);
                  }}
                  className="text-[11px] text-text3 underline underline-offset-2 hover:text-text2"
                >
                  Effacer
                </button>
              )}
            </div>
            <p className="text-[10.5px] text-text3 mt-0.5">
              La veille ne se lancera pas dans cette plage horaire.
            </p>
          </FieldRow>

          {/* Fuseau horaire (interprétation des heures de silence) */}
          <FieldRow label="Fuseau horaire" htmlFor={tzId}>
            <select
              id={tzId}
              value={timezone}
              onChange={(e) => {
                setTimezone(e.target.value);
                setSaved(false);
              }}
              className={fieldCls}
            >
              {TIMEZONE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="text-[10.5px] text-text3 mt-0.5">
              Les heures de silence sont interpretees dans ce fuseau.
            </p>
          </FieldRow>

          {/* Modele Perplexity */}
          <FieldRow label="Modele Perplexity" htmlFor={modelId}>
            <select
              id={modelId}
              value={perplexityModel}
              onChange={(e) => {
                setPerplexityModel(e.target.value);
                setSaved(false);
              }}
              className={fieldCls}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value={CUSTOM_MODEL}>Personnalise…</option>
            </select>
            {perplexityModel === CUSTOM_MODEL && (
              <input
                id={customModelId}
                type="text"
                value={customModel}
                onChange={(e) => {
                  setCustomModel(e.target.value);
                  setSaved(false);
                }}
                placeholder="ex. sonar-deep-research"
                className={cn(fieldCls, "mt-1.5")}
                aria-label="Modele Perplexity personnalise"
              />
            )}
            <p className="text-[10.5px] text-text3 mt-0.5">
              sonar = economique · sonar-pro = meilleure qualite (plus cher).
            </p>
          </FieldRow>

          {/* Prompt de recherche personnalise */}
          <FieldRow label="Prompt de recherche" htmlFor={promptId}>
            <textarea
              id={promptId}
              value={searchPrompt}
              onChange={(e) => {
                setSearchPrompt(e.target.value);
                setSaved(false);
              }}
              rows={5}
              placeholder="Laisser vide pour le prompt par defaut. Variables : {keywords}, {regions}, {limit}."
              className={cn(fieldCls, "mono resize-y leading-relaxed")}
            />
            <p className="text-[10.5px] text-text3 mt-0.5">
              Vide = prompt par defaut. Variables substituees : {"{keywords}"}, {"{regions}"}, {"{limit}"}.
            </p>
          </FieldRow>
        </div>

        {/* ---- Run-now feedback ---- */}
        {(runError || runResult) && (
          <div className="border-t border-line-soft px-3.5 py-2.5">
            {runError && <InlineError message={runError} />}
            {runResult && !runError && (
              <span className="flex items-center gap-1.5 text-[12px] text-ok">
                <Check size={13} strokeWidth={2.5} aria-hidden />
                Cycle termine —{" "}
                {runResult.count > 0
                  ? `${runResult.count} nouvelle${runResult.count !== 1 ? "s" : ""} offre${runResult.count !== 1 ? "s" : ""} trouvee${runResult.count !== 1 ? "s" : ""}.`
                  : "aucune nouvelle offre."}
              </span>
            )}
          </div>
        )}

        {/* ---- Footer: save feedback + actions ---- */}
        <div className="flex flex-wrap items-center gap-3 border-t border-line-soft px-3.5 py-3">
          {saveError && (
            <span className="flex items-center gap-1.5 text-[12px] text-stop">
              <AlertTriangle size={13} strokeWidth={2.2} aria-hidden />
              {saveError}
            </span>
          )}
          {saved && !saveError && (
            <span className="flex items-center gap-1.5 text-[12px] text-ok">
              <Check size={13} strokeWidth={2.5} aria-hidden />
              Configuration sauvegardee
            </span>
          )}

          {/* Run-now button */}
          <button
            type="button"
            disabled={running || saving}
            onClick={() => void handleRunNow()}
            className="disp flex items-center gap-2 rounded-[8px] border border-line bg-bg-2 px-3.5 py-2 text-[12px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:border-amber-line hover:text-text disabled:opacity-50"
          >
            {running ? (
              <Spinner size={14} />
            ) : (
              <Play size={13} strokeWidth={2.2} aria-hidden />
            )}
            Lancer maintenant
          </button>

          {/* Save button */}
          <button
            type="submit"
            disabled={saving || running}
            className="disp ml-auto flex items-center gap-2 rounded-[8px] border border-amber-line bg-amber-bg px-3.5 py-2 text-[12px] font-semibold tracking-[0.04em] text-amber-2 transition-colors hover:bg-amber-line disabled:opacity-50"
          >
            {saving ? (
              <Spinner size={14} />
            ) : (
              <Save size={14} strokeWidth={2.2} aria-hidden />
            )}
            Enregistrer
          </button>
        </div>
      </form>
    </Panel>
  );
}
