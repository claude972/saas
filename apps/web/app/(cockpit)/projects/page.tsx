"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Building,
  Home,
  School,
  Warehouse,
  Plus,
  X,
  ArrowRight,
  RotateCw,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type { CreateProjectInput, Project } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/Spinner";

/* ------------------------------------------------------------------
   Projects page — lists projects (api.listProjects), lets the operator
   create a new one (api.createProject via a simple modal). Each row links
   to /projects/{id}. Styled after design/cockpit-dashboard.html (.proj).
   ------------------------------------------------------------------ */

// Status presentation (project statuses are not in StatusChip's map, so we
// render a small dot + FR label inline, matching the maquette's .pmeta style).
const STATUS_META: Record<string, { label: string; color: string }> = {
  active: { label: "Actif", color: "var(--ok)" },
  on_hold: { label: "En pause", color: "var(--amber)" },
  archived: { label: "Archivé", color: "var(--text-3)" },
};

// Pick an icon echoing the maquette, keyed off project_type keywords.
function projectIcon(project: Project): LucideIcon {
  const t = `${project.project_type ?? ""}`.toLowerCase();
  if (/(scol|école|ecole|school|collège|college|lycée|lycee)/.test(t)) {
    return School;
  }
  if (/(entrepôt|entrepot|warehouse|logist|hangar|stock)/.test(t)) {
    return Warehouse;
  }
  if (/(villa|maison|home|pavillon|rénovation|renovation|intérieur|interieur)/.test(t)) {
    return Home;
  }
  if (/(copro|immeuble|façade|facade|ravalement|building|résidence|residence)/.test(t)) {
    return Building;
  }
  return Building2;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.listProjects();
      setProjects(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement.");
      setProjects((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreated = useCallback((created: Project) => {
    setProjects((prev) => (prev ? [created, ...prev] : [created]));
    setModalOpen(false);
  }, []);

  const loading = projects === null;
  const count = projects?.length ?? 0;

  return (
    <div className="flex flex-col gap-5 px-[22px] py-[18px]">
      {/* Page header */}
      <div className="flex items-center gap-2.5">
        <Building2 size={17} strokeWidth={2} className="text-amber" aria-hidden />
        <h1 className="disp text-xs font-semibold uppercase tracking-[0.1em] text-text2">
          Projets
        </h1>
        {!loading && <span className="mono text-[11px] text-text3">{count}</span>}
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="ml-auto flex h-9 items-center gap-2 rounded-[9px] bg-amber px-4 font-[var(--font-saira)] text-[12.5px] font-semibold tracking-[0.04em] text-[color:var(--amber-fg)] transition-colors hover:bg-amber-2"
        >
          <Plus size={16} strokeWidth={2.4} aria-hidden />
          Nouveau projet
        </button>
      </div>

      {/* Error banner (non-blocking: list may still render below) */}
      {error && (
        <div className="flex items-center gap-2.5 rounded-[10px] border border-line bg-stop-bg px-3.5 py-2.5 text-[12.5px] text-stop">
          <AlertTriangle size={15} strokeWidth={2.2} className="flex-none" aria-hidden />
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="mono flex flex-none items-center gap-1.5 rounded-[6px] border border-line px-2.5 py-1 text-[11px] text-text2 transition-colors hover:text-text"
          >
            <RotateCw size={12} strokeWidth={2.2} aria-hidden />
            Réessayer
          </button>
        </div>
      )}

      {/* Body states */}
      {loading ? (
        <div className="grid place-items-center rounded-[11px] border border-line bg-panel py-20">
          <Spinner size={26} />
        </div>
      ) : count === 0 ? (
        <EmptyState onCreate={() => setModalOpen(true)} />
      ) : (
        <div className="flex flex-col gap-2.5">
          {projects!.map((p, i) => (
            <ProjectRow key={p.id} project={p} index={i} />
          ))}
        </div>
      )}

      {modalOpen && (
        <NewProjectModal
          onClose={() => setModalOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProjectRow({ project, index }: { project: Project; index: number }) {
  const Icon = projectIcon(project);
  const status = STATUS_META[project.status] ?? {
    label: project.status,
    color: "var(--text-3)",
  };

  return (
    <Link
      href={`/projects/${project.id}`}
      className="oc-fade group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[13px] rounded-[10px] border border-line bg-panel px-3.5 py-3 transition-colors hover:border-amber-line hover:bg-bg-2"
      style={{ animationDelay: `${Math.min(index, 12) * 0.03}s` }}
    >
      <span className="grid h-9 w-9 flex-none place-items-center rounded-[8px] bg-bg-3 text-text2 transition-colors group-hover:text-amber">
        <Icon size={18} strokeWidth={2} aria-hidden />
      </span>

      <span className="min-w-0">
        <span className="mb-[3px] block truncate text-[13px] font-medium text-text">
          {project.name}
        </span>
        <span className="flex items-center gap-2 text-[11px] text-text3">
          <span className="truncate">{project.client_name}</span>
          {project.project_type && (
            <>
              <Dot />
              <span className="truncate">{project.project_type}</span>
            </>
          )}
          {project.address && (
            <>
              <Dot />
              <span className="truncate">{project.address}</span>
            </>
          )}
        </span>
      </span>

      <span className="flex flex-none items-center gap-3">
        <span className="flex items-center gap-2">
          <span
            className="h-[7px] w-[7px] flex-none rounded-full"
            style={{ backgroundColor: status.color }}
            aria-hidden
          />
          <span className="disp text-[10px] font-semibold uppercase tracking-[0.08em] text-text3">
            {status.label}
          </span>
        </span>
        <ArrowRight
          size={16}
          strokeWidth={2}
          className="text-text3 transition-colors group-hover:text-amber-2"
          aria-hidden
        />
      </span>
    </Link>
  );
}

function Dot() {
  return (
    <span
      className="h-[3px] w-[3px] flex-none rounded-full bg-text3"
      aria-hidden
    />
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[11px] border border-dashed border-line bg-panel py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-[10px] bg-bg-3 text-text3">
        <Building2 size={24} strokeWidth={1.8} aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="disp text-[13px] font-semibold uppercase tracking-[0.08em] text-text2">
          Aucun projet
        </p>
        <p className="max-w-xs text-[12.5px] text-text3">
          Créez un premier chantier pour qu&apos;OpenClaw puisse y rattacher
          tâches, devis et comptes-rendus.
        </p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="flex h-9 items-center gap-2 rounded-[9px] bg-amber px-4 font-[var(--font-saira)] text-[12.5px] font-semibold tracking-[0.04em] text-[color:var(--amber-fg)] transition-colors hover:bg-amber-2"
      >
        <Plus size={16} strokeWidth={2.4} aria-hidden />
        Nouveau projet
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------
   Creation modal — styled after the command-center inputs.
   ------------------------------------------------------------------ */

const EMPTY_FORM: CreateProjectInput = {
  name: "",
  client_name: "",
  address: "",
  project_type: "",
  description: "",
};

function NewProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const [form, setForm] = useState<CreateProjectInput>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => form.name.trim().length > 0 && form.client_name.trim().length > 0,
    [form.name, form.client_name],
  );

  // Close on Escape for keyboard parity.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  function update<K extends keyof CreateProjectInput>(
    key: K,
    value: string,
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createProject({
        name: form.name.trim(),
        client_name: form.client_name.trim(),
        address: form.address?.trim() || null,
        project_type: form.project_type?.trim() || null,
        description: form.description?.trim() || null,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[oklch(0.12_0.006_68_/_0.62)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="oc-fade relative w-full max-w-[480px] overflow-hidden rounded-[12px] border border-line bg-bg-1 shadow-2xl">
        <span className="absolute inset-y-0 left-0 w-[3px] bg-amber" aria-hidden />

        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-line-soft px-[18px] py-3.5">
          <Building2 size={16} strokeWidth={2} className="text-amber" aria-hidden />
          <h2
            id="new-project-title"
            className="disp text-[11.5px] font-semibold uppercase tracking-[0.13em] text-amber-2"
          >
            Nouveau projet
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Fermer"
            className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] text-text2 transition-colors hover:bg-bg-2 hover:text-text disabled:opacity-50"
          >
            <X size={16} strokeWidth={2.2} aria-hidden />
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3.5 px-[18px] py-4">
          <Field
            label="Nom du chantier"
            required
            value={form.name}
            onChange={(v) => update("name", v)}
            placeholder="Ex : Chantier Villa Ducos"
            autoFocus
          />
          <Field
            label="Client"
            required
            value={form.client_name}
            onChange={(v) => update("client_name", v)}
            placeholder="Ex : M. & Mme Ducos"
          />
          <div className="grid grid-cols-2 gap-3.5">
            <Field
              label="Type de projet"
              value={form.project_type ?? ""}
              onChange={(v) => update("project_type", v)}
              placeholder="Rénovation intérieure"
            />
            <Field
              label="Adresse"
              value={form.address ?? ""}
              onChange={(v) => update("address", v)}
              placeholder="Ducos, 97224"
            />
          </div>
          <Field
            label="Description"
            value={form.description ?? ""}
            onChange={(v) => update("description", v)}
            placeholder="Portée des travaux, notes…"
            textarea
          />

          {error && (
            <div className="flex items-center gap-2 rounded-[8px] border border-line bg-stop-bg px-3 py-2 text-[12px] text-stop">
              <AlertTriangle size={14} strokeWidth={2.2} className="flex-none" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-1 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-[8px] border border-line px-3.5 py-2 font-[var(--font-saira)] text-[12px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:bg-bg-2 hover:text-text disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="flex items-center gap-2 rounded-[8px] bg-amber px-4 py-2 font-[var(--font-saira)] text-[12px] font-semibold tracking-[0.04em] text-[color:var(--amber-fg)] transition-colors hover:bg-amber-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Spinner size={14} />}
              {submitting ? "Création…" : "Créer le projet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  textarea = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  textarea?: boolean;
  autoFocus?: boolean;
}) {
  const shared = cn(
    "w-full rounded-[9px] border border-line bg-bg-2 px-3 py-2.5 text-[13px] text-text",
    "placeholder:text-text3 outline-none transition-colors",
    "focus:border-amber-line",
  );

  return (
    <label className="flex flex-col gap-1.5">
      <span className="disp text-[10px] font-semibold uppercase tracking-[0.1em] text-text3">
        {label}
        {required && <span className="ml-1 text-amber-2">*</span>}
      </span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={cn(shared, "resize-none leading-[1.55]")}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          autoFocus={autoFocus}
          className={shared}
        />
      )}
    </label>
  );
}
