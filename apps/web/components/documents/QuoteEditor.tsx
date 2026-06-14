"use client";

import { useCallback, useEffect, useId, useReducer, useRef } from "react";
import { AlertTriangle, Plus, Save, Trash2 } from "lucide-react";
import type { AppDocument, JsonObject } from "@/lib/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/Spinner";

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

export interface QuoteLine {
  label: string;
  qty: number;
  unit: string;
  unit_price_ht: number;
  total_ht: number;
}

interface QuoteState {
  lines: QuoteLine[];
  hypotheses: string[];
  tva_rate: number;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

type QuoteAction =
  | { type: "SET_LINE"; index: number; field: keyof QuoteLine; value: string | number }
  | { type: "ADD_LINE" }
  | { type: "REMOVE_LINE"; index: number }
  | { type: "SET_HYPOTHESES"; value: string }
  | { type: "SET_TVA_RATE"; value: number }
  | { type: "SAVING" }
  | { type: "SAVED" }
  | { type: "ERROR"; message: string }
  | { type: "RESET"; state: Omit<QuoteState, "dirty" | "saving" | "error" | "saved"> };

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

function coerceNum(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function coerceStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
}

function parseLines(raw: unknown): QuoteLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    const qty = coerceNum(o.qty);
    const unit_price_ht = coerceNum(o.unit_price_ht);
    return {
      label: coerceStr(o.label),
      qty,
      unit: coerceStr(o.unit) || "u",
      unit_price_ht,
      total_ht: coerceNum(o.total_ht) || qty * unit_price_ht,
    };
  });
}

function parseHypotheses(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => (typeof s === "string" ? s : String(s))).filter((s) => s.trim());
}

function calcTotals(lines: QuoteLine[], tva_rate: number) {
  const total_ht = lines.reduce((acc, l) => acc + l.total_ht, 0);
  const total_tva = total_ht * tva_rate;
  const total_ttc = total_ht + total_tva;
  return { total_ht, total_tva, total_ttc };
}

function buildPayload(state: QuoteState): JsonObject {
  const totals = calcTotals(state.lines, state.tva_rate);
  return {
    lines: state.lines as unknown as JsonObject[],
    hypotheses: state.hypotheses,
    tva_rate: state.tva_rate,
    ...totals,
  } as JsonObject;
}

function blankLine(): QuoteLine {
  return { label: "", qty: 1, unit: "u", unit_price_ht: 0, total_ht: 0 };
}

/* ------------------------------------------------------------------ */
/* reducer                                                             */
/* ------------------------------------------------------------------ */

function reducer(state: QuoteState, action: QuoteAction): QuoteState {
  switch (action.type) {
    case "SET_LINE": {
      const lines = state.lines.map((l, i) => {
        if (i !== action.index) return l;
        const updated = { ...l, [action.field]: action.value };
        // recompute total when qty or unit_price_ht changes
        if (action.field === "qty" || action.field === "unit_price_ht") {
          updated.total_ht = updated.qty * updated.unit_price_ht;
        }
        return updated;
      });
      return { ...state, lines, dirty: true, saved: false };
    }
    case "ADD_LINE":
      return { ...state, lines: [...state.lines, blankLine()], dirty: true, saved: false };
    case "REMOVE_LINE":
      return {
        ...state,
        lines: state.lines.filter((_, i) => i !== action.index),
        dirty: true,
        saved: false,
      };
    case "SET_HYPOTHESES": {
      const hypotheses = action.value
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return { ...state, hypotheses, dirty: true, saved: false };
    }
    case "SET_TVA_RATE":
      return { ...state, tva_rate: action.value, dirty: true, saved: false };
    case "SAVING":
      return { ...state, saving: true, error: null };
    case "SAVED":
      return { ...state, saving: false, dirty: false, saved: true, error: null };
    case "ERROR":
      return { ...state, saving: false, error: action.message };
    case "RESET":
      return { ...action.state, dirty: false, saving: false, error: null, saved: false };
    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/* component                                                          */
/* ------------------------------------------------------------------ */

interface QuoteEditorProps {
  doc: AppDocument;
  onSaved: (updated: AppDocument) => void;
}

export function QuoteEditor({ doc, onSaved }: QuoteEditorProps) {
  const content = (doc.content ?? {}) as Record<string, unknown>;

  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    lines: parseLines(content.lines),
    hypotheses: parseHypotheses(content.hypotheses),
    tva_rate: coerceNum(content.tva_rate) || 0.2,
    dirty: false,
    saving: false,
    error: null,
    saved: false,
  }));

  // Re-initialize when doc.id changes
  const docIdRef = useRef(doc.id);
  useEffect(() => {
    if (doc.id === docIdRef.current) return;
    docIdRef.current = doc.id;
    const c = (doc.content ?? {}) as Record<string, unknown>;
    dispatch({
      type: "RESET",
      state: {
        lines: parseLines(c.lines),
        hypotheses: parseHypotheses(c.hypotheses),
        tva_rate: coerceNum(c.tva_rate) || 0.2,
      },
    });
  }, [doc.id, doc.content]);

  const totals = calcTotals(state.lines, state.tva_rate);
  const tvaPct = `${NUM.format(state.tva_rate * 100)} %`;

  const willTriggerApproval =
    state.dirty && (doc.status === "approved" || doc.status === "sent");

  const handleSave = useCallback(async () => {
    dispatch({ type: "SAVING" });
    try {
      const updated = await api.updateDocument(doc.id, {
        content: buildPayload(state),
      });
      onSaved(updated);
      dispatch({ type: "SAVED" });
    } catch (err: unknown) {
      dispatch({
        type: "ERROR",
        message: err instanceof Error ? err.message : "Sauvegarde impossible.",
      });
    }
  }, [doc.id, state, onSaved]);

  const hypoId = useId();

  return (
    <div className="flex flex-col gap-5">
      {/* warning: saving will reset approval */}
      {willTriggerApproval && (
        <div className="flex items-start gap-2.5 rounded-[8px] border border-hot/40 bg-hot-bg px-3 py-2.5 text-[12px] text-hot">
          <AlertTriangle size={14} strokeWidth={2.2} className="mt-px flex-none" aria-hidden />
          <span>
            Ce document est <strong>{doc.status === "approved" ? "approuvé" : "envoyé"}</strong>.
            Toute modification de contenu le repassera en validation.
          </span>
        </div>
      )}

      {/* line items table */}
      <div>
        <span className="micro mb-2 block">Lignes du devis</span>
        <div className="overflow-hidden rounded-[9px] border border-line">
          {/* header */}
          <div className="grid grid-cols-[1fr_56px_72px_88px_88px_36px] gap-1.5 border-b border-line-soft bg-bg-2 px-3 py-2">
            {["Désignation", "Qté", "Unité", "P.U. HT", "Total HT", ""].map((h, i) => (
              <span
                key={i}
                className={cn(
                  "disp text-[10px] font-semibold uppercase tracking-[0.08em] text-text3",
                  i >= 3 && i <= 4 && "text-right",
                )}
              >
                {h}
              </span>
            ))}
          </div>

          {/* rows */}
          {state.lines.length === 0 && (
            <div className="px-3 py-4 text-center text-[12px] text-text3">
              Aucune ligne — ajoutez une prestation ci-dessous.
            </div>
          )}
          {state.lines.map((line, idx) => (
            <LineRow
              key={idx}
              line={line}
              index={idx}
              dispatch={dispatch}
            />
          ))}

          {/* add row */}
          <div className="border-t border-line-soft bg-bg-2/40 px-3 py-2">
            <button
              type="button"
              onClick={() => dispatch({ type: "ADD_LINE" })}
              className="flex items-center gap-1.5 text-[12px] font-medium text-text3 transition-colors hover:text-amber-2"
            >
              <Plus size={14} strokeWidth={2.5} aria-hidden />
              Ajouter une ligne
            </button>
          </div>
        </div>
      </div>

      {/* TVA rate */}
      <div className="flex items-center gap-3">
        <span className="micro whitespace-nowrap">Taux de TVA</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={state.tva_rate * 100}
            onChange={(e) =>
              dispatch({
                type: "SET_TVA_RATE",
                value: parseFloat(e.target.value) / 100 || 0,
              })
            }
            className="mono tnum w-[72px] rounded-[7px] border border-line-soft bg-bg-2 px-2 py-1.5 text-right text-[12.5px] text-text2 outline-none focus:border-amber-line"
          />
          <span className="text-[12.5px] text-text3">%</span>
        </div>
      </div>

      {/* totals */}
      <div className="ml-auto w-full max-w-[280px] rounded-[9px] border border-line bg-bg-2 px-3.5 py-3">
        <TotalRow label="Total HT" value={EUR.format(totals.total_ht)} />
        <TotalRow label={`TVA (${tvaPct})`} value={EUR.format(totals.total_tva)} />
        <div className="my-2 h-px bg-line-soft" />
        <TotalRow label="Total TTC" value={EUR.format(totals.total_ttc)} strong />
      </div>

      {/* hypotheses */}
      <div>
        <label htmlFor={hypoId} className="micro mb-1.5 block">
          Hypothèses (une par ligne)
        </label>
        <textarea
          id={hypoId}
          rows={4}
          value={state.hypotheses.join("\n")}
          onChange={(e) => dispatch({ type: "SET_HYPOTHESES", value: e.target.value })}
          placeholder="Ex: Prix hors fournitures électriques&#10;Ex: Accès chantier en journée"
          className="mono w-full resize-y rounded-[8px] border border-line-soft bg-bg-2 px-3 py-2.5 text-[12px] leading-relaxed text-text2 outline-none placeholder:text-text3 focus:border-amber-line"
        />
      </div>

      {/* error */}
      {state.error && (
        <div className="flex items-start gap-2 rounded-[8px] border border-stop-bg bg-stop-bg px-3 py-2.5 text-[12px] text-stop">
          <AlertTriangle size={14} strokeWidth={2.2} className="mt-px flex-none" aria-hidden />
          <span>{state.error}</span>
        </div>
      )}

      {/* save bar */}
      <div className="flex items-center justify-between gap-3 border-t border-line-soft pt-3">
        <span className="text-[11.5px] text-text3">
          {state.saved
            ? "Modifications enregistrées."
            : state.dirty
              ? "Modifications non enregistrées."
              : "Aucune modification en cours."}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!state.dirty || state.saving}
          className={cn(
            "disp flex items-center gap-1.5 rounded-[8px] px-4 py-2 text-[12px] font-semibold transition-colors",
            state.dirty && !state.saving
              ? "bg-amber text-amber-fg hover:bg-amber-2"
              : "cursor-not-allowed bg-bg-3 text-text3",
          )}
        >
          {state.saving ? (
            <Spinner size={14} />
          ) : (
            <Save size={14} strokeWidth={2.2} aria-hidden />
          )}
          Enregistrer
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* line row sub-component                                              */
/* ------------------------------------------------------------------ */

function LineRow({
  line,
  index,
  dispatch,
}: {
  line: QuoteLine;
  index: number;
  dispatch: React.Dispatch<QuoteAction>;
}) {
  function set(field: keyof QuoteLine, value: string | number) {
    dispatch({ type: "SET_LINE", index, field, value });
  }

  return (
    <div className="grid grid-cols-[1fr_56px_72px_88px_88px_36px] items-center gap-1.5 border-t border-line-soft px-3 py-2">
      {/* designation */}
      <input
        type="text"
        value={line.label}
        onChange={(e) => set("label", e.target.value)}
        placeholder="Libellé de la prestation"
        className="min-w-0 rounded-[6px] border border-transparent bg-transparent px-1.5 py-1 text-[12.5px] text-text outline-none transition-colors hover:border-line-soft focus:border-amber-line focus:bg-bg-2"
      />

      {/* qty */}
      <input
        type="number"
        min={0}
        step="any"
        value={line.qty}
        onChange={(e) => set("qty", parseFloat(e.target.value) || 0)}
        className="mono tnum rounded-[6px] border border-transparent bg-transparent px-1.5 py-1 text-right text-[12px] text-text2 outline-none transition-colors hover:border-line-soft focus:border-amber-line focus:bg-bg-2"
      />

      {/* unit */}
      <input
        type="text"
        value={line.unit}
        onChange={(e) => set("unit", e.target.value)}
        className="mono rounded-[6px] border border-transparent bg-transparent px-1.5 py-1 text-right text-[12px] text-text3 outline-none transition-colors hover:border-line-soft focus:border-amber-line focus:bg-bg-2"
      />

      {/* unit price */}
      <input
        type="number"
        min={0}
        step="any"
        value={line.unit_price_ht}
        onChange={(e) => set("unit_price_ht", parseFloat(e.target.value) || 0)}
        className="mono tnum rounded-[6px] border border-transparent bg-transparent px-1.5 py-1 text-right text-[12px] text-text2 outline-none transition-colors hover:border-line-soft focus:border-amber-line focus:bg-bg-2"
      />

      {/* computed total (read-only) */}
      <span className="mono tnum px-1.5 text-right text-[12px] text-text">
        {line.total_ht.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>

      {/* delete */}
      <button
        type="button"
        onClick={() => dispatch({ type: "REMOVE_LINE", index })}
        aria-label="Supprimer cette ligne"
        className="grid place-items-center rounded-[6px] p-1.5 text-text3 transition-colors hover:bg-stop-bg hover:text-stop"
      >
        <Trash2 size={13} strokeWidth={2.2} aria-hidden />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* totals display row                                                  */
/* ------------------------------------------------------------------ */

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
