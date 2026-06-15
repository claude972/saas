"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Globe,
  Calendar,
  Layers,
  FileSearch,
  ExternalLink,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type { AppDocument, TenderOffer } from "@/lib/types";
import type { JsonValue } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { Spinner } from "@/components/ui/Spinner";

/* ============================================================
   Tender offer detail — loads a single TenderOffer, lets the
   user trigger an AI analysis (POST /tenders/{id}/analyze) and
   displays the resulting analyse_ao document.
   ============================================================ */

export default function TenderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [offer, setOffer] = useState<TenderOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (silent: boolean) => {
      if (!id) return;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const data = await api.getTender(id);
        if (!mounted.current) return;
        setOffer(data);
        setError(null);
      } catch (err) {
        if (!mounted.current) return;
        if (!silent) {
          setError(err instanceof Error ? err.message : "Erreur inconnue.");
        }
      } finally {
        if (mounted.current && !silent) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (loading) {
    return (
      <div className="grid h-full place-items-center py-24">
        <Spinner size={26} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-[22px] py-[18px]">
        <BackLink />
        <Panel className="mt-4 p-6 text-center">
          <p className="text-[13px] text-hot">{error}</p>
          <button
            type="button"
            onClick={() => void load(false)}
            className="disp mt-4 rounded-[7px] border border-line bg-bg-2 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-text2 transition-colors hover:border-amber-line hover:text-text"
          >
            Réessayer
          </button>
        </Panel>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="px-[22px] py-[18px]">
        <BackLink />
        <EmptyPanel label="Appel d'offres introuvable." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-[22px] py-[18px]">
      <BackLink />

      <HeaderPanel offer={offer} />

      <InstrumentStrip offer={offer} />

      {/* Summary & lots */}
      <LotsSection offer={offer} />

      {/* AI analysis action + result */}
      <AnalyzeSection offer={offer} onOfferUpdated={setOffer} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header panel                                                         */
/* ------------------------------------------------------------------ */

function HeaderPanel({ offer }: { offer: TenderOffer }) {
  return (
    <Panel accent className="oc-fade pl-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="grid h-12 w-12 flex-none place-items-center rounded-[10px] bg-bg-3 text-text2">
          <FileSearch size={24} strokeWidth={1.8} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="disp text-[20px] font-semibold leading-tight tracking-[0.01em] text-text">
            {offer.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-text3">
            {offer.organization && (
              <Meta icon={Building2} label={offer.organization} />
            )}
            {offer.location && (
              <Meta icon={MapPin} label={offer.location} />
            )}
            {offer.region && (
              <Meta icon={Globe} label={offer.region} />
            )}
            {offer.deadline && (
              <Meta icon={Calendar} label={formatDeadline(offer.deadline)} />
            )}
          </div>
        </div>
        <TenderStatusBadge status={offer.status} />
      </div>

      {offer.summary && (
        <p className="mt-4 max-w-3xl border-t border-line-soft pt-3 text-[12.5px] leading-relaxed text-text2">
          {offer.summary}
        </p>
      )}

      {offer.url && /^https?:\/\//i.test(offer.url) && (
        <div className="mt-3 border-t border-line-soft pt-3">
          <a
            href={offer.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] text-amber-2 transition-opacity hover:opacity-80"
          >
            <ExternalLink size={13} strokeWidth={2.2} aria-hidden />
            Voir l'avis original
          </a>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Instrument strip                                                     */
/* ------------------------------------------------------------------ */

function InstrumentStrip({ offer }: { offer: TenderOffer }) {
  const lots = parseLots(offer.lots);
  const keywordsCount = offer.keywords_matched?.length ?? 0;

  return (
    <div className="oc-fade flex items-stretch overflow-hidden rounded-[11px] border border-line bg-panel">
      <StripCell label="Source" value={offer.source} mono />
      <StripCell
        label="Lots"
        value={lots.length > 0 ? lots.length : "—"}
        amber={lots.length > 0}
      />
      {offer.score !== null && offer.score !== undefined && (
        <StripCell
          label="Score"
          value={`${Math.round(offer.score * 100)}%`}
          amber={offer.score >= 0.7}
        />
      )}
      <StripCell label="Mots-clés" value={keywordsCount > 0 ? keywordsCount : "—"} />
      <StripCell label="ID offre" mono value={shortId(offer.id)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lots section                                                         */
/* ------------------------------------------------------------------ */

function LotsSection({ offer }: { offer: TenderOffer }) {
  const lots = parseLots(offer.lots);
  const keywords = offer.keywords_matched ?? [];

  if (lots.length === 0 && keywords.length === 0) return null;

  return (
    <section className="oc-fade flex flex-col gap-5">
      {lots.length > 0 && (
        <div>
          <SectionHeader
            title="Lots"
            count={lots.length}
            icon={<Layers size={16} strokeWidth={2} className="text-text2" />}
          />
          <div className="overflow-hidden rounded-[11px] border border-line bg-panel">
            {lots.map((lot, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 border-b border-line-soft px-[14px] py-[11px] last:border-b-0"
              >
                <span className="mono mt-0.5 flex-none text-[10.5px] text-text3">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  {typeof lot === "string" ? (
                    <p className="text-[12.5px] text-text">{lot}</p>
                  ) : (
                    <LotCard lot={lot as JsonObject} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {keywords.length > 0 && (
        <div>
          <SectionHeader
            title="Mots-clés détectés"
            count={keywords.length}
          />
          <div className="flex flex-wrap gap-2">
            {keywords.map((kw) => (
              <span
                key={kw}
                className="disp inline-block rounded-[5px] bg-amber-bg px-2.5 py-[5px] text-[11px] font-semibold uppercase tracking-[0.06em] text-amber-2"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

type JsonObject = { [key: string]: JsonValue };

function LotCard({ lot }: { lot: JsonObject }) {
  const title =
    typeof lot["title"] === "string"
      ? lot["title"]
      : typeof lot["nom"] === "string"
        ? lot["nom"]
        : null;
  const desc =
    typeof lot["description"] === "string"
      ? lot["description"]
      : typeof lot["summary"] === "string"
        ? lot["summary"]
        : null;
  const num =
    typeof lot["number"] === "string" || typeof lot["number"] === "number"
      ? String(lot["number"])
      : typeof lot["numero"] === "string" || typeof lot["numero"] === "number"
        ? String(lot["numero"])
        : null;

  return (
    <div>
      {(num ?? title) && (
        <p className="text-[12.5px] font-medium text-text">
          {num ? `Lot ${num}${title ? ` — ${title}` : ""}` : title}
        </p>
      )}
      {desc && (
        <p className="mt-0.5 text-[12px] leading-relaxed text-text2">{desc}</p>
      )}
      {!num && !title && !desc && (
        <p className="text-[12.5px] text-text2">{JSON.stringify(lot)}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Analyze section                                                      */
/* ------------------------------------------------------------------ */

function AnalyzeSection({
  offer,
  onOfferUpdated,
}: {
  offer: TenderOffer;
  onOfferUpdated: (updated: TenderOffer) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [resultDoc, setResultDoc] = useState<AppDocument | null>(null);

  const hasDoc = !!offer.document_id || !!resultDoc;
  const docId = resultDoc?.id ?? offer.document_id ?? null;

  const [miniAnalyzing, setMiniAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const doc = await api.analyzeTender(offer.id, {
        instruction: instruction || undefined,
        mode: "full",
      });
      setResultDoc(doc);
      // Reflect status change in the parent without a full reload.
      onOfferUpdated({ ...offer, status: "responded", document_id: doc.id });
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Erreur lors de l'analyse.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleMiniAnalyze = async () => {
    setMiniAnalyzing(true);
    setAnalyzeError(null);
    try {
      const doc = await api.analyzeTender(offer.id, {
        instruction: instruction || undefined,
        mode: "mini",
      });
      setResultDoc(doc);
      onOfferUpdated({ ...offer, status: "responded", document_id: doc.id });
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Erreur lors de l'analyse.");
    } finally {
      setMiniAnalyzing(false);
    }
  };

  return (
    <section className="oc-fade">
      <SectionHeader
        title="Analyse IA"
        icon={<Zap size={16} strokeWidth={2} className="text-amber-2" />}
      />

      {hasDoc && docId ? (
        <AnalysisResult doc={resultDoc} docId={docId} />
      ) : (
        <Panel className="flex flex-col gap-4">
          <p className="text-[12.5px] text-text2">
            Lancez une analyse IA de cet appel d'offres. Un document{" "}
            <span className="mono text-[11px]">analyse_ao</span> sera généré et
            lié à cette offre.
          </p>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="instruction"
              className="disp text-[10px] font-semibold uppercase tracking-[0.1em] text-text3"
            >
              Instruction personnalisée (optionnel)
            </label>
            <textarea
              id="instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Ex : Focus sur les contraintes DOM et les lots de second œuvre…"
              rows={3}
              disabled={analyzing || miniAnalyzing}
              className="w-full resize-none rounded-[7px] border border-line bg-bg-2 px-3 py-2 text-[12.5px] text-text placeholder:text-text3 focus:border-amber-line focus:outline-none disabled:opacity-50"
            />
          </div>

          {analyzeError && (
            <p className="text-[12px] text-stop">{analyzeError}</p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={analyzing || miniAnalyzing}
              className="disp inline-flex items-center gap-2 rounded-[7px] bg-amber px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-amber-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analyzing ? (
                <>
                  <Spinner size={14} className="border-amber-fg/40 border-t-amber-fg" />
                  Analyse en cours…
                </>
              ) : (
                <>
                  <Zap size={14} strokeWidth={2.2} aria-hidden />
                  Analyser cet appel d'offres
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => void handleMiniAnalyze()}
              disabled={analyzing || miniAnalyzing}
              className="disp inline-flex items-center gap-2 rounded-[7px] border border-line bg-bg-2 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-text2 transition-colors hover:border-amber-line hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              {miniAnalyzing ? (
                <>
                  <Spinner size={14} />
                  Mini rapport…
                </>
              ) : (
                <>
                  <Zap size={14} strokeWidth={2.2} aria-hidden />
                  Mini rapport
                </>
              )}
            </button>
          </div>
        </Panel>
      )}
    </section>
  );
}

function AnalysisResult({
  doc,
  docId,
}: {
  doc: AppDocument | null;
  docId: string;
}) {
  const content = doc?.content as JsonObject | null | undefined;

  return (
    <div className="flex flex-col gap-3">
      <Panel className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <FileSearch size={16} strokeWidth={2} className="flex-none text-ok" aria-hidden />
          <div>
            <p className="text-[12.5px] font-medium text-text">
              {doc?.title ?? "Analyse AO générée"}
            </p>
            <p className="mono mt-0.5 text-[10.5px] text-text3">
              analyse_ao
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {doc && <StatusChip status={doc.status} />}
          <Link
            href={`/documents/${docId}`}
            className="disp inline-flex items-center gap-1.5 rounded-[7px] border border-line bg-bg-2 px-3 py-[6px] text-[11px] font-semibold uppercase tracking-[0.04em] text-text2 transition-colors hover:border-amber-line hover:text-text"
          >
            Ouvrir le document
            <ExternalLink size={12} strokeWidth={2.2} aria-hidden />
          </Link>
        </div>
      </Panel>

      {content && <AnalysisContentPanel content={content} />}
    </div>
  );
}

function AnalysisContentPanel({ content }: { content: JsonObject }) {
  const sections: Array<{ key: string; label: string }> = [
    { key: "synthese", label: "Synthèse" },
    { key: "delais", label: "Délais" },
    { key: "recommandation", label: "Recommandation" },
  ];

  const listSections: Array<{ key: string; label: string }> = [
    { key: "pieces_demandees", label: "Pièces demandées" },
    { key: "criteres", label: "Critères d'attribution" },
    { key: "contraintes_dom", label: "Contraintes DOM" },
    { key: "risques", label: "Risques identifiés" },
  ];

  const hasAnyContent =
    sections.some((s) => typeof content[s.key] === "string" && content[s.key]) ||
    listSections.some((s) => Array.isArray(content[s.key]) && (content[s.key] as JsonValue[]).length > 0) ||
    (Array.isArray(content["lots"]) && (content["lots"] as JsonValue[]).length > 0);

  if (!hasAnyContent) return null;

  return (
    <div className="overflow-hidden rounded-[11px] border border-line bg-panel">
      {sections.map(({ key, label }) => {
        const val = content[key];
        if (typeof val !== "string" || !val) return null;
        return (
          <div
            key={key}
            className="border-b border-line-soft px-[14px] py-[11px] last:border-b-0"
          >
            <p className="disp mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text3">
              {label}
            </p>
            <p className="text-[12.5px] leading-relaxed text-text">{val}</p>
          </div>
        );
      })}

      {Array.isArray(content["lots"]) && (content["lots"] as JsonValue[]).length > 0 && (
        <div className="border-b border-line-soft px-[14px] py-[11px] last:border-b-0">
          <p className="disp mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text3">
            Lots analysés
          </p>
          <ul className="flex flex-col gap-1">
            {(content["lots"] as JsonValue[]).map((lot, i) => (
              <li key={i} className="text-[12.5px] text-text">
                {typeof lot === "string" ? lot : JSON.stringify(lot)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {listSections.map(({ key, label }) => {
        const items = content[key];
        if (!Array.isArray(items) || items.length === 0) return null;
        return (
          <div
            key={key}
            className="border-b border-line-soft px-[14px] py-[11px] last:border-b-0"
          >
            <p className="disp mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text3">
              {label}
            </p>
            <ul className="flex flex-col gap-1">
              {(items as JsonValue[]).map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] text-text2">
                  <span className="mt-[5px] h-[5px] w-[5px] flex-none rounded-full bg-amber" aria-hidden />
                  {typeof item === "string" ? item : JSON.stringify(item)}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                       */
/* ------------------------------------------------------------------ */

function BackLink() {
  return (
    <Link
      href="/tenders"
      className="inline-flex items-center gap-1.5 text-[12px] text-text3 transition-colors hover:text-amber-2"
    >
      <ArrowLeft size={14} strokeWidth={2.2} aria-hidden />
      Appels d'offres
    </Link>
  );
}

function Meta({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon size={13} strokeWidth={2} className="flex-none text-text3" aria-hidden />
      <span className="text-text2">{label}</span>
    </span>
  );
}

function StripCell({
  label,
  value,
  amber = false,
  mono = false,
}: {
  label: string;
  value: string | number;
  amber?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1.5 border-r border-line-soft px-4 py-[13px] last:border-r-0">
      <span className="disp text-[10px] font-semibold uppercase tracking-[0.12em] text-text3">
        {label}
      </span>
      <span
        className={cn(
          mono
            ? "mono text-[15px] font-medium leading-none"
            : "disp tnum text-[26px] font-semibold leading-none",
          amber ? "text-amber-2" : "text-text",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function TenderStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    new: { label: "Nouveau", cls: "text-steel bg-steel-bg" },
    seen: { label: "Vu", cls: "text-text2 bg-bg-3" },
    analyzing: { label: "Analyse en cours", cls: "text-amber-2 bg-amber-bg" },
    responded: { label: "Répondu", cls: "text-ok bg-ok-bg" },
    ignored: { label: "Ignoré", cls: "text-text2 bg-bg-3 opacity-60" },
  };
  const def = map[status] ?? { label: status, cls: "text-text2 bg-bg-3" };
  return (
    <span
      className={cn(
        "disp inline-block flex-none whitespace-nowrap rounded-[5px] px-2.5 py-[5px] text-[10px] font-semibold uppercase tracking-[0.08em]",
        def.cls,
      )}
    >
      {def.label}
    </span>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="rounded-[11px] border border-dashed border-line bg-panel px-4 py-8 text-center text-[12.5px] text-text3">
      {label}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function parseLots(raw: JsonValue | null | undefined): JsonValue[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return [];
}

function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
