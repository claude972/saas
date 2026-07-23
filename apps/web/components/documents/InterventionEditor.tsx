"use client";

import { useCallback, useMemo, useState } from "react";
import { ImagePlus, Plus, Save, Trash2, X } from "lucide-react";
import type { AppDocument, JsonObject } from "@/lib/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/Spinner";

const TYPE_OPTIONS = ["Diagnostic", "Installation", "Maintenance", "Dépannage"];
const TRAVAUX_OPTIONS = [
  "Étude / Diagnostic",
  "Installation",
  "Modification",
  "Mise en conformité",
  "Maintenance préventive",
  "Dépannage",
];
const PHOTO_SLOTS = ["Avant intervention", "Pendant l'intervention", "Après intervention"];

const inputCls = cn(
  "w-full rounded-[9px] border border-line bg-bg-2 px-3 py-2.5 text-[13px] text-text",
  "placeholder:text-text3 outline-none transition-colors focus:border-amber-line",
);
const labelCls = "disp text-[10px] font-semibold uppercase tracking-[0.1em] text-text3 mb-1.5 block";

interface PhotoItem {
  caption: string;
  url?: string;
  description?: string;
}
interface MaterielRow {
  designation?: string;
  reference?: string;
  quantite?: string;
}

/** Load an image file, resize to <=1400px and return a compressed JPEG data URI. */
function fileToCompressedDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxDim = 1400;
      let { width, height } = img;
      if (width >= height && width > maxDim) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else if (height > width && height > maxDim) {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas indisponible"));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image illisible"));
    };
    img.src = url;
  });
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asStrList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function InterventionEditor({
  doc,
  onSaved,
}: {
  doc: AppDocument;
  onSaved: (updated: AppDocument) => void;
}) {
  const content = useMemo(() => (doc.content ?? {}) as JsonObject, [doc.content]);

  const [f, setF] = useState(() => ({
    reference: asStr(content.reference),
    client_name: asStr(content.client_name),
    client_phone: asStr(content.client_phone),
    client_email: asStr(content.client_email),
    intervention_address: asStr(content.intervention_address),
    date_intervention: asStr(content.date_intervention),
    heure_arrivee: asStr(content.heure_arrivee),
    heure_depart: asStr(content.heure_depart),
    technicien: asStr(content.technicien),
    fonction: asStr(content.fonction),
    meteo: asStr(content.meteo),
    objet: asStr(content.objet),
    commentaires: asStr(content.commentaires),
    reserves: asStr(content.reserves),
  }));
  const [typeChecked, setTypeChecked] = useState<string[]>(asStrList(content.type_checked));
  const [travauxChecked, setTravauxChecked] = useState<string[]>(asStrList(content.travaux_checked));
  const [photos, setPhotos] = useState<PhotoItem[]>(() => {
    const raw = Array.isArray(content.photos) ? (content.photos as unknown as PhotoItem[]) : [];
    return PHOTO_SLOTS.map((caption, i) => ({
      caption: asStr(raw[i]?.caption) || caption,
      url: asStr(raw[i]?.url) || undefined,
      description: asStr(raw[i]?.description),
    }));
  });
  const [materiel, setMateriel] = useState<MaterielRow[]>(() => {
    const raw = Array.isArray(content.materiel) ? (content.materiel as unknown as MaterielRow[]) : [];
    return raw.length ? raw : [{ designation: "", reference: "", quantite: "" }];
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (k: keyof typeof f) => (v: string) => {
    setF((s) => ({ ...s, [k]: v }));
    setSaved(false);
  };
  const toggle = (list: string[], setList: (v: string[]) => void, opt: string) => {
    setList(list.includes(opt) ? list.filter((x) => x !== opt) : [...list, opt]);
    setSaved(false);
  };

  const onPhoto = useCallback(async (i: number, file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const url = await fileToCompressedDataUri(file);
      setPhotos((prev) => prev.map((p, idx) => (idx === i ? { ...p, url } : p)));
      setSaved(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo illisible.");
    }
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const newContent = {
        ...content,
        ...f,
        type_checked: typeChecked,
        travaux_checked: travauxChecked,
        photos,
        materiel,
      } as unknown as JsonObject;
      const updated = await api.updateDocument(doc.id, { content: newContent });
      onSaved(updated);
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sauvegarde impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Informations */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Référence / N° d'affaire" value={f.reference} onChange={set("reference")} placeholder="#2026-2A61" />
        <Field label="Adresse d'intervention" value={f.intervention_address} onChange={set("intervention_address")} />
        <Field label="Client" value={f.client_name} onChange={set("client_name")} />
        <Field label="Email client" value={f.client_email} onChange={set("client_email")} />
        <Field label="Téléphone client" value={f.client_phone} onChange={set("client_phone")} />
        <Field label="Date d'intervention" value={f.date_intervention} onChange={set("date_intervention")} placeholder="23/07/2026" />
        <Field label="Heure d'arrivée" value={f.heure_arrivee} onChange={set("heure_arrivee")} placeholder="08:30" />
        <Field label="Heure de départ" value={f.heure_depart} onChange={set("heure_depart")} placeholder="12:00" />
        <Field label="Technicien" value={f.technicien} onChange={set("technicien")} />
        <Field label="Fonction" value={f.fonction} onChange={set("fonction")} />
        <Field label="Météo / Conditions" value={f.meteo} onChange={set("meteo")} />
      </div>

      <Checks label="Type d'intervention" options={TYPE_OPTIONS} checked={typeChecked} onToggle={(o) => toggle(typeChecked, setTypeChecked, o)} />

      <div>
        <span className={labelCls}>Objet de l'intervention</span>
        <textarea value={f.objet} onChange={(e) => set("objet")(e.target.value)} rows={3} className={cn(inputCls, "resize-none")} />
      </div>

      <Checks label="Travaux réalisés" options={TRAVAUX_OPTIONS} checked={travauxChecked} onToggle={(o) => toggle(travauxChecked, setTravauxChecked, o)} />

      <div>
        <span className={labelCls}>Commentaires généraux</span>
        <textarea value={f.commentaires} onChange={(e) => set("commentaires")(e.target.value)} rows={2} className={cn(inputCls, "resize-none")} />
      </div>

      {/* Photos */}
      <div>
        <span className={labelCls}>Photos de l'intervention</span>
        <div className="grid grid-cols-3 gap-3">
          {photos.map((p, i) => (
            <div key={i} className="flex flex-col gap-2">
              <span className="text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-text3">{p.caption}</span>
              <label className="relative grid aspect-[3/4] cursor-pointer place-items-center overflow-hidden rounded-[8px] border border-dashed border-line bg-bg-2 text-text3 transition-colors hover:border-amber-line">
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={p.caption} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex flex-col items-center gap-1.5 text-[10px] uppercase tracking-[0.08em]">
                    <ImagePlus size={22} strokeWidth={1.8} aria-hidden />
                    Ajouter
                  </span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(e) => onPhoto(i, e.target.files?.[0] ?? null)}
                />
              </label>
              {p.url && (
                <button
                  type="button"
                  onClick={() => setPhotos((prev) => prev.map((pp, idx) => (idx === i ? { ...pp, url: undefined } : pp)))}
                  className="flex items-center justify-center gap-1 text-[10.5px] text-text3 transition-colors hover:text-stop"
                >
                  <X size={11} strokeWidth={2.4} aria-hidden /> Retirer
                </button>
              )}
              <input
                type="text"
                value={p.description ?? ""}
                onChange={(e) => setPhotos((prev) => prev.map((pp, idx) => (idx === i ? { ...pp, description: e.target.value } : pp)))}
                placeholder="Description…"
                className={cn(inputCls, "px-2.5 py-1.5 text-[12px]")}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Matériel */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className={cn(labelCls, "mb-0")}>Matériel utilisé</span>
          <button
            type="button"
            onClick={() => setMateriel((m) => [...m, { designation: "", reference: "", quantite: "" }])}
            className="flex items-center gap-1 text-[11px] font-semibold text-amber-2 transition-colors hover:text-amber"
          >
            <Plus size={13} strokeWidth={2.4} aria-hidden /> Ligne
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {materiel.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="text" value={row.designation ?? ""} placeholder="Désignation" onChange={(e) => setMateriel((m) => m.map((r, idx) => (idx === i ? { ...r, designation: e.target.value } : r)))} className={cn(inputCls, "flex-[2] px-2.5 py-1.5 text-[12px]")} />
              <input type="text" value={row.reference ?? ""} placeholder="Réf." onChange={(e) => setMateriel((m) => m.map((r, idx) => (idx === i ? { ...r, reference: e.target.value } : r)))} className={cn(inputCls, "flex-1 px-2.5 py-1.5 text-[12px]")} />
              <input type="text" value={row.quantite ?? ""} placeholder="Qté" onChange={(e) => setMateriel((m) => m.map((r, idx) => (idx === i ? { ...r, quantite: e.target.value } : r)))} className={cn(inputCls, "w-16 px-2.5 py-1.5 text-[12px]")} />
              <button type="button" onClick={() => setMateriel((m) => (m.length > 1 ? m.filter((_, idx) => idx !== i) : m))} className="flex-none text-text3 transition-colors hover:text-stop" aria-label="Supprimer la ligne">
                <Trash2 size={15} strokeWidth={2} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <span className={labelCls}>Réserves / Observations / Actions à prévoir</span>
        <textarea value={f.reserves} onChange={(e) => set("reserves")(e.target.value)} rows={3} className={cn(inputCls, "resize-none")} />
      </div>

      {error && <div className="text-[12px] text-stop">{error}</div>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 rounded-[8px] bg-amber px-4 py-2 font-[var(--font-saira)] text-[12px] font-semibold tracking-[0.04em] text-[color:var(--amber-fg)] transition-colors hover:bg-amber-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Spinner size={14} /> : <Save size={14} strokeWidth={2.2} aria-hidden />}
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        {saved && <span className="text-[12px] text-ok">Enregistré ✓</span>}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
    </label>
  );
}

function Checks({
  label,
  options,
  checked,
  onToggle,
}: {
  label: string;
  options: string[];
  checked: string[];
  onToggle: (opt: string) => void;
}) {
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = checked.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onToggle(o)}
              className={cn(
                "rounded-[7px] border px-3 py-1.5 text-[12px] font-medium transition-colors",
                on
                  ? "border-amber-line bg-amber-bg text-amber-2"
                  : "border-line bg-bg-2 text-text2 hover:border-amber-line",
              )}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
