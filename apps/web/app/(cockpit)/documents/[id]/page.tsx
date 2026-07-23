"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BookMarked,
  BookOpen,
  Braces,
  Camera,
  ClipboardList,
  Edit3,
  Eye,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Microscope,
  Receipt,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type { AppDocument, DocumentStatus, JsonObject, JsonValue } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { StatusChip } from "@/components/ui/StatusChip";
import { Spinner } from "@/components/ui/Spinner";
import { QuoteEditor } from "@/components/documents/QuoteEditor";
import { ReportEditor } from "@/components/documents/ReportEditor";
import { InterventionEditor } from "@/components/documents/InterventionEditor";
import { ExportBar } from "@/components/documents/ExportBar";

/* ------------------------------------------------------------------ */
/* constants & helpers (mirrors documents/page.tsx)                   */
/* ------------------------------------------------------------------ */

const EDITABLE_STATUSES = new Set<DocumentStatus>([
  "draft",
  "waiting_approval",
  "approved",
  "sent",
]);

const TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  quote:          { label: "Devis",                       icon: Receipt },
  dpgf:           { label: "DPGF",                        icon: FileSpreadsheet },
  tender_response:{ label: "Réponse appel d'offre",       icon: FileSearch },
  analyse_ao:     { label: "Analyse AO",                  icon: Microscope },
  site_report:    { label: "Compte-rendu de chantier",    icon: ClipboardList },
  rapport_chantier:{ label: "Rapport de chantier",        icon: ClipboardList },
  photo_report:   { label: "Rapport d'analyse photo",     icon: Camera },
  dce:            { label: "DCE",                         icon: FolderOpen },
  cctp:           { label: "CCTP",                        icon: BookOpen },
  ccap:           { label: "CCAP",                        icon: BookMarked },
};

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

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [doc, setDoc] = useState<AppDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const reqRef = useRef(0);

  const fetchDoc = useCallback(() => {
    const req = ++reqRef.current;
    setLoading(true);
    setError(null);
    setNotFound(false);
    api
      .getDocument(id)
      .then((d) => {
        if (reqRef.current !== req) return;
        setDoc(d);
      })
      .catch((err: unknown) => {
        if (reqRef.current !== req) return;
        const msg = err instanceof Error ? err.message : "Chargement impossible.";
        // Treat 404-like errors as not found
        if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
          setNotFound(true);
        } else {
          setError(msg);
        }
      })
      .finally(() => {
        if (reqRef.current === req) setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  const handleSaved = useCallback((updated: AppDocument) => {
    setDoc(updated);
  }, []);

  /* loading */
  if (loading) {
    return (
      <div className="flex flex-col gap-5 px-[22px] py-[18px]">
        <BackButton onClick={() => router.push("/documents")} />
        <Panel className="grid place-items-center py-16">
          <div className="flex flex-col items-center gap-3 text-text3">
            <Spinner size={24} />
            <span className="disp text-[11px] font-semibold uppercase tracking-[0.1em]">
              Chargement du document…
            </span>
          </div>
        </Panel>
      </div>
    );
  }

  /* 404 */
  if (notFound) {
    return (
      <div className="flex flex-col gap-5 px-[22px] py-[18px]">
        <BackButton onClick={() => router.push("/documents")} />
        <Panel className="grid place-items-center py-16 text-center">
          <div className="flex max-w-[360px] flex-col items-center gap-3">
            <FileText size={26} strokeWidth={1.8} className="text-text3" aria-hidden />
            <span className="text-[13px] font-medium text-text2">
              Document introuvable
            </span>
            <span className="text-[12px] text-text3">
              Ce document n'existe pas ou a été supprimé.
            </span>
            <button
              type="button"
              onClick={() => router.push("/documents")}
              className="disp mt-1 flex items-center gap-2 rounded-[8px] border border-line bg-bg-2 px-3.5 py-2 text-[12px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:border-amber-line hover:text-text"
            >
              <ArrowLeft size={14} strokeWidth={2.2} aria-hidden />
              Retour aux documents
            </button>
          </div>
        </Panel>
      </div>
    );
  }

  /* error */
  if (error || !doc) {
    return (
      <div className="flex flex-col gap-5 px-[22px] py-[18px]">
        <BackButton onClick={() => router.push("/documents")} />
        <Panel className="grid place-items-center py-16 text-center">
          <div className="flex max-w-[360px] flex-col items-center gap-3">
            <AlertTriangle size={26} strokeWidth={1.8} className="text-stop" aria-hidden />
            <span className="text-[13px] font-medium text-text2">
              Impossible de charger le document
            </span>
            {error && (
              <span className="text-[12px] text-text3">{error}</span>
            )}
            <button
              type="button"
              onClick={fetchDoc}
              className="disp mt-1 flex items-center gap-2 rounded-[8px] border border-line bg-bg-2 px-3.5 py-2 text-[12px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:border-amber-line hover:text-text"
            >
              <RefreshCw size={14} strokeWidth={2.2} aria-hidden />
              Réessayer
            </button>
          </div>
        </Panel>
      </div>
    );
  }

  /* document loaded */
  const Icon = typeIcon(doc.document_type);
  const canEdit = EDITABLE_STATUSES.has(doc.status as DocumentStatus);
  const isArchived = doc.status === "archived" || doc.status === "rejected";

  return (
    <div className="flex flex-col gap-5 px-[22px] py-[18px]">
      <header className="oc-fade flex items-center gap-3">
        <BackButton onClick={() => router.push("/documents")} />
        <div className="min-w-0">
          <h1 className="disp truncate text-[19px] font-semibold tracking-[0.01em]">
            {doc.title}
          </h1>
          <p className="mt-1 text-[12.5px] text-text3">
            {typeLabel(doc.document_type)}
          </p>
        </div>
      </header>

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
              {isArchived
                ? "Document archivé / refusé (lecture seule)"
                : "Aperçu"}
            </span>
          )}

          <ExportBar
            documentId={doc.id}
            showXlsx={doc.document_type === "quote" || doc.document_type === "dpgf"}
            showObat={doc.document_type === "quote" || doc.document_type === "dpgf"}
            showCed={doc.document_type === "quote" || doc.document_type === "dpgf" || doc.document_type === "intervention"}
            showSuivisio={doc.document_type === "quote" || doc.document_type === "dpgf" || doc.document_type === "intervention"}
            showBrume={doc.document_type === "quote" || doc.document_type === "dpgf" || doc.document_type === "intervention"}
            showEmail={doc.document_type === "quote" || doc.document_type === "dpgf" || doc.document_type === "intervention"}
            defaultEmail={typeof doc.content?.client_email === "string" ? doc.content.client_email : ""}
            documentTitle={doc.title}
          />
        </div>

        {/* body */}
        <div className="px-4 py-4">
          {mode === "edit" && canEdit ? (
            doc.document_type === "quote" || doc.document_type === "dpgf" ? (
              <QuoteEditor doc={doc} onSaved={handleSaved} />
            ) : doc.document_type === "intervention" ? (
              <InterventionEditor doc={doc} onSaved={handleSaved} />
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* back button                                                         */
/* ------------------------------------------------------------------ */

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="disp flex w-fit items-center gap-1.5 rounded-[8px] border border-line-soft bg-bg-2 px-3 py-1.5 text-[12px] font-medium text-text2 transition-colors hover:border-amber-line hover:text-text"
    >
      <ArrowLeft size={13} strokeWidth={2.2} aria-hidden />
      Documents
    </button>
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
        active ? "bg-amber-bg text-amber-2" : "text-text3 hover:text-text2",
      )}
    >
      <Icon size={13} strokeWidth={2.2} aria-hidden />
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* content renderers — mirrors documents/page.tsx exactly             */
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="micro">{children}</span>;
}

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
            {lines.map((raw, i) => {
              const line = (
                raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
              ) as JsonObject;
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
          strong
            ? "disp font-semibold uppercase tracking-[0.06em] text-text"
            : "text-text3",
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

/* ----- tender response ----- */

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

/* ----- site report ----- */

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

/* ----- photo report ----- */

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

/* ----- analyse AO ----- */

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

/* ----- generic JSON fallback ----- */

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
