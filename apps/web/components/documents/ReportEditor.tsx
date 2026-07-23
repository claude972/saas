"use client";

import { useCallback, useEffect, useId, useReducer, useRef } from "react";
import { AlertTriangle, Save } from "lucide-react";
import type { AppDocument, JsonObject } from "@/lib/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/Spinner";

/* ------------------------------------------------------------------ */
/* per-type section configs                                            */
/* ------------------------------------------------------------------ */

type FieldType = "text" | "textarea" | "list";

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
}

const FIELD_CONFIGS: Record<string, FieldDef[]> = {
  intervention: [
    { key: "reference", label: "Référence / N° d'affaire", type: "text", placeholder: "#2026-2A61" },
    { key: "client_name", label: "Client", type: "text" },
    { key: "client_phone", label: "Téléphone client", type: "text" },
    { key: "client_email", label: "Email client", type: "text" },
    { key: "intervention_address", label: "Adresse d'intervention", type: "text" },
    { key: "date_intervention", label: "Date d'intervention", type: "text", placeholder: "23/07/2026" },
    { key: "heure_arrivee", label: "Heure d'arrivée", type: "text", placeholder: "08:30" },
    { key: "heure_depart", label: "Heure de départ", type: "text", placeholder: "12:00" },
    { key: "technicien", label: "Technicien intervenant", type: "text" },
    { key: "fonction", label: "Fonction", type: "text" },
    { key: "meteo", label: "Météo / Conditions", type: "text" },
    { key: "type_checked", label: "Type d'intervention (cochés)", type: "list", placeholder: "Un type par ligne : Diagnostic, Installation, Maintenance, Dépannage" },
    { key: "objet", label: "Objet de l'intervention", type: "textarea", placeholder: "Décrivez l'objet de l'intervention…" },
    { key: "travaux_checked", label: "Travaux réalisés (cochés)", type: "list", placeholder: "Un travail par ligne : Installation, Mise en conformité…" },
    { key: "commentaires", label: "Commentaires généraux", type: "textarea" },
    { key: "reserves", label: "Réserves / Observations / Actions à prévoir", type: "textarea" },
  ],
  tender_response: [
    {
      key: "pieces_demandees",
      label: "Pièces à remettre",
      type: "list",
      placeholder: "Une pièce par ligne",
    },
    {
      key: "criteres",
      label: "Critères de sélection",
      type: "list",
      placeholder: "Un critère par ligne",
    },
    {
      key: "delais",
      label: "Délais",
      type: "text",
      placeholder: "Ex: 45 jours",
    },
    {
      key: "points_vigilance",
      label: "Points de vigilance",
      type: "list",
      placeholder: "Un point par ligne",
    },
  ],
  site_report: [
    {
      key: "date",
      label: "Date de visite",
      type: "text",
      placeholder: "Ex: 14/06/2026",
    },
    {
      key: "present",
      label: "Présents",
      type: "list",
      placeholder: "Un participant par ligne",
    },
    {
      key: "constats",
      label: "Constats",
      type: "list",
      placeholder: "Un constat par ligne",
    },
    {
      key: "actions",
      label: "Actions à mener",
      type: "list",
      placeholder: "Une action par ligne",
    },
    {
      key: "reserves",
      label: "Réserves",
      type: "list",
      placeholder: "Une réserve par ligne",
    },
  ],
  photo_report: [
    {
      key: "observations",
      label: "Observations générales",
      type: "textarea",
      placeholder: "Décrivez les observations issues de l'analyse photo…",
    },
    {
      key: "travaux_visibles",
      label: "Travaux visibles",
      type: "list",
      placeholder: "Un élément par ligne",
    },
    {
      key: "points_attention",
      label: "Points d'attention",
      type: "list",
      placeholder: "Un point par ligne",
    },
  ],
};

// Fallback: display all top-level string/string[] fields as editables
function inferFields(content: JsonObject): FieldDef[] {
  return Object.keys(content).map((key) => {
    const v = content[key];
    const type: FieldType = Array.isArray(v) ? "list" : "textarea";
    return { key, label: key, type, placeholder: "" };
  });
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

interface ReportState {
  fields: Record<string, string>;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

type ReportAction =
  | { type: "SET_FIELD"; key: string; value: string }
  | { type: "SAVING" }
  | { type: "SAVED" }
  | { type: "ERROR"; message: string }
  | { type: "RESET"; fields: Record<string, string> };

function contentToFields(content: JsonObject, fieldDefs: FieldDef[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of fieldDefs) {
    const v = content[def.key];
    if (Array.isArray(v)) {
      out[def.key] = v.map((s) => (typeof s === "string" ? s : String(s))).join("\n");
    } else if (v !== null && v !== undefined) {
      out[def.key] = typeof v === "string" ? v : String(v);
    } else {
      out[def.key] = "";
    }
  }
  return out;
}

function fieldsToContent(
  fields: Record<string, string>,
  fieldDefs: FieldDef[],
  original: JsonObject,
): JsonObject {
  const result: JsonObject = { ...original };
  for (const def of fieldDefs) {
    const raw = fields[def.key] ?? "";
    if (def.type === "list") {
      result[def.key] = raw
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else {
      result[def.key] = raw;
    }
  }
  return result;
}

function reducer(state: ReportState, action: ReportAction): ReportState {
  switch (action.type) {
    case "SET_FIELD":
      return {
        ...state,
        fields: { ...state.fields, [action.key]: action.value },
        dirty: true,
        saved: false,
      };
    case "SAVING":
      return { ...state, saving: true, error: null };
    case "SAVED":
      return { ...state, saving: false, dirty: false, saved: true, error: null };
    case "ERROR":
      return { ...state, saving: false, error: action.message };
    case "RESET":
      return { fields: action.fields, dirty: false, saving: false, error: null, saved: false };
    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

interface ReportEditorProps {
  doc: AppDocument;
  onSaved: (updated: AppDocument) => void;
}

export function ReportEditor({ doc, onSaved }: ReportEditorProps) {
  const content = (doc.content ?? {}) as JsonObject;
  const fieldDefs =
    FIELD_CONFIGS[doc.document_type] ?? inferFields(content);

  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    fields: contentToFields(content, fieldDefs),
    dirty: false,
    saving: false,
    error: null,
    saved: false,
  }));

  // Re-init on doc change
  const docIdRef = useRef(doc.id);
  useEffect(() => {
    if (doc.id === docIdRef.current) return;
    docIdRef.current = doc.id;
    const c = (doc.content ?? {}) as JsonObject;
    const defs = FIELD_CONFIGS[doc.document_type] ?? inferFields(c);
    dispatch({ type: "RESET", fields: contentToFields(c, defs) });
  }, [doc.id, doc.content, doc.document_type]);

  const willTriggerApproval =
    state.dirty && (doc.status === "approved" || doc.status === "sent");

  const handleSave = useCallback(async () => {
    dispatch({ type: "SAVING" });
    try {
      const newContent = fieldsToContent(state.fields, fieldDefs, content);
      const updated = await api.updateDocument(doc.id, { content: newContent });
      onSaved(updated);
      dispatch({ type: "SAVED" });
    } catch (err: unknown) {
      dispatch({
        type: "ERROR",
        message: err instanceof Error ? err.message : "Sauvegarde impossible.",
      });
    }
  }, [doc.id, state.fields, fieldDefs, content, onSaved]);

  return (
    <div className="flex flex-col gap-4">
      {willTriggerApproval && (
        <div className="flex items-start gap-2.5 rounded-[8px] border border-hot/40 bg-hot-bg px-3 py-2.5 text-[12px] text-hot">
          <AlertTriangle size={14} strokeWidth={2.2} className="mt-px flex-none" aria-hidden />
          <span>
            Ce document est{" "}
            <strong>{doc.status === "approved" ? "approuvé" : "envoyé"}</strong>.
            Toute modification de contenu le repassera en validation.
          </span>
        </div>
      )}

      {fieldDefs.map((def) => (
        <FieldEditor
          key={def.key}
          def={def}
          value={state.fields[def.key] ?? ""}
          onChange={(v) => dispatch({ type: "SET_FIELD", key: def.key, value: v })}
        />
      ))}

      {state.error && (
        <div className="flex items-start gap-2 rounded-[8px] border border-stop-bg bg-stop-bg px-3 py-2.5 text-[12px] text-stop">
          <AlertTriangle size={14} strokeWidth={2.2} className="mt-px flex-none" aria-hidden />
          <span>{state.error}</span>
        </div>
      )}

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
/* field editor                                                        */
/* ------------------------------------------------------------------ */

function FieldEditor({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const inputClass =
    "w-full rounded-[8px] border border-line-soft bg-bg-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-text2 outline-none placeholder:text-text3 focus:border-amber-line";

  return (
    <div>
      <label htmlFor={id} className="micro mb-1.5 block">
        {def.label}
        {def.type === "list" && (
          <span className="ml-1 font-normal normal-case tracking-normal text-text3">
            (une entrée par ligne)
          </span>
        )}
      </label>
      {def.type === "text" ? (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
          className={inputClass}
        />
      ) : (
        <textarea
          id={id}
          rows={def.type === "textarea" ? 5 : 4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
          className={`${inputClass} mono resize-y`}
        />
      )}
    </div>
  );
}
