"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Globe,
  Inbox,
  KeyRound,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type { MonitoredSource, MonitoredSourceInput, SourcesStatus } from "@/lib/types";
import { BTP_SECTORS } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Spinner } from "@/components/ui/Spinner";

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

/** DOM/DROM regions available for filter selection. */
const DOM_REGIONS = [
  "Guadeloupe",
  "Martinique",
  "Guyane",
  "La Réunion",
  "Mayotte",
];

/** Interval presets (minutes). */
const INTERVAL_PRESETS: { value: number; label: string }[] = [
  { value: 60,   label: "1 h" },
  { value: 120,  label: "2 h" },
  { value: 360,  label: "6 h" },
  { value: 720,  label: "12 h" },
  { value: 1440, label: "24 h" },
  { value: 10080,label: "7 j" },
];

const PROVIDERS_ALL = ["anthropic", "openai", "google", "deepseek", "perplexity"] as const;
void PROVIDERS_ALL; // referenced only for type exhaustiveness

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function intervalLabel(minutes: number): string {
  const preset = INTERVAL_PRESETS.find((p) => p.value === minutes);
  if (preset) return preset.label;
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} j`;
}

function sectorLabel(slug: string): string {
  return BTP_SECTORS.find((s) => s.slug === slug)?.label ?? slug;
}

/** Build a "hint" for displaying the URL host only. */
function urlHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------ */
/* empty form factory                                                  */
/* ------------------------------------------------------------------ */

interface SourceForm {
  label: string;
  url: string;
  login_email: string;
  login_password: string;
  region_filters: string[];
  sector_filters: string[];
  extract_interval_minutes: number;
  enabled: boolean;
}

function emptyForm(): SourceForm {
  return {
    label: "",
    url: "",
    login_email: "",
    login_password: "",
    region_filters: [],
    sector_filters: [],
    extract_interval_minutes: 360,
    enabled: true,
  };
}

function sourceToForm(src: MonitoredSource): SourceForm {
  return {
    label: src.label,
    url: src.url,
    login_email: src.login_email ?? "",
    login_password: "", // WRITE-ONLY: never pre-fill
    region_filters: src.region_filters ?? [],
    sector_filters: src.sector_filters ?? [],
    extract_interval_minutes: src.extract_interval_minutes,
    enabled: src.enabled,
  };
}

function formToInput(form: SourceForm): MonitoredSourceInput {
  const input: MonitoredSourceInput = {
    label: form.label.trim(),
    url: form.url.trim(),
    login_email: form.login_email.trim() || null,
    region_filters: form.region_filters.length > 0 ? form.region_filters : null,
    sector_filters: form.sector_filters.length > 0 ? form.sector_filters : null,
    extract_interval_minutes: form.extract_interval_minutes,
    enabled: form.enabled,
  };
  // Only send login_password if the user explicitly typed something
  if (form.login_password.trim()) {
    input.login_password = form.login_password;
  }
  return input;
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function SourcesPage() {
  const [sources, setSources] = useState<MonitoredSource[] | null>(null);
  const [status, setStatus] = useState<SourcesStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modal state
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<MonitoredSource | null>(null);

  // Per-row action states: keyed by source id
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message?: string }>>({});
  const [extracting, setExtracting] = useState<Record<string, boolean>>({});
  const [extractResult, setExtractResult] = useState<Record<string, number>>({});
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});

  // Inline page error
  const [pageError, setPageError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [srcs, st] = await Promise.all([
      api.listSources(),
      api.getSourcesStatus(),
    ]);
    setSources(srcs);
    setStatus(st);
    setLoadError(null);
  }, []);

  useEffect(() => {
    let alive = true;
    load().catch((err: unknown) => {
      if (!alive) return;
      setLoadError(err instanceof Error ? err.message : "Chargement impossible.");
    });
    return () => {
      alive = false;
    };
  }, [load]);

  /* -- handlers -- */

  function openCreate() {
    setEditTarget(null);
    setModal("create");
  }

  function openEdit(src: MonitoredSource) {
    setEditTarget(src);
    setModal("edit");
  }

  function closeModal() {
    setModal(null);
    setEditTarget(null);
  }

  async function handleSaved(updated: MonitoredSource) {
    closeModal();
    // Refresh list
    try {
      setSources(await api.listSources());
    } catch {
      // non-blocking
    }
    void updated; // consumed by API call
  }

  async function handleDelete(src: MonitoredSource) {
    if (!window.confirm(`Supprimer la source "${src.label}" ?`)) return;
    setDeleting((prev) => ({ ...prev, [src.id]: true }));
    setPageError(null);
    try {
      await api.deleteSource(src.id);
      setSources((prev) => prev?.filter((s) => s.id !== src.id) ?? prev);
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setDeleting((prev) => ({ ...prev, [src.id]: false }));
    }
  }

  async function handleTest(src: MonitoredSource) {
    setTesting((prev) => ({ ...prev, [src.id]: true }));
    setTestResult((prev) => {
      const next = { ...prev };
      delete next[src.id];
      return next;
    });
    try {
      const res = await api.testSource(src.id);
      setTestResult((prev) => ({ ...prev, [src.id]: res }));
    } catch (err: unknown) {
      setTestResult((prev) => ({
        ...prev,
        [src.id]: { ok: false, message: err instanceof Error ? err.message : "Erreur inconnue." },
      }));
    } finally {
      setTesting((prev) => ({ ...prev, [src.id]: false }));
    }
  }

  async function handleExtract(src: MonitoredSource) {
    setExtracting((prev) => ({ ...prev, [src.id]: true }));
    setExtractResult((prev) => {
      const next = { ...prev };
      delete next[src.id];
      return next;
    });
    try {
      const res = await api.extractSource(src.id);
      setExtractResult((prev) => ({ ...prev, [src.id]: res.count }));
      // Refresh source to get updated last_extract_at / last_status
      const refreshed = await api.getSource(src.id);
      setSources((prev) =>
        prev ? prev.map((s) => (s.id === refreshed.id ? refreshed : s)) : prev,
      );
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Extraction impossible.");
    } finally {
      setExtracting((prev) => ({ ...prev, [src.id]: false }));
    }
  }

  /* -- render -- */

  return (
    <div className="flex flex-col gap-5 px-[22px] py-[18px]">
      {/* Header */}
      <header className="oc-fade flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Link
              href="/tenders"
              className="flex items-center gap-1 text-[11.5px] text-text3 transition-colors hover:text-amber-2"
            >
              <ChevronLeft size={13} strokeWidth={2.2} aria-hidden />
              Appels d&apos;offres
            </Link>
          </div>
          <h1 className="disp text-[19px] font-semibold tracking-[0.01em]">
            Sources surveillées
          </h1>
          <p className="mt-1 text-[12.5px] text-text3">
            Portails et plateformes dont les appels d&apos;offres sont extraits automatiquement
            par browser-use lors de la veille.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="disp flex h-[38px] flex-none items-center gap-2 rounded-[9px] border border-amber-line bg-amber-bg px-4 text-[12.5px] font-semibold tracking-[0.03em] text-amber-2 transition-colors hover:opacity-80"
        >
          <Plus size={15} strokeWidth={2.2} aria-hidden />
          Ajouter une source
        </button>
      </header>

      {/* Browser-use status banner */}
      {status && <BrowserUseBanner status={status} />}

      {/* Page-level error */}
      {pageError && (
        <InlineError message={pageError} onDismiss={() => setPageError(null)} />
      )}

      {/* Main content */}
      {loadError && !sources ? (
        <ErrorState
          message={loadError}
          onRetry={() => {
            setLoadError(null);
            setSources(null);
            load().catch((err: unknown) =>
              setLoadError(err instanceof Error ? err.message : "Chargement impossible."),
            );
          }}
        />
      ) : !sources ? (
        <LoadingState />
      ) : sources.length === 0 ? (
        <EmptyState onAdd={openCreate} />
      ) : (
        <section className="oc-fade flex flex-col gap-3" style={{ animationDelay: "0.06s" }}>
          <SectionHeader
            title="Portails configurés"
            count={sources.length}
            icon={
              <Globe size={16} strokeWidth={2} className="text-text2" aria-hidden />
            }
          />
          <Panel bare>
            {sources.map((src, i) => (
              <SourceRow
                key={src.id}
                source={src}
                isLast={i === sources.length - 1}
                testing={!!testing[src.id]}
                testResult={testResult[src.id]}
                extracting={!!extracting[src.id]}
                extractCount={extractResult[src.id]}
                deleting={!!deleting[src.id]}
                onEdit={() => openEdit(src)}
                onDelete={() => void handleDelete(src)}
                onTest={() => void handleTest(src)}
                onExtract={() => void handleExtract(src)}
              />
            ))}
          </Panel>
        </section>
      )}

      {/* Create / Edit modal */}
      {modal && (
        <SourceModal
          mode={modal}
          initial={modal === "edit" && editTarget ? editTarget : null}
          onClose={closeModal}
          onSaved={(updated) => void handleSaved(updated)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* browser-use status banner                                           */
/* ------------------------------------------------------------------ */

function BrowserUseBanner({ status }: { status: SourcesStatus }) {
  if (status.browser_use_available && status.enabled) {
    return (
      <div className="oc-fade flex items-start gap-2.5 rounded-[9px] border border-ok-bg bg-ok-bg px-3.5 py-2.5 text-[12.5px] text-ok">
        <Check size={15} strokeWidth={2.2} className="mt-px flex-none" aria-hidden />
        <span>
          Browser-use <strong>actif</strong> — les sources seront extraites automatiquement lors
          de la prochaine veille.
        </span>
      </div>
    );
  }

  const reason = !status.enabled
    ? "BROWSER_USE_ENABLED=false dans la configuration backend."
    : "Le module browser-use n'est pas installé sur le backend.";

  return (
    <div className="oc-fade flex items-start gap-2.5 rounded-[9px] border border-amber-line bg-amber-bg px-3.5 py-2.5 text-[12.5px] text-amber-2">
      <TriangleAlert size={15} strokeWidth={2.2} className="mt-px flex-none" aria-hidden />
      <span className="flex-1">
        <strong>Browser-use inactif</strong> — les sources sont enregistrées mais
        l&apos;extraction automatique est désactivée.{" "}
        <span className="mono text-[11px] opacity-80">{reason}</span>
        <span className="mt-1 block text-[11px] opacity-80">
          Pour activer : installer <code className="rounded bg-amber-line/20 px-1">browser-use</code> et{" "}
          <code className="rounded bg-amber-line/20 px-1">playwright chromium</code>, puis
          définir <code className="rounded bg-amber-line/20 px-1">BROWSER_USE_ENABLED=true</code>.
        </span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* source row                                                          */
/* ------------------------------------------------------------------ */

function SourceRow({
  source,
  isLast,
  testing,
  testResult,
  extracting,
  extractCount,
  deleting,
  onEdit,
  onDelete,
  onTest,
  onExtract,
}: {
  source: MonitoredSource;
  isLast: boolean;
  testing: boolean;
  testResult?: { ok: boolean; message?: string };
  extracting: boolean;
  extractCount?: number;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onExtract: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("flex flex-col", !isLast && "border-b border-line-soft")}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-3.5 py-3">
        {/* Status dot */}
        <span
          className={cn(
            "h-2 w-2 flex-none rounded-full",
            source.enabled ? "bg-ok" : "bg-text3",
          )}
          title={source.enabled ? "Activée" : "Désactivée"}
          aria-hidden
        />

        {/* Icon */}
        <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[8px] bg-bg-3 text-text2">
          <Globe size={17} strokeWidth={2} aria-hidden />
        </span>

        {/* Label + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-text">
              {source.label}
            </span>
            {!source.enabled && (
              <span className="disp rounded-[4px] border border-line bg-bg-3 px-[6px] py-px text-[9px] font-semibold uppercase tracking-[0.1em] text-text3">
                Désactivée
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text3">
            <a
              href={/^https?:\/\//i.test(source.url) ? source.url : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="mono flex items-center gap-1 transition-colors hover:text-amber-2"
              onClick={(e) => !(/^https?:\/\//i.test(source.url)) && e.preventDefault()}
            >
              {urlHost(source.url)}
              <ExternalLink size={9} strokeWidth={2} aria-hidden />
            </a>
            {source.login_email && (
              <>
                <span className="h-[3px] w-[3px] rounded-full bg-text3" aria-hidden />
                <span className="flex items-center gap-1">
                  <Mail size={10} strokeWidth={2} aria-hidden />
                  {source.login_email}
                </span>
              </>
            )}
            {source.has_password && (
              <>
                <span className="h-[3px] w-[3px] rounded-full bg-text3" aria-hidden />
                <span className="flex items-center gap-1">
                  <KeyRound size={10} strokeWidth={2} aria-hidden />
                  Mot de passe enregistré
                </span>
              </>
            )}
            <span className="h-[3px] w-[3px] rounded-full bg-text3" aria-hidden />
            <span className="flex items-center gap-1">
              <Clock size={10} strokeWidth={2} aria-hidden />
              {intervalLabel(source.extract_interval_minutes)}
            </span>
          </div>
        </div>

        {/* Last status chip */}
        {source.last_status && (
          <LastStatusChip status={source.last_status} count={source.last_count} />
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {/* Expand for detail */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Réduire" : "Détails"}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-line-soft bg-bg-2 text-text3 transition-colors hover:border-amber-line hover:text-text"
          >
            {expanded ? (
              <ChevronRight size={13} strokeWidth={2.2} className="rotate-90" aria-hidden />
            ) : (
              <ChevronRight size={13} strokeWidth={2.2} aria-hidden />
            )}
          </button>

          <RowButton
            icon={Pencil}
            label="Modifier"
            onClick={onEdit}
          />
          <RowButton
            icon={PlayCircle}
            label={extracting ? "Extraction…" : "Extraire"}
            loading={extracting}
            onClick={onExtract}
            tone="amber"
          />
          <RowButton
            icon={deleting ? undefined : Trash2}
            label={deleting ? "Suppression…" : "Supprimer"}
            loading={deleting}
            onClick={onDelete}
            tone="stop"
          />
        </div>
      </div>

      {/* Expanded detail row */}
      {expanded && (
        <div className="border-t border-line-soft bg-bg-2 px-3.5 py-3">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {/* Filters */}
            {source.region_filters && source.region_filters.length > 0 && (
              <div>
                <span className="micro mb-1 block">Régions</span>
                <div className="flex flex-wrap gap-1">
                  {source.region_filters.map((r) => (
                    <FilterBadge key={r} icon={MapPin} label={r} />
                  ))}
                </div>
              </div>
            )}
            {source.sector_filters && source.sector_filters.length > 0 && (
              <div>
                <span className="micro mb-1 block">Secteurs</span>
                <div className="flex flex-wrap gap-1">
                  {source.sector_filters.map((s) => (
                    <FilterBadge key={s} icon={Tag} label={sectorLabel(s)} />
                  ))}
                </div>
              </div>
            )}
            {/* Last extract info */}
            <div>
              <span className="micro mb-1 block">Dernière extraction</span>
              <span className="mono text-[11.5px] text-text2">{fmtDate(source.last_extract_at)}</span>
            </div>
            {source.last_count !== null && source.last_count !== undefined && (
              <div>
                <span className="micro mb-1 block">Offres collectées</span>
                <span className="mono text-[11.5px] text-text2">{source.last_count}</span>
              </div>
            )}
            {source.last_error && (
              <div className="w-full">
                <span className="micro mb-1 block text-stop">Dernière erreur</span>
                <span className="mono text-[11px] text-stop">{source.last_error}</span>
              </div>
            )}
          </div>

          {/* Test button + result */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
            <RowButton
              icon={testing ? undefined : RefreshCw}
              label={testing ? "Test en cours…" : "Tester la connexion"}
              loading={testing}
              onClick={onTest}
            />
            {testResult && (
              <span
                className={cn(
                  "flex items-center gap-1.5 text-[12px]",
                  testResult.ok ? "text-ok" : "text-stop",
                )}
              >
                {testResult.ok ? (
                  <Check size={13} strokeWidth={2.5} aria-hidden />
                ) : (
                  <XCircle size={13} strokeWidth={2.2} aria-hidden />
                )}
                {testResult.ok
                  ? "Connexion réussie"
                  : (testResult.message ?? "Connexion échouée")}
              </span>
            )}
            {extractCount !== undefined && (
              <span className="flex items-center gap-1.5 text-[12px] text-ok">
                <Check size={13} strokeWidth={2.5} aria-hidden />
                {extractCount} offre{extractCount > 1 ? "s" : ""} extraite{extractCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* row button                                                          */
/* ------------------------------------------------------------------ */

function RowButton({
  icon: Icon,
  label,
  loading = false,
  disabled = false,
  tone = "neutral",
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  tone?: "amber" | "neutral" | "stop";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={label}
      aria-label={label}
      className={cn(
        "disp flex h-[30px] items-center gap-1.5 rounded-[7px] border px-2.5 text-[11.5px] font-semibold transition-colors disabled:opacity-50",
        tone === "amber" &&
          "border-amber-line bg-amber-bg text-amber-2 hover:opacity-80",
        tone === "stop" &&
          "border-stop-bg bg-stop-bg text-stop hover:opacity-80",
        tone === "neutral" &&
          "border-line-soft bg-bg-2 text-text2 hover:border-amber-line hover:text-text",
      )}
    >
      {loading ? (
        <Loader2 size={12} strokeWidth={2.2} className="animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon size={12} strokeWidth={2.2} aria-hidden />
      ) : null}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* last status chip                                                    */
/* ------------------------------------------------------------------ */

function LastStatusChip({
  status,
  count,
}: {
  status: string;
  count?: number | null;
}) {
  const isOk = status === "ok" || status === "success";
  const isError = status === "error" || status === "failed";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-medium",
        isOk && "bg-ok-bg text-ok",
        isError && "bg-stop-bg text-stop",
        !isOk && !isError && "bg-bg-3 text-text3",
      )}
    >
      <span
        className={cn(
          "h-[6px] w-[6px] rounded-full",
          isOk && "bg-ok",
          isError && "bg-stop",
          !isOk && !isError && "bg-text3",
        )}
        aria-hidden
      />
      {isOk ? `OK${count !== null && count !== undefined ? ` · ${count}` : ""}` : status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* filter badge                                                        */
/* ------------------------------------------------------------------ */

function FilterBadge({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="flex items-center gap-1 rounded-full border border-line-soft bg-bg-3 px-2 py-px text-[10.5px] text-text2">
      <Icon size={9} strokeWidth={2} aria-hidden />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* create / edit modal                                                 */
/* ------------------------------------------------------------------ */

function SourceModal({
  mode,
  initial,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  initial: MonitoredSource | null;
  onClose: () => void;
  onSaved: (src: MonitoredSource) => void;
}) {
  const [form, setForm] = useState<SourceForm>(
    initial ? sourceToForm(initial) : emptyForm(),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  function patch<K extends keyof SourceForm>(key: K, value: SourceForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleList<T extends string>(
    key: "region_filters" | "sector_filters",
    value: T,
  ) {
    setForm((prev) => {
      const list = prev[key] as T[];
      return {
        ...prev,
        [key]: list.includes(value)
          ? list.filter((v) => v !== value)
          : [...list, value],
      };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) {
      setErr("Le libellé est obligatoire.");
      return;
    }
    if (!form.url.trim()) {
      setErr("L'URL est obligatoire.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const input = formToInput(form);
      let saved: MonitoredSource;
      if (mode === "create") {
        saved = await api.createSource(input);
      } else {
        if (!initial) throw new Error("Source introuvable.");
        saved = await api.updateSource(initial.id, input);
      }
      onSaved(saved);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erreur lors de la sauvegarde.");
    } finally {
      setSaving(false);
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[13px] border border-line bg-panel shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center gap-3 border-b border-line-soft px-5 py-4">
          <Globe size={16} strokeWidth={2} className="flex-none text-amber-2" aria-hidden />
          <span className="disp flex-1 text-[13px] font-semibold text-text">
            {mode === "create" ? "Ajouter une source" : `Modifier — ${initial?.label}`}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex-none rounded-[6px] p-1 text-text3 transition-colors hover:bg-bg-3 hover:text-text"
          >
            <XCircle size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>

        {/* Scrollable body */}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex flex-1 flex-col overflow-y-auto"
        >
          <div className="flex flex-col gap-0 divide-y divide-line-soft px-5 py-1">
            {/* Label */}
            <ModalField label="Libellé" required>
              <input
                ref={firstRef}
                type="text"
                value={form.label}
                onChange={(e) => patch("label", e.target.value)}
                placeholder="Ex. : BOAMP Guadeloupe"
                className={fieldCls}
                required
              />
            </ModalField>

            {/* URL */}
            <ModalField label="URL du portail" required>
              <input
                type="url"
                value={form.url}
                onChange={(e) => patch("url", e.target.value)}
                placeholder="https://www.example.fr/appels-offres"
                className={fieldCls}
                required
              />
            </ModalField>

            {/* Login email */}
            <ModalField label="E-mail de connexion">
              <input
                type="email"
                value={form.login_email}
                onChange={(e) => patch("login_email", e.target.value)}
                placeholder="utilisateur@portail.fr"
                className={fieldCls}
              />
            </ModalField>

            {/* Login password — WRITE-ONLY */}
            <ModalField
              label={
                mode === "edit" && initial?.has_password
                  ? "Nouveau mot de passe (laisser vide = conserver)"
                  : "Mot de passe de connexion"
              }
            >
              <input
                type="password"
                value={form.login_password}
                onChange={(e) => patch("login_password", e.target.value)}
                placeholder={
                  mode === "edit" && initial?.has_password
                    ? "••••••••  (laissez vide pour conserver)"
                    : "Mot de passe"
                }
                autoComplete="new-password"
                className={fieldCls}
              />
              <p className="mt-1 text-[10.5px] text-text3">
                Chiffré au repos — jamais renvoyé par le serveur.
              </p>
            </ModalField>

            {/* Interval */}
            <ModalField label="Intervalle d'extraction">
              <div className="flex flex-wrap gap-1.5">
                {INTERVAL_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => patch("extract_interval_minutes", p.value)}
                    className={cn(
                      "disp rounded-full border px-3 py-1 text-[11.5px] transition-colors",
                      form.extract_interval_minutes === p.value
                        ? "border-amber-line bg-amber-bg text-amber-2"
                        : "border-line-soft bg-bg-2 text-text2 hover:border-amber-line",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </ModalField>

            {/* Region filters */}
            <ModalField label="Filtres régions (optionnel)">
              <div className="flex flex-wrap gap-1.5">
                {DOM_REGIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleList("region_filters", r)}
                    className={cn(
                      "disp flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                      form.region_filters.includes(r)
                        ? "border-amber-line bg-amber-bg text-amber-2"
                        : "border-line-soft bg-bg-2 text-text2 hover:border-amber-line",
                    )}
                  >
                    <MapPin size={10} strokeWidth={2} aria-hidden />
                    {r}
                  </button>
                ))}
              </div>
              {form.region_filters.length === 0 && (
                <p className="mt-1 text-[10.5px] text-text3">
                  Aucun filtre = toutes les régions.
                </p>
              )}
            </ModalField>

            {/* Sector filters */}
            <ModalField label="Filtres secteurs (optionnel)">
              <div className="flex flex-wrap gap-1.5">
                {BTP_SECTORS.map((s) => (
                  <button
                    key={s.slug}
                    type="button"
                    onClick={() => toggleList("sector_filters", s.slug)}
                    className={cn(
                      "disp flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                      form.sector_filters.includes(s.slug)
                        ? "border-amber-line bg-amber-bg text-amber-2"
                        : "border-line-soft bg-bg-2 text-text2 hover:border-amber-line",
                    )}
                  >
                    <Tag size={10} strokeWidth={2} aria-hidden />
                    {s.label}
                  </button>
                ))}
              </div>
              {form.sector_filters.length === 0 && (
                <p className="mt-1 text-[10.5px] text-text3">
                  Aucun filtre = tous les secteurs.
                </p>
              )}
            </ModalField>

            {/* Enabled toggle */}
            <ModalField label="Activation">
              <button
                type="button"
                role="switch"
                aria-checked={form.enabled}
                onClick={() => patch("enabled", !form.enabled)}
                className="flex items-center gap-2.5 text-[12.5px] text-text2"
              >
                <ToggleSwitch on={form.enabled} />
                {form.enabled ? "Source active" : "Source désactivée"}
              </button>
            </ModalField>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3 border-t border-line-soft px-5 py-3.5">
            {err && (
              <span className="flex items-center gap-1.5 text-[12px] text-stop">
                <AlertTriangle size={13} strokeWidth={2.2} aria-hidden />
                {err}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="disp flex h-[34px] items-center gap-1.5 rounded-[8px] border border-line-soft bg-bg-2 px-3.5 text-[12px] font-semibold text-text2 transition-colors hover:border-amber-line hover:text-text"
              >
                <ArrowLeft size={13} strokeWidth={2.2} aria-hidden />
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving}
                className="disp flex h-[34px] items-center gap-1.5 rounded-[8px] border border-amber-line bg-amber-bg px-3.5 text-[12px] font-semibold text-amber-2 transition-colors hover:opacity-80 disabled:opacity-60"
              >
                {saving ? (
                  <Spinner size={12} />
                ) : (
                  <Check size={13} strokeWidth={2.5} aria-hidden />
                )}
                {saving
                  ? "Enregistrement…"
                  : mode === "create"
                  ? "Créer la source"
                  : "Enregistrer"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* modal field wrapper                                                 */
/* ------------------------------------------------------------------ */

const fieldCls =
  "w-full rounded-[6px] border border-line bg-bg-2 px-2.5 py-1.5 text-[12.5px] text-text placeholder:text-text3 focus:border-amber-line focus:outline-none";

function ModalField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="py-3">
      <label className="mb-1.5 block text-[11px] font-medium text-text2">
        {label}
        {required && <span className="ml-0.5 text-amber-2">*</span>}
      </label>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* toggle switch                                                       */
/* ------------------------------------------------------------------ */

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "relative h-[18px] w-[32px] flex-none rounded-[10px] transition-colors",
        on ? "bg-ok" : "bg-bg-3 border border-line",
      )}
      aria-hidden
    >
      <span
        className={cn(
          "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[var(--bg)] shadow-sm transition-all",
          on ? "left-[16px]" : "left-[2px]",
        )}
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* page states                                                         */
/* ------------------------------------------------------------------ */

function LoadingState() {
  return (
    <Panel className="grid place-items-center py-16">
      <div className="flex flex-col items-center gap-3 text-text3">
        <Spinner size={24} />
        <span className="disp text-[11px] font-semibold uppercase tracking-[0.1em]">
          Chargement des sources…
        </span>
      </div>
    </Panel>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Panel className="grid place-items-center py-16 text-center">
      <div className="flex max-w-[360px] flex-col items-center gap-3 text-text3">
        <Inbox size={26} strokeWidth={1.8} aria-hidden />
        <span className="text-[13px] font-medium text-text2">
          Aucune source configurée
        </span>
        <span className="text-[12px]">
          Ajoutez un portail de marchés publics pour que la veille l&apos;interroge
          automatiquement à chaque cycle.
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="disp mt-1 flex items-center gap-2 rounded-[8px] border border-amber-line bg-amber-bg px-3.5 py-2 text-[12px] font-semibold tracking-[0.04em] text-amber-2 transition-colors hover:opacity-80"
        >
          <Plus size={14} strokeWidth={2.2} aria-hidden />
          Ajouter une source
        </button>
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
    <Panel className="grid place-items-center py-16 text-center">
      <div className="flex max-w-[360px] flex-col items-center gap-3">
        <AlertTriangle size={26} strokeWidth={1.8} className="text-stop" aria-hidden />
        <span className="text-[13px] font-medium text-text2">
          Impossible de charger les sources
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

function InlineError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-[8px] border border-stop-bg bg-stop-bg px-3 py-2.5 text-[12px] text-stop">
      <AlertTriangle size={14} strokeWidth={2.2} className="mt-px flex-none" aria-hidden />
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fermer"
          className="flex-none opacity-60 hover:opacity-100"
        >
          <XCircle size={13} strokeWidth={2.2} aria-hidden />
        </button>
      )}
    </div>
  );
}
