"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookMarked,
  BookOpen,
  Braces,
  Camera,
  ChevronRight,
  ClipboardList,
  Edit3,
  Eye,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Inbox,
  Microscope,
  Receipt,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  AppDocument,
  DocumentStatus,
  JsonObject,
  JsonValue,
} from "@/lib/types";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { Spinner } from "@/components/ui/Spinner";
import { QuoteEditor } from "@/components/documents/QuoteEditor";
import { ReportEditor } from "@/components/documents/ReportEditor";
import { ExportBar } from "@/components/documents/ExportBar";

/* ------------------------------------------------------------------ */
/* constants & helpers                                                */
/* ------------------------------------------------------------------ */

const POLL_MS = 3000;

// Documents attached to in-flight work can still flip status server-side,
// so we keep polling while any of these are present.
const LIVE_STATUSES = new Set<DocumentStatus>(["draft", "waiting_approval"]);

// Statuses where editing content is allowed
const EDITABLE_STATUSES = new Set<DocumentStatus>([
  "draft",
  "waiting_approval",
  "approved",
  "sent",
]);

// Métier label + pictogram per document_type produced by the agents.
const TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  quote: { label: "Devis", icon: Receipt },
  dpgf: { label: "DPGF", icon: FileSpreadsheet },
  tender_response: { label: "Réponse appel d'offre", icon: FileSearch },
  analyse_ao: { label: "Analyse AO", icon: Microscope },
  site_report: { label: "Compte-rendu de chantier", icon: ClipboardList },
  rapport_chantier: { label: "Rapport de chantier", icon: ClipboardList },
  photo_report: { label: "Rapport d'analyse photo", icon: Camera },
  dce: { label: "DCE", icon: FolderOpen },
  cctp: { label: "CCTP", icon: BookOpen },
  ccap: { label: "CCAP", icon: BookMarked },
};

// Stable métier ordering for the type filter tabs.
const TYPE_ORDER = [
  "quote",
  "dpgf",
  "tender_response",
  "analyse_ao",
  "site_report",
  "rapport_chantier",
  "photo_report",
  "dce",
  "cctp",
  "ccap",
];

function typeLabel(documentType: string): string {
  return TYPE_META[documentType]?.label ?? documentType;
}

function typeIcon(documentType: string): LucideIcon {
  return TYPE_META[documentType]?.icon ?? FileText;
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

const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

function asNumber(value: JsonValue | undefined): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function asString(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

/** Coerce a JSON field into a clean list of non-empty strings. */
function asStringList(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item : String(item)))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/* ------------------------------------------------------------------ */
/* page                                                               */
/* ------------------------------------------------------------------ */

export default function DocumentsPage() {
  const [docs, setDocs] = useState<AppDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Type filter (null = all). Keeps the dense list usable as it grows.
  const [filter, setFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await api.listDocuments();
    // Newest first — the freshest drafts land at the top.
    return [...list].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, []);

  // initial load
  useEffect(() => {
    let alive = true;
    load()
      .then((next) => {
        if (!alive) return;
        setDocs(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Chargement impossible.");
      });
    return () => {
      alive = false;
    };
  }, [load]);

  // Poll while any document is still in a non-terminal state.
  const hasLive =
    docs?.some((d) => LIVE_STATUSES.has(d.status as DocumentStatus)) ?? false;
  useEffect(() => {
    if (!hasLive) return;
    const id = window.setInterval(() => {
      load()
        .then((next) => {
          setDocs(next);
          setError(null);
        })
        .catch(() => {
          /* keep the last good snapshot on transient poll failures */
        });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [hasLive, load]);

  // Type tabs derived from what actually exists, in a stable métier order.
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of docs ?? []) {
      counts[d.document_type] = (counts[d.document_type] ?? 0) + 1;
    }
    return counts;
  }, [docs]);

  const presentTypes = useMemo(
    () =>
      TYPE_ORDER.filter((t) => (typeCounts[t] ?? 0) > 0).concat(
        // surface any unexpected types after the known ones
        Object.keys(typeCounts).filter((t) => !TYPE_ORDER.includes(t)),
      ),
    [typeCounts],
  );

  const filtered = useMemo(() => {
    if (!docs) return [];
    return filter ? docs.filter((d) => d.document_type === filter) : docs;
  }, [docs, filter]);

  // Callback from DocumentDetail when the user saves — sync the list row
  const handleDocSaved = useCallback((updated: AppDocument) => {
    setDocs((prev) =>
      prev ? prev.map((d) => (d.id === updated.id ? updated : d)) : prev,
    );
  }, []);

  async function retry() {
    setError(null);
    setDocs(null);
    try {
      setDocs(await load());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }

  return (
    <div className="flex flex-col gap-5 px-[22px] py-[18px]">
      <header className="oc-fade">
        <h1 className="disp text-[19px] font-semibold tracking-[0.01em]">
          Documents
        </h1>
        <p className="mt-1 text-[12.5px] text-text3">
          Tous les documents générés par les sous-agents — toujours produits en
          brouillon, validés par le backend avant tout envoi.
        </p>
      </header>

      {docs && docs.length > 0 && <DocsStrip docs={docs} />}

      {error && !docs ? (
        <ErrorState message={error} onRetry={retry} />
      ) : !docs ? (
        <LoadingState />
      ) : docs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="oc-fade" style={{ animationDelay: "0.06s" }}>
          {error && <InlineError className="mb-3" message={error} />}

          {/* type filter tabs */}
          {presentTypes.length > 1 && (
            <FilterTabs
              types={presentTypes}
              counts={typeCounts}
              total={docs.length}
              active={filter}
              onChange={setFilter}
            />
          )}

          {/* master / detail */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            {/* --- list --- */}
            <section>
              <SectionHeader
                title="Documents"
                count={filtered.length}
                icon={
                  <FileText
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
                    Aucun document de ce type.
                  </p>
                ) : (
                  filtered.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      active={doc.id === selectedId}
                      onSelect={() => setSelectedId(doc.id)}
                    />
                  ))
                )}
              </Panel>
            </section>

            {/* --- detail --- */}
            <section className="lg:sticky lg:top-[18px] lg:self-start">
              <SectionHeader
                title="Aperçu du document"
                icon={
                  <Braces
                    size={16}
                    strokeWidth={2}
                    className="text-text2"
                    aria-hidden
                  />
                }
              />
              <DocumentDetail
                key={selectedId ?? "none"}
                documentId={selectedId}
                onSaved={handleDocSaved}
              />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* instrument strip — document counts (parity with dashboard strip)   */
/* ------------------------------------------------------------------ */

function DocsStrip({ docs }: { docs: readonly AppDocument[] }) {
  const total = docs.length;
  const drafts = docs.filter((d) => d.status === "draft").length;
  const waiting = docs.filter((d) => d.status === "waiting_approval").length;
  const approved = docs.filter(
    (d) => d.status === "approved" || d.status === "sent",
  ).length;

  return (
    <section
      className="oc-fade flex items-stretch overflow-hidden rounded-[11px] border border-line bg-panel"
      style={{ animationDelay: "0.03s" }}
    >
      <StripCell label="Documents" value={total} />
      <StripCell label="Brouillons" value={drafts} />
      <StripCell
        label="En validation"
        value={waiting}
        tone={waiting > 0 ? "amber" : undefined}
      />
      <StripCell label="Validés / envoyés" value={approved} tone="ok" />
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
/* type filter tabs                                                   */
/* ------------------------------------------------------------------ */

function FilterTabs({
  types,
  counts,
  total,
  active,
  onChange,
}: {
  types: string[];
  counts: Record<string, number>;
  total: number;
  active: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Tab label="Tous" count={total} on={active === null} onClick={() => onChange(null)} />
      {types.map((t) => (
        <Tab
          key={t}
          label={typeLabel(t)}
          count={counts[t] ?? 0}
          icon={typeIcon(t)}
          on={active === t}
          onClick={() => onChange(t)}
        />
      ))}
    </div>
  );
}

function Tab({
  label,
  count,
  icon: Icon,
  on,
  onClick,
}: {
  label: string;
  count: number;
  icon?: LucideIcon;
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
      {Icon && <Icon size={14} strokeWidth={2} aria-hidden />}
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
/* list row                                                           */
/* ------------------------------------------------------------------ */

function DocumentRow({
  doc,
  active,
  onSelect,
}: {
  doc: AppDocument;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = typeIcon(doc.document_type);

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

      {/* pictogram tile */}
      <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[8px] bg-bg-3 text-text2">
        <Icon size={17} strokeWidth={2} aria-hidden />
      </span>

      {/* title + meta */}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-[13px] font-medium",
              active ? "text-amber-2" : "text-text",
            )}
          >
            {doc.title}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-text3">
          <span className="truncate">{typeLabel(doc.document_type)}</span>
          <span className="h-[3px] w-[3px] flex-none rounded-full bg-text3" aria-hidden />
          <span className="mono flex-none tnum">{fmtDateTime(doc.created_at)}</span>
        </span>
      </span>

      <StatusChip status={doc.status} className="flex-none" />
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
/* detail loader                                                      */
/* ------------------------------------------------------------------ */

type DetailMode = "view" | "edit";

function DocumentDetail({
  documentId,
  onSaved,
}: {
  documentId: string | null;
  onSaved: (updated: AppDocument) => void;
}) {
  const [doc, setDoc] = useState<AppDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DetailMode>("view");
  // Guard against a slow fetch resolving after the user picked another doc.
  const reqRef = useRef(0);

  const fetchDoc = useCallback((id: string) => {
    const req = ++reqRef.current;
    setLoading(true);
    setError(null);
    api
      .getDocument(id)
      .then((d) => {
        if (reqRef.current === req) setDoc(d);
      })
      .catch((err: unknown) => {
        if (reqRef.current === req) {
          setError(err instanceof Error ? err.message : "Chargement impossible.");
        }
      })
      .finally(() => {
        if (reqRef.current === req) setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!documentId) {
      setDoc(null);
      setMode("view");
      return;
    }
    fetchDoc(documentId);
    setMode("view");
  }, [documentId, fetchDoc]);

  // When the editor saves, update local doc + propagate to list
  const handleSaved = useCallback(
    (updated: AppDocument) => {
      setDoc(updated);
      onSaved(updated);
    },
    [onSaved],
  );

  if (!documentId) {
    return (
      <Panel className="grid place-items-center py-16 text-center">
        <div className="flex max-w-[300px] flex-col items-center gap-2 text-text3">
          <FileText size={26} strokeWidth={1.8} aria-hidden />
          <span className="text-[13px] font-medium text-text2">
            Aucun document sélectionné
          </span>
          <span className="text-[12px]">
            Choisissez un document dans la liste pour afficher son contenu.
          </span>
        </div>
      </Panel>
    );
  }

  if (loading && !doc) {
    return (
      <Panel className="grid place-items-center py-16">
        <Spinner size={24} />
      </Panel>
    );
  }

  if (error && !doc) {
    return (
      <Panel className="py-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle size={24} strokeWidth={2} className="text-stop" aria-hidden />
          <p className="text-[13px] text-text2">{error}</p>
          <button
            type="button"
            onClick={() => fetchDoc(documentId)}
            className="disp flex h-[36px] items-center gap-1.5 rounded-[8px] border border-line bg-bg-2 px-4 text-[12px] font-semibold text-text2 transition-colors hover:text-text"
          >
            <RefreshCw size={14} strokeWidth={2.2} aria-hidden />
            Réessayer
          </button>
        </div>
      </Panel>
    );
  }

  if (!doc) return null;

  const Icon = typeIcon(doc.document_type);
  const canEdit = EDITABLE_STATUSES.has(doc.status as DocumentStatus);
  const isArchived = doc.status === "archived" || doc.status === "rejected";

  return (
    <Panel bare className="oc-fade">
      {/* header band */}
      <div className="flex flex-wrap items-start gap-3 border-b border-line-soft px-4 py-3.5">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-[9px] bg-bg-3 text-text2">
          <Icon size={20} strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="disp truncate text-[15px] font-semibold leading-tight text-text">
            {doc.title}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text3">
            <span className="text-text2">{typeLabel(doc.document_type)}</span>
            <span className="h-[3px] w-[3px] rounded-full bg-text3" aria-hidden />
            <span className="mono">{doc.document_type}</span>
            <span className="h-[3px] w-[3px] rounded-full bg-text3" aria-hidden />
            <span className="mono tnum">{fmtDateTime(doc.created_at)}</span>
          </div>
        </div>
        <StatusChip status={doc.status} className="flex-none" />
      </div>

      {/* mode toggle + export toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-2.5">
        {/* view / edit toggle */}
        {canEdit ? (
          <div className="flex items-center rounded-[8px] border border-line-soft bg-bg-2 p-[3px]">
            <ModeButton
              active={mode === "view"}
              icon={Eye}
              label="Aperçu"
              onClick={() => setMode("view")}
            />
            <ModeButton
              active={mode === "edit"}
              icon={Edit3}
              label="Éditer"
              onClick={() => setMode("edit")}
            />
          </div>
        ) : (
          <span className="flex items-center gap-1.5 text-[11.5px] text-text3">
            <Eye size={13} strokeWidth={2} aria-hidden />
            {isArchived ? "Document archivé / refusé (lecture seule)" : "Aperçu"}
          </span>
        )}

        {/* export buttons */}
        <ExportBar
          documentId={doc.id}
          showXlsx={doc.document_type === "quote" || doc.document_type === "dpgf"}
          showObat={doc.document_type === "quote" || doc.document_type === "dpgf"}
          showCed={doc.document_type === "quote" || doc.document_type === "dpgf"}
        />
      </div>

      {/* body */}
      <div className="px-4 py-4">
        {mode === "edit" && canEdit ? (
          doc.document_type === "quote" || doc.document_type === "dpgf" ? (
            <QuoteEditor doc={doc} onSaved={handleSaved} />
          ) : (
            <ReportEditor doc={doc} onSaved={handleSaved} />
          )
        ) : (
          <>
            <DocumentContent
              documentType={doc.document_type}
              content={doc.content ?? null}
            />

            {doc.file_path && (
              <p className="mono mt-4 truncate border-t border-line-soft pt-3 text-[10.5px] text-text3">
                fichier · {doc.file_path}
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* mode toggle button                                                  */
/* ------------------------------------------------------------------ */

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[11.5px] font-medium transition-colors",
        active
          ? "bg-amber-bg text-amber-2"
          : "text-text3 hover:text-text2",
      )}
    >
      <Icon size={13} strokeWidth={2.2} aria-hidden />
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* content renderers — one per document_type, JSON fallback otherwise */
/* ------------------------------------------------------------------ */

function DocumentContent({
  documentType,
  content,
}: {
  documentType: string;
  content: JsonObject | null;
}) {
  if (!content || Object.keys(content).length === 0) {
    return (
      <p className="text-[12.5px] text-text3">
        Ce document ne contient encore aucun élément structuré.
      </p>
    );
  }

  switch (documentType) {
    case "quote":
    case "dpgf":
      return <QuoteContent content={content} />;
    case "tender_response":
      return <TenderContent content={content} />;
    case "site_report":
    case "rapport_chantier":
      return <SiteReportContent content={content} />;
    case "photo_report":
      return <PhotoReportContent content={content} />;
    case "analyse_ao":
      return <AoAnalysisContent content={content} />;
    default:
      return <JsonContent content={content} />;
  }
}

/* ----- shared building blocks ----- */

/** Uppercase Saira block label, matching `.micro` from the maquette. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="micro">{children}</span>;
}

/** Bulleted list with an amber marker; renders nothing when empty. */
function BulletList({
  items,
  tone = "amber",
}: {
  items: string[];
  tone?: "amber" | "hot";
}) {
  if (items.length === 0) {
    return <p className="text-[12px] text-text3">—</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed text-text2">
          <span
            className={cn(
              "mt-[7px] h-[5px] w-[5px] flex-none rounded-full",
              tone === "hot" ? "bg-hot" : "bg-amber",
            )}
            aria-hidden
          />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/* ----- quote (devis): line items + totals ----- */

function QuoteContent({ content }: { content: JsonObject }) {
  const lines = Array.isArray(content.lines) ? content.lines : [];
  const hypotheses = asStringList(content.hypotheses);
  const totalHt = asNumber(content.total_ht);
  const totalTva = asNumber(content.total_tva);
  const totalTtc = asNumber(content.total_ttc);
  const tvaRate = asNumber(content.tva_rate);
  const tvaPct = tvaRate > 0 ? `${NUM.format(tvaRate * 100)} %` : "TVA";

  return (
    <div className="flex flex-col gap-4">
      <Section label="Lignes du devis">
        {lines.length === 0 ? (
          <p className="text-[12px] text-text3">
            Aucune ligne chiffrée — devis à compléter manuellement.
          </p>
        ) : (
          <div className="overflow-hidden rounded-[9px] border border-line">
            {/* header */}
            <div className="grid grid-cols-[1fr_64px_84px_92px] gap-2 bg-bg-2 px-3 py-2">
              {["Désignation", "Qté", "P.U. HT", "Total HT"].map((h, i) => (
                <span
                  key={h}
                  className={cn(
                    "disp text-[10px] font-semibold uppercase tracking-[0.08em] text-text3",
                    i > 0 && "text-right",
                  )}
                >
                  {h}
                </span>
              ))}
            </div>
            {/* rows */}
            {lines.map((raw, i) => {
              const line = (raw && typeof raw === "object" && !Array.isArray(raw)
                ? raw
                : {}) as JsonObject;
              return (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_64px_84px_92px] items-baseline gap-2 border-t border-line-soft px-3 py-2"
                >
                  <span className="min-w-0 text-[12.5px] text-text">
                    {asString(line.label) || "Ligne sans libellé"}
                  </span>
                  <span className="mono tnum text-right text-[12px] text-text2">
                    {NUM.format(asNumber(line.qty))}
                    <span className="text-text3"> {asString(line.unit) || "u"}</span>
                  </span>
                  <span className="mono tnum text-right text-[12px] text-text2">
                    {EUR.format(asNumber(line.unit_price_ht))}
                  </span>
                  <span className="mono tnum text-right text-[12px] text-text">
                    {EUR.format(asNumber(line.total_ht))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* totals */}
      <div className="ml-auto w-full max-w-[280px] rounded-[9px] border border-line bg-bg-2 px-3.5 py-3">
        <TotalRow label="Total HT" value={EUR.format(totalHt)} />
        <TotalRow label={`TVA (${tvaPct})`} value={EUR.format(totalTva)} />
        <div className="my-2 h-px bg-line-soft" />
        <TotalRow label="Total TTC" value={EUR.format(totalTtc)} strong />
      </div>

      {hypotheses.length > 0 && (
        <Section label="Hypothèses">
          <BulletList items={hypotheses} />
        </Section>
      )}
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span
        className={cn(
          "text-[12px]",
          strong ? "disp font-semibold uppercase tracking-[0.06em] text-text" : "text-text3",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "mono tnum",
          strong ? "text-[14px] font-medium text-amber-2" : "text-[12.5px] text-text2",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ----- tender response: pièces / critères / délais / vigilance ----- */

function TenderContent({ content }: { content: JsonObject }) {
  const pieces = asStringList(content.pieces_demandees);
  const criteres = asStringList(content.criteres);
  const delais = asString(content.delais).trim();
  const vigilance = asStringList(content.points_vigilance);

  return (
    <div className="flex flex-col gap-4">
      <Section label="Pièces à remettre">
        <BulletList items={pieces} />
      </Section>
      <Section label="Critères de sélection">
        <BulletList items={criteres} />
      </Section>
      <Section label="Délais">
        <p className="text-[12.5px] leading-relaxed text-text2">
          {delais || "Non précisé"}
        </p>
      </Section>
      <Section label="Points de vigilance">
        <BulletList items={vigilance} tone="hot" />
      </Section>
    </div>
  );
}

/* ----- site report: date / présents / constats / actions / réserves ----- */

function SiteReportContent({ content }: { content: JsonObject }) {
  const date = asString(content.date).trim();
  const present = asStringList(content.present);
  const constats = asStringList(content.constats);
  const actions = asStringList(content.actions);
  const reserves = asStringList(content.reserves);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Inline label="Date de visite" value={date || "Non précisée"} />
        <Inline
          label="Présents"
          value={present.length > 0 ? present.join(", ") : "—"}
        />
      </div>
      <Section label="Constats">
        <BulletList items={constats} />
      </Section>
      <Section label="Actions à mener">
        <BulletList items={actions} />
      </Section>
      <Section label="Réserves">
        <BulletList items={reserves} tone="hot" />
      </Section>
    </div>
  );
}

function Inline({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="micro">{label}</span>
      <span className="min-w-0 truncate text-[12.5px] text-text2">{value}</span>
    </div>
  );
}

/* ----- photo report: observations / travaux / points d'attention ----- */

function PhotoReportContent({ content }: { content: JsonObject }) {
  const observations = asString(content.observations).trim();
  const travaux = asStringList(content.travaux_visibles);
  const points = asStringList(content.points_attention);

  return (
    <div className="flex flex-col gap-4">
      <Section label="Observations">
        {observations ? (
          <p className="text-[12.5px] leading-relaxed text-text2">{observations}</p>
        ) : (
          <p className="text-[12px] text-text3">—</p>
        )}
      </Section>
      <Section label="Travaux visibles">
        <BulletList items={travaux} />
      </Section>
      <Section label="Points d'attention">
        <BulletList items={points} tone="hot" />
      </Section>
    </div>
  );
}

/* ----- analyse AO: synthèse / lots / pièces / critères / délais / contraintes DOM / risques / recommandation ----- */

/* AO lots/critères arrive as dict lists from services/ao_analysis.py
   ({numero,intitule,montant_estime} / {libelle,ponderation}); flatten to labels. */
function formatLots(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((it) => {
      if (typeof it === "string") return it.trim();
      if (it && typeof it === "object") {
        const o = it as Record<string, JsonValue>;
        const numero = o.numero != null ? String(o.numero).trim() : "";
        const intitule = o.intitule != null ? String(o.intitule).trim() : "";
        const montant =
          o.montant_estime != null && String(o.montant_estime).trim()
            ? ` — ${String(o.montant_estime).trim()}`
            : "";
        return `${numero ? `Lot ${numero} : ` : ""}${intitule}${montant}`.trim();
      }
      return "";
    })
    .filter((s) => s.length > 0);
}

function formatCriteres(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((it) => {
      if (typeof it === "string") return it.trim();
      if (it && typeof it === "object") {
        const o = it as Record<string, JsonValue>;
        const libelle = o.libelle != null ? String(o.libelle).trim() : "";
        const pond =
          o.ponderation != null && String(o.ponderation).trim()
            ? ` (${String(o.ponderation).trim()})`
            : "";
        return `${libelle}${pond}`.trim();
      }
      return "";
    })
    .filter((s) => s.length > 0);
}

function AoAnalysisContent({ content }: { content: JsonObject }) {
  const synthese = asString(content.synthese).trim();
  const lots = formatLots(content.lots);
  const pieces = asStringList(content.pieces_demandees);
  const criteres = formatCriteres(content.criteres);
  const delais = asString(content.delais).trim();
  const contraintesDom = asStringList(content.contraintes_dom);
  const risques = asStringList(content.risques);
  const recommandation = asString(content.recommandation).trim();

  return (
    <div className="flex flex-col gap-4">
      {synthese && (
        <Section label="Synthèse">
          <p className="text-[12.5px] leading-relaxed text-text2">{synthese}</p>
        </Section>
      )}
      <Section label="Lots">
        <BulletList items={lots} />
      </Section>
      <Section label="Pièces à remettre">
        <BulletList items={pieces} />
      </Section>
      <Section label="Critères de sélection">
        <BulletList items={criteres} />
      </Section>
      <Section label="Délais">
        <p className="text-[12.5px] leading-relaxed text-text2">
          {delais || "Non précisé"}
        </p>
      </Section>
      <Section label="Contraintes DOM">
        <BulletList items={contraintesDom} tone="hot" />
      </Section>
      <Section label="Risques identifiés">
        <BulletList items={risques} tone="hot" />
      </Section>
      {recommandation && (
        <Section label="Recommandation">
          <p className="text-[12.5px] leading-relaxed text-text2">{recommandation}</p>
        </Section>
      )}
    </div>
  );
}

/* ----- generic JSON fallback for unknown document types ----- */

function JsonContent({ content }: { content: JsonObject }) {
  return (
    <div>
      <FieldLabel>Contenu (JSON)</FieldLabel>
      <pre className="mono mt-1.5 max-h-[420px] overflow-auto rounded-[8px] border border-line-soft bg-[var(--console-bg)] px-3 py-2.5 text-[11px] leading-[1.7] text-text2">
        {JSON.stringify(content, null, 2)}
      </pre>
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
          Chargement des documents…
        </span>
      </div>
    </Panel>
  );
}

function EmptyState() {
  return (
    <Panel className="grid place-items-center py-16 text-center">
      <div className="flex max-w-[340px] flex-col items-center gap-2 text-text3">
        <Inbox size={26} strokeWidth={1.8} aria-hidden />
        <span className="text-[13px] font-medium text-text2">
          Aucun document généré
        </span>
        <span className="text-[12px]">
          Les documents apparaissent ici dès qu'un sous-agent en produit
          (devis, compte-rendu, analyse photo ou réponse à appel d'offre).
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
    <Panel className="grid place-items-center py-16 text-center">
      <div className="flex max-w-[360px] flex-col items-center gap-3">
        <AlertTriangle size={26} strokeWidth={1.8} className="text-stop" aria-hidden />
        <span className="text-[13px] font-medium text-text2">
          Impossible de charger les documents
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
