"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  Calendar,
  ChevronRight,
  ExternalLink,
  Eye,
  FileText,
  Inbox,
  Layers,
  MapPin,
  PlayCircle,
  RefreshCw,
  Search,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type { TenderOffer, TenderStatus } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { Spinner } from "@/components/ui/Spinner";

/* ------------------------------------------------------------------ */
/* constants & helpers                                                 */
/* ------------------------------------------------------------------ */

/** Status filter tabs — order matches the natural lifecycle of an AO. */
const STATUS_TABS: { value: TenderStatus | null; label: string }[] = [
  { value: null, label: "Tous" },
  { value: "new", label: "Nouveaux" },
  { value: "seen", label: "Vus" },
  { value: "analyzing", label: "Analysés" },
  { value: "responded", label: "Répondus" },
  { value: "ignored", label: "Ignorés" },
];

/** Source label for display. */
const SOURCE_LABELS: Record<string, string> = {
  perplexity: "Perplexity",
  browser_use: "Browser Use",
  official: "Officiel",
  manual: "Manuel",
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** StatusChip-compatible status map for TenderStatus values. */
const TENDER_STATUS_LABELS: Record<string, string> = {
  new: "Nouveau",
  seen: "Vu",
  analyzing: "En analyse",
  responded: "Répondu",
  ignored: "Ignoré",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

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

/** Returns true when a deadline is within 7 days and in the future. */
function isDeadlineUrgent(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const diff = d.getTime() - Date.now();
  return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000;
}

/** Parse lots field into a displayable count. */
function lotsCount(lots: unknown): number | null {
  if (Array.isArray(lots)) return lots.length;
  return null;
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function TendersPage() {
  const [offers, setOffers] = useState<TenderOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TenderStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runningVeille, setRunningVeille] = useState(false);
  const [veilleResult, setVeilleResult] = useState<{
    count: number;
    new_ids: string[];
  } | null>(null);
  const [veilleError, setVeilleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await api.listTenders({ limit: 100 });
    return [...list].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, []);

  // Initial load.
  useEffect(() => {
    let alive = true;
    load()
      .then((next) => {
        if (!alive) return;
        setOffers(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(
          err instanceof Error ? err.message : "Chargement impossible.",
        );
      });
    return () => {
      alive = false;
    };
  }, [load]);

  // Derived filtered list.
  const filtered = useMemo(() => {
    if (!offers) return [];
    if (!statusFilter) return offers;
    return offers.filter((o) => o.status === statusFilter);
  }, [offers, statusFilter]);

  // Status counts for tab badges.
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of offers ?? []) {
      counts[o.status] = (counts[o.status] ?? 0) + 1;
    }
    return counts;
  }, [offers]);

  // Sync the selected offer from the filtered list (deselect if filtered out).
  useEffect(() => {
    if (selectedId && filtered.length > 0) {
      const still = filtered.find((o) => o.id === selectedId);
      if (!still) setSelectedId(null);
    }
  }, [filtered, selectedId]);

  async function handleRunVeille() {
    setRunningVeille(true);
    setVeilleResult(null);
    setVeilleError(null);
    try {
      const result = await api.runVeille();
      setVeilleResult(result);
      // Reload to surface newly discovered offers.
      const next = await load();
      setOffers(next);
    } catch (err: unknown) {
      setVeilleError(
        err instanceof Error ? err.message : "Erreur lors de la veille.",
      );
    } finally {
      setRunningVeille(false);
    }
  }

  async function handleMarkSeen(offer: TenderOffer) {
    if (offer.status !== "new") return;
    try {
      const updated = await api.updateTender(offer.id, { status: "seen" });
      setOffers((prev) =>
        prev ? prev.map((o) => (o.id === updated.id ? updated : o)) : prev,
      );
    } catch {
      // Non-blocking — a failed status update doesn't block the user.
    }
  }

  async function handleIgnore(offer: TenderOffer) {
    try {
      const updated = await api.updateTender(offer.id, { status: "ignored" });
      setOffers((prev) =>
        prev ? prev.map((o) => (o.id === updated.id ? updated : o)) : prev,
      );
      if (selectedId === offer.id) setSelectedId(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Impossible de mettre à jour l'offre.",
      );
    }
  }

  async function retry() {
    setError(null);
    setOffers(null);
    try {
      setOffers(await load());
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Chargement impossible.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-5 px-[22px] py-[18px]">
      {/* Page header */}
      <header className="oc-fade flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="disp text-[19px] font-semibold tracking-[0.01em]">
            Appels d'offres
          </h1>
          <p className="mt-1 text-[12.5px] text-text3">
            Veille automatique sur les marchés publics BTP dans les DOM. Les
            nouvelles offres sont détectées par Perplexity et analysées par IA.
          </p>
        </div>

        {/* Lancer la veille button */}
        <button
          type="button"
          onClick={handleRunVeille}
          disabled={runningVeille}
          className={cn(
            "disp flex h-[38px] flex-none items-center gap-2 rounded-[9px] border px-4 text-[12.5px] font-semibold tracking-[0.03em] transition-colors",
            runningVeille
              ? "border-amber-line bg-amber-bg text-amber-2 opacity-70"
              : "border-amber-line bg-amber-bg text-amber-2 hover:opacity-80",
          )}
        >
          {runningVeille ? (
            <Spinner size={14} />
          ) : (
            <PlayCircle size={15} strokeWidth={2} aria-hidden />
          )}
          {runningVeille ? "Veille en cours…" : "Lancer la veille"}
        </button>
      </header>

      {/* Veille result / error feedback */}
      {veilleResult && (
        <VeilleFeedback
          count={veilleResult.count}
          newIds={veilleResult.new_ids}
          onDismiss={() => setVeilleResult(null)}
        />
      )}
      {veilleError && (
        <InlineError
          message={veilleError}
          onDismiss={() => setVeilleError(null)}
        />
      )}

      {/* Stats strip */}
      {offers && offers.length > 0 && <TendersStrip offers={offers} />}

      {/* Main content */}
      {error && !offers ? (
        <ErrorState message={error} onRetry={retry} />
      ) : !offers ? (
        <LoadingState />
      ) : offers.length === 0 ? (
        <EmptyState onRunVeille={handleRunVeille} running={runningVeille} />
      ) : (
        <div className="oc-fade" style={{ animationDelay: "0.06s" }}>
          {error && (
            <InlineError
              className="mb-3"
              message={error}
              onDismiss={() => setError(null)}
            />
          )}

          {/* Status filter tabs */}
          <StatusFilterTabs
            counts={statusCounts}
            total={offers.length}
            active={statusFilter}
            onChange={setStatusFilter}
          />

          {/* Master / detail layout */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            {/* List */}
            <section>
              <SectionHeader
                title="Offres"
                count={filtered.length}
                icon={
                  <Search
                    size={16}
                    strokeWidth={2}
                    className="text-text2"
                    aria-hidden
                  />
                }
              />
              <Panel bare>
                {filtered.length === 0 ? (
                  <p className="px-4 py-10 text-center text-[12.5px] text-text3">
                    Aucune offre dans cette catégorie.
                  </p>
                ) : (
                  filtered.map((offer) => (
                    <TenderRow
                      key={offer.id}
                      offer={offer}
                      active={offer.id === selectedId}
                      onSelect={() => {
                        setSelectedId(offer.id);
                        void handleMarkSeen(offer);
                      }}
                    />
                  ))
                )}
              </Panel>
            </section>

            {/* Detail */}
            <section className="lg:sticky lg:top-[18px] lg:self-start">
              <SectionHeader
                title="Détail de l'offre"
                icon={
                  <FileText
                    size={16}
                    strokeWidth={2}
                    className="text-text2"
                    aria-hidden
                  />
                }
              />
              <TenderDetail
                key={selectedId ?? "none"}
                offer={
                  selectedId
                    ? (filtered.find((o) => o.id === selectedId) ?? null)
                    : null
                }
                onIgnore={handleIgnore}
                onOfferUpdated={(updated) => {
                  setOffers((prev) =>
                    prev
                      ? prev.map((o) => (o.id === updated.id ? updated : o))
                      : prev,
                  );
                }}
              />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* stats strip                                                         */
/* ------------------------------------------------------------------ */

function TendersStrip({ offers }: { offers: readonly TenderOffer[] }) {
  const total = offers.length;
  const nouveau = offers.filter((o) => o.status === "new").length;
  const analyzing = offers.filter((o) => o.status === "analyzing").length;
  const responded = offers.filter((o) => o.status === "responded").length;

  return (
    <section
      className="oc-fade flex items-stretch overflow-hidden rounded-[11px] border border-line bg-panel"
      style={{ animationDelay: "0.03s" }}
    >
      <StripCell label="Total" value={total} />
      <StripCell
        label="Nouveaux"
        value={nouveau}
        tone={nouveau > 0 ? "amber" : undefined}
      />
      <StripCell
        label="En analyse"
        value={analyzing}
        tone={analyzing > 0 ? "amber" : undefined}
      />
      <StripCell label="Répondus" value={responded} tone="ok" />
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
/* status filter tabs                                                  */
/* ------------------------------------------------------------------ */

function StatusFilterTabs({
  counts,
  total,
  active,
  onChange,
}: {
  counts: Record<string, number>;
  total: number;
  active: TenderStatus | null;
  onChange: (next: TenderStatus | null) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {STATUS_TABS.map(({ value, label }) => {
        const count = value === null ? total : (counts[value] ?? 0);
        return (
          <StatusTab
            key={value ?? "__all__"}
            label={label}
            count={count}
            on={active === value}
            onClick={() => onChange(value)}
          />
        );
      })}
    </div>
  );
}

function StatusTab({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-[6px] text-[12px] transition-colors",
        on
          ? "border-amber-line bg-amber-bg text-amber-2"
          : "border-line-soft bg-bg-2 text-text2 hover:border-amber-line hover:text-text",
      )}
    >
      {label}
      <span
        className={cn(
          "mono tnum rounded-[10px] px-[6px] py-px text-[10.5px]",
          on ? "bg-amber-bg text-amber-2" : "bg-bg-3 text-text3",
        )}
      >
        {count}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* list row                                                            */
/* ------------------------------------------------------------------ */

function TenderRow({
  offer,
  active,
  onSelect,
}: {
  offer: TenderOffer;
  active: boolean;
  onSelect: () => void;
}) {
  const lots = lotsCount(offer.lots);
  const urgent = isDeadlineUrgent(offer.deadline);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "relative flex w-full items-center gap-3 border-b border-line-soft px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-bg-2",
        active && "bg-amber-bg/40",
      )}
    >
      {active && (
        <span
          className="absolute inset-y-0 left-0 w-[2px] bg-amber"
          aria-hidden
        />
      )}

      {/* Icon tile */}
      <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[8px] bg-bg-3 text-text2">
        <Search size={17} strokeWidth={2} aria-hidden />
      </span>

      {/* Title + meta */}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-[13px] font-medium",
              active ? "text-amber-2" : "text-text",
            )}
          >
            {offer.title}
          </span>
          {offer.status === "new" && (
            <span className="inline-block h-[6px] w-[6px] flex-none rounded-full bg-amber" aria-hidden />
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-text3">
          {offer.region && (
            <>
              <span className="flex items-center gap-1 truncate">
                <MapPin size={10} strokeWidth={2} aria-hidden />
                {offer.region}
              </span>
              <span className="h-[3px] w-[3px] flex-none rounded-full bg-text3" aria-hidden />
            </>
          )}
          {offer.deadline && (
            <span
              className={cn(
                "mono flex-none tnum",
                urgent && "font-medium text-hot",
              )}
            >
              {fmtDate(offer.deadline)}
            </span>
          )}
          {lots !== null && (
            <>
              <span className="h-[3px] w-[3px] flex-none rounded-full bg-text3" aria-hidden />
              <span className="flex items-center gap-1">
                <Layers size={10} strokeWidth={2} aria-hidden />
                {lots} lot{lots > 1 ? "s" : ""}
              </span>
            </>
          )}
        </span>
      </span>

      <TenderStatusChip status={offer.status} />
      <ChevronRight
        size={16}
        strokeWidth={2.2}
        className="flex-none text-text3"
        aria-hidden
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* tender-specific status chip (extends StatusChip vocabulary)        */
/* ------------------------------------------------------------------ */

function TenderStatusChip({ status }: { status: string }) {
  // Map tender-specific statuses onto StatusChip tones via a fallback label.
  // For "new", "seen", "analyzing", "responded", "ignored" we render a custom
  // chip rather than the generic one, which doesn't know these values.
  const MAP: Record<
    string,
    {
      label: string;
      classes: string;
      icon?: LucideIcon;
    }
  > = {
    new: {
      label: "Nouveau",
      classes: "text-amber-2 bg-amber-bg",
      icon: undefined,
    },
    seen: {
      label: "Vu",
      classes: "text-text2 bg-bg-3",
      icon: Eye,
    },
    analyzing: {
      label: "En analyse",
      classes: "text-hot bg-hot-bg",
      icon: undefined,
    },
    responded: {
      label: "Répondu",
      classes: "text-ok bg-ok-bg",
      icon: undefined,
    },
    ignored: {
      label: "Ignoré",
      classes: "text-text3 bg-bg-3",
      icon: undefined,
    },
  };

  const def = MAP[status];
  if (!def) return <StatusChip status={status} className="flex-none" />;

  const Icon = def.icon;
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium",
        def.classes,
      )}
    >
      {status === "analyzing" && (
        <span
          className="inline-block h-[7px] w-[7px] rounded-full bg-hot"
          style={{ animation: "oc-blink 1.3s ease-in-out infinite" }}
          aria-hidden
        />
      )}
      {status === "new" && (
        <span
          className="inline-block h-[7px] w-[7px] rounded-full bg-amber"
          style={{ animation: "oc-blink 1.3s ease-in-out infinite" }}
          aria-hidden
        />
      )}
      {Icon && status !== "new" && status !== "analyzing" && (
        <Icon size={13} strokeWidth={2.2} aria-hidden />
      )}
      {def.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* detail panel                                                        */
/* ------------------------------------------------------------------ */

function TenderDetail({
  offer,
  onIgnore,
  onOfferUpdated,
}: {
  offer: TenderOffer | null;
  onIgnore: (offer: TenderOffer) => void;
  onOfferUpdated: (updated: TenderOffer) => void;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzedDocId, setAnalyzedDocId] = useState<string | null>(null);
  // Track if this panel's analyzed doc came from a fresh analyze call
  // vs an already-responded offer.
  const prevIdRef = useRef<string | null>(null);

  // Reset per-offer state when offer changes.
  useEffect(() => {
    if (offer?.id !== prevIdRef.current) {
      prevIdRef.current = offer?.id ?? null;
      setAnalyzeError(null);
      setAnalyzing(false);
      setAnalyzedDocId(offer?.document_id ?? null);
    }
  }, [offer]);

  async function handleAnalyze() {
    if (!offer) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const doc = await api.analyzeTender(offer.id);
      setAnalyzedDocId(doc.id);
      // The backend sets status="responded" and document_id on the offer.
      const refreshed = await api.getTender(offer.id);
      onOfferUpdated(refreshed);
    } catch (err: unknown) {
      setAnalyzeError(
        err instanceof Error ? err.message : "Erreur lors de l'analyse.",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  if (!offer) {
    return (
      <Panel className="grid place-items-center py-16 text-center">
        <div className="flex max-w-[300px] flex-col items-center gap-2 text-text3">
          <Search size={26} strokeWidth={1.8} aria-hidden />
          <span className="text-[13px] font-medium text-text2">
            Aucune offre sélectionnée
          </span>
          <span className="text-[12px]">
            Choisissez un appel d'offre dans la liste pour afficher son détail.
          </span>
        </div>
      </Panel>
    );
  }

  const lots = Array.isArray(offer.lots) ? offer.lots : null;
  const urgent = isDeadlineUrgent(offer.deadline);
  const docId = analyzedDocId ?? offer.document_id;
  const isIgnored = offer.status === "ignored";

  return (
    <Panel bare className="oc-fade">
      {/* Header band */}
      <div className="flex flex-wrap items-start gap-3 border-b border-line-soft px-4 py-3.5">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-[9px] bg-bg-3 text-text2">
          <Search size={20} strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="disp truncate text-[15px] font-semibold leading-tight text-text">
            {offer.title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text3">
            <span className="text-text2">{sourceLabel(offer.source)}</span>
            <span className="h-[3px] w-[3px] rounded-full bg-text3" aria-hidden />
            <span className="mono tnum">{fmtDateTime(offer.created_at)}</span>
          </div>
        </div>
        <TenderStatusChip status={offer.status} />
      </div>

      {/* Action toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5">
        {/* Analyser */}
        {!isIgnored && (
          <ActionButton
            icon={analyzing ? undefined : FileText}
            loading={analyzing}
            onClick={handleAnalyze}
            disabled={analyzing}
            tone="amber"
          >
            {analyzing ? "Analyse en cours…" : "Analyser par IA"}
          </ActionButton>
        )}

        {/* Lien vers le document d'analyse */}
        {docId && (
          <Link
            href="/documents"
            className="disp flex h-[34px] items-center gap-1.5 rounded-[8px] border border-ok-bg bg-ok-bg px-3 text-[12px] font-semibold text-ok transition-colors hover:opacity-80"
          >
            <FileText size={13} strokeWidth={2.2} aria-hidden />
            Voir l'analyse
          </Link>
        )}

        {/* Marquer vu */}
        {offer.status === "new" && (
          <ActionButton
            icon={Eye}
            onClick={async () => {
              const updated = await api.updateTender(offer.id, {
                status: "seen",
              });
              onOfferUpdated(updated);
            }}
            tone="neutral"
          >
            Marquer vu
          </ActionButton>
        )}

        {/* Ignorer */}
        {!isIgnored && (
          <ActionButton
            icon={XCircle}
            onClick={() => onIgnore(offer)}
            tone="neutral"
          >
            Ignorer
          </ActionButton>
        )}

        {/* Lien externe — n'affiche le lien que si l'URL est http/https (XSS guard) */}
        {offer.url && /^https?:\/\//i.test(offer.url) && (
          <a
            href={offer.url}
            target="_blank"
            rel="noopener noreferrer"
            className="disp ml-auto flex h-[34px] items-center gap-1.5 rounded-[8px] border border-line-soft bg-bg-2 px-3 text-[12px] font-medium text-text2 transition-colors hover:border-amber-line hover:text-text"
          >
            <ExternalLink size={13} strokeWidth={2} aria-hidden />
            Ouvrir
          </a>
        )}
      </div>

      {/* Analyze error */}
      {analyzeError && (
        <div className="mx-4 mt-3">
          <InlineError
            message={analyzeError}
            onDismiss={() => setAnalyzeError(null)}
          />
        </div>
      )}

      {/* Body */}
      <div className="flex flex-col gap-4 px-4 py-4">
        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {offer.organization && (
            <MetaField
              icon={Building2}
              label="Maître d'ouvrage"
              value={offer.organization}
            />
          )}
          {offer.region && (
            <MetaField icon={MapPin} label="Région" value={offer.region} />
          )}
          {offer.location && offer.location !== offer.region && (
            <MetaField icon={MapPin} label="Lieu" value={offer.location} />
          )}
          {offer.deadline && (
            <MetaField
              icon={Calendar}
              label="Date limite"
              value={fmtDate(offer.deadline)}
              urgent={urgent}
            />
          )}
          {offer.score !== null && offer.score !== undefined && (
            <MetaField
              icon={Search}
              label="Score"
              value={`${Math.round(offer.score * 100)} / 100`}
            />
          )}
        </div>

        {/* Keywords matched */}
        {offer.keywords_matched && offer.keywords_matched.length > 0 && (
          <FieldSection label="Mots-clés détectés">
            <div className="flex flex-wrap gap-1.5">
              {offer.keywords_matched.map((kw) => (
                <span
                  key={kw}
                  className="rounded-full border border-amber-line bg-amber-bg px-2.5 py-0.5 text-[11px] text-amber-2"
                >
                  {kw}
                </span>
              ))}
            </div>
          </FieldSection>
        )}

        {/* Summary */}
        {offer.summary && (
          <FieldSection label="Résumé">
            <p className="text-[12.5px] leading-relaxed text-text2">
              {offer.summary}
            </p>
          </FieldSection>
        )}

        {/* Lots */}
        {lots && lots.length > 0 && (
          <FieldSection label={`Lots (${lots.length})`}>
            <ul className="flex flex-col gap-1.5">
              {lots.map((lot, i) => {
                const label =
                  typeof lot === "string"
                    ? lot
                    : typeof lot === "object" &&
                        lot !== null &&
                        !Array.isArray(lot)
                      ? ((lot as Record<string, unknown>).title as string) ||
                        ((lot as Record<string, unknown>).label as string) ||
                        JSON.stringify(lot)
                      : String(lot);
                return (
                  <li
                    key={i}
                    className="flex gap-2.5 text-[12.5px] leading-relaxed text-text2"
                  >
                    <span
                      className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-amber"
                      aria-hidden
                    />
                    <span className="min-w-0">{label}</span>
                  </li>
                );
              })}
            </ul>
          </FieldSection>
        )}

        {/* Link to detail page */}
        <div className="border-t border-line-soft pt-3">
          <Link
            href={`/tenders/${offer.id}`}
            className="flex items-center gap-1.5 text-[12px] text-text3 transition-colors hover:text-amber-2"
          >
            Voir la page complète
            <ChevronRight size={13} strokeWidth={2.2} aria-hidden />
          </Link>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* action button helper                                                */
/* ------------------------------------------------------------------ */

function ActionButton({
  icon: Icon,
  loading = false,
  disabled = false,
  tone = "neutral",
  onClick,
  children,
}: {
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  tone?: "amber" | "neutral";
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "disp flex h-[34px] items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-semibold transition-colors disabled:opacity-60",
        tone === "amber"
          ? "border-amber-line bg-amber-bg text-amber-2 hover:opacity-80"
          : "border-line-soft bg-bg-2 text-text2 hover:border-amber-line hover:text-text",
      )}
    >
      {loading ? (
        <Spinner size={13} />
      ) : Icon ? (
        <Icon size={13} strokeWidth={2.2} aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* meta field                                                          */
/* ------------------------------------------------------------------ */

function MetaField({
  icon: Icon,
  label,
  value,
  urgent = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  urgent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-text3">
        <Icon size={10} strokeWidth={2} aria-hidden />
        {label}
      </span>
      <span
        className={cn(
          "truncate text-[12.5px] text-text2",
          urgent && "font-medium text-hot",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* field section                                                       */
/* ------------------------------------------------------------------ */

function FieldSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="micro">{label}</span>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* veille feedback banner                                              */
/* ------------------------------------------------------------------ */

function VeilleFeedback({
  count,
  newIds,
  onDismiss,
}: {
  count: number;
  newIds: string[];
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-[9px] border border-ok-bg bg-ok-bg px-3.5 py-2.5 text-[12.5px] text-ok">
      <PlayCircle size={15} strokeWidth={2} className="mt-px flex-none" aria-hidden />
      <span className="flex-1">
        {count === 0
          ? "Veille terminée — aucune nouvelle offre détectée."
          : `Veille terminée — ${count} nouvelle${count > 1 ? "s" : ""} offre${count > 1 ? "s" : ""} ajoutée${count > 1 ? "s" : ""}.`}
        {newIds.length > 0 && (
          <span className="ml-1 text-[11px] opacity-70">
            ({newIds.length} id{newIds.length > 1 ? "s" : ""})
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fermer"
        className="flex-none opacity-60 hover:opacity-100"
      >
        <XCircle size={14} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page-level loading / empty / error states                          */
/* ------------------------------------------------------------------ */

function LoadingState() {
  return (
    <Panel className="grid place-items-center py-16">
      <div className="flex flex-col items-center gap-3 text-text3">
        <Spinner size={24} />
        <span className="disp text-[11px] font-semibold uppercase tracking-[0.1em]">
          Chargement des appels d'offres…
        </span>
      </div>
    </Panel>
  );
}

function EmptyState({
  onRunVeille,
  running,
}: {
  onRunVeille: () => void;
  running: boolean;
}) {
  return (
    <Panel className="grid place-items-center py-16 text-center">
      <div className="flex max-w-[360px] flex-col items-center gap-3 text-text3">
        <Inbox size={26} strokeWidth={1.8} aria-hidden />
        <span className="text-[13px] font-medium text-text2">
          Aucun appel d'offre détecté
        </span>
        <span className="text-[12px]">
          Lancez la veille pour rechercher des marchés publics BTP dans les
          DOM. Les résultats apparaîtront ici automatiquement.
        </span>
        <button
          type="button"
          onClick={onRunVeille}
          disabled={running}
          className="disp mt-1 flex items-center gap-2 rounded-[8px] border border-amber-line bg-amber-bg px-3.5 py-2 text-[12px] font-semibold tracking-[0.04em] text-amber-2 transition-colors hover:opacity-80 disabled:opacity-60"
        >
          {running ? <Spinner size={14} /> : <PlayCircle size={14} strokeWidth={2} aria-hidden />}
          {running ? "Veille en cours…" : "Lancer la veille maintenant"}
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
        <AlertTriangle
          size={26}
          strokeWidth={1.8}
          className="text-stop"
          aria-hidden
        />
        <span className="text-[13px] font-medium text-text2">
          Impossible de charger les appels d'offres
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
  className,
  onDismiss,
}: {
  message: string;
  className?: string;
  onDismiss?: () => void;
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

// Silences the unused import — TENDER_STATUS_LABELS is a stable reference used
// for future i18n or tooltip integration; keeping it avoids tree-shaking it
// in a future pass.
void TENDER_STATUS_LABELS;
