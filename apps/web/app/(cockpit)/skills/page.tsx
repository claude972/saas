"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Inbox,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Skill, SkillCreateInput, SkillSource, SkillUpdateInput } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ */
/* Slug auto-generation from name                                        */
/* ------------------------------------------------------------------ */

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/* ------------------------------------------------------------------ */
/* Source badge                                                          */
/* ------------------------------------------------------------------ */

function SourceBadge({ source }: { source: SkillSource | string }) {
  const isAnthropic = source === "anthropic";
  return (
    <span
      className={cn(
        "mono inline-flex items-center gap-1 rounded-[6px] px-[7px] py-[2px] text-[10.5px] font-medium",
        isAnthropic
          ? "bg-amber-bg text-amber-2"
          : "bg-bg-3 text-text3",
      )}
    >
      {isAnthropic ? "anthropic" : "maison"}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Toggle switch (reused pattern from agents page)                       */
/* ------------------------------------------------------------------ */

function Toggle({
  on,
  busy,
  onClick,
  label,
}: {
  on: boolean;
  busy: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${on ? "Désactiver" : "Activer"} le skill ${label}`}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "relative h-[17px] w-[30px] flex-none rounded-[10px] transition-colors disabled:opacity-60",
        on ? "bg-ok" : "bg-bg-3",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] h-[13px] w-[13px] rounded-full bg-[var(--bg)] transition-[left]",
          on ? "left-[15px]" : "left-[2px]",
        )}
        aria-hidden
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Skill form (create + edit)                                            */
/* ------------------------------------------------------------------ */

interface FormValues {
  name: string;
  slug: string;
  description: string;
  source: SkillSource;
  instructions: string;
  anthropic_skill_id: string;
}

const EMPTY_FORM: FormValues = {
  name: "",
  slug: "",
  description: "",
  source: "maison",
  instructions: "",
  anthropic_skill_id: "",
};

function skillToForm(skill: Skill): FormValues {
  return {
    name: skill.name,
    slug: skill.slug,
    description: skill.description ?? "",
    source: (skill.source as SkillSource) ?? "maison",
    instructions: skill.instructions ?? "",
    anthropic_skill_id: skill.anthropic_skill_id ?? "",
  };
}

function SkillForm({
  initial,
  slugLocked,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  slugLocked: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>(initial);
  const slugTouched = useRef(slugLocked); // once slug is locked (edit), mark as touched

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-generate slug from name unless the user has touched it.
      if (key === "name" && !slugTouched.current) {
        next.slug = toSlug(value as string);
      }
      return next;
    });
  }

  const isAnthropic = values.source === "anthropic";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
      className="flex flex-col gap-3"
    >
      {/* Row: name + slug */}
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="disp text-[11px] font-semibold uppercase tracking-[0.09em] text-text3">
            Nom *
          </span>
          <input
            required
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Calcul métrés BTP"
            className="rounded-[8px] border border-line bg-bg-2 px-3 py-2 text-[13px] text-text placeholder-text3 outline-none focus:border-amber-line"
          />
        </label>
        <label className="flex w-[180px] flex-col gap-1.5">
          <span className="disp text-[11px] font-semibold uppercase tracking-[0.09em] text-text3">
            Slug *
          </span>
          <input
            required
            value={values.slug}
            onChange={(e) => {
              slugTouched.current = true;
              set("slug", e.target.value);
            }}
            readOnly={slugLocked}
            placeholder="calcul_metres_btp"
            className={cn(
              "mono rounded-[8px] border border-line bg-bg-2 px-3 py-2 text-[12px] text-text placeholder-text3 outline-none focus:border-amber-line",
              slugLocked && "cursor-not-allowed opacity-60",
            )}
          />
        </label>
      </div>

      {/* Description */}
      <label className="flex flex-col gap-1.5">
        <span className="disp text-[11px] font-semibold uppercase tracking-[0.09em] text-text3">
          Description
        </span>
        <input
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Courte description affichée dans la liste"
          className="rounded-[8px] border border-line bg-bg-2 px-3 py-2 text-[13px] text-text placeholder-text3 outline-none focus:border-amber-line"
        />
      </label>

      {/* Source selector */}
      <div className="flex flex-col gap-1.5">
        <span className="disp text-[11px] font-semibold uppercase tracking-[0.09em] text-text3">
          Source
        </span>
        <div className="flex gap-2">
          {(["maison", "anthropic"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => set("source", s)}
              className={cn(
                "disp rounded-[8px] border px-3 py-1.5 text-[12px] font-semibold tracking-[0.04em] transition-colors",
                values.source === s
                  ? "border-amber-line bg-amber-bg text-amber-2"
                  : "border-line bg-bg-2 text-text3 hover:border-line-soft hover:text-text2",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Conditional fields */}
      {isAnthropic ? (
        <label className="flex flex-col gap-1.5">
          <span className="disp text-[11px] font-semibold uppercase tracking-[0.09em] text-text3">
            Anthropic Skill ID *
          </span>
          <input
            required
            value={values.anthropic_skill_id}
            onChange={(e) => set("anthropic_skill_id", e.target.value)}
            placeholder="srvtoolaras1234..."
            className="mono rounded-[8px] border border-line bg-bg-2 px-3 py-2 text-[12px] text-text placeholder-text3 outline-none focus:border-amber-line"
          />
          <span className="text-[11px] text-text3">
            Identifiant du tool Anthropic a reference dans le systeme de prompt.
          </span>
        </label>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="disp text-[11px] font-semibold uppercase tracking-[0.09em] text-text3">
            Instructions
          </span>
          <textarea
            rows={5}
            value={values.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            placeholder="Instructions metier injectees dans le system prompt de l'agent..."
            className="rounded-[8px] border border-line bg-bg-2 px-3 py-2 text-[12.5px] leading-[1.6] text-text placeholder-text3 outline-none focus:border-amber-line"
          />
          <span className="text-[11px] text-text3">
            Ce texte sera injecte dans le prompt systeme de chaque agent qui utilise ce skill.
          </span>
        </label>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-[8px] border border-stop-bg bg-stop-bg px-3 py-2.5 text-[12px] text-stop">
          <AlertTriangle size={14} strokeWidth={2.2} className="mt-px flex-none" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="disp rounded-[8px] border border-line bg-bg-2 px-4 py-2 text-[12px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:border-line-soft hover:text-text disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="disp flex items-center gap-2 rounded-[8px] bg-amber px-4 py-2 text-[12px] font-semibold tracking-[0.04em] text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting && <Spinner size={13} />}
          Enregistrer
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Modal overlay                                                         */
/* ------------------------------------------------------------------ */

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[560px] rounded-[14px] border border-line bg-bg-1 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-4">
          <span className="disp text-[14px] font-semibold text-text">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid h-7 w-7 place-items-center rounded-[6px] text-text3 transition-colors hover:bg-bg-3 hover:text-text"
          >
            <X size={16} strokeWidth={2.2} aria-hidden />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skill row                                                             */
/* ------------------------------------------------------------------ */

function SkillRow({
  skill,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  skill: Skill;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line-soft px-3.5 py-3 transition-colors last:border-b-0 hover:bg-bg-2">
      {/* icon tile */}
      <div className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[8px] bg-bg-3 text-text2">
        <Sparkles size={16} strokeWidth={2} aria-hidden />
      </div>

      {/* name + slug + description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-text">
            {skill.name}
          </span>
          <span className="mono flex-none text-[10px] text-text3">{skill.slug}</span>
        </div>
        {skill.description && (
          <div className="mt-0.5 truncate text-[11px] text-text3">
            {skill.description}
          </div>
        )}
      </div>

      {/* source badge */}
      <SourceBadge source={skill.source} />

      {/* toggle */}
      <Toggle on={skill.enabled} busy={busy} onClick={onToggle} label={skill.name} />

      {/* edit */}
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Modifier le skill ${skill.name}`}
        className="grid h-7 w-7 flex-none place-items-center rounded-[6px] text-text3 transition-colors hover:bg-bg-3 hover:text-text"
      >
        <Pencil size={14} strokeWidth={2.2} aria-hidden />
      </button>

      {/* delete */}
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Supprimer le skill ${skill.name}`}
        className="grid h-7 w-7 flex-none place-items-center rounded-[6px] text-text3 transition-colors hover:bg-stop-bg hover:text-stop"
      >
        <Trash2 size={14} strokeWidth={2.2} aria-hidden />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading / empty / error states                                        */
/* ------------------------------------------------------------------ */

function LoadingState() {
  return (
    <Panel className="grid place-items-center py-14">
      <div className="flex flex-col items-center gap-3 text-text3">
        <Spinner size={24} />
        <span className="disp text-[11px] font-semibold uppercase tracking-[0.1em]">
          Chargement des skills…
        </span>
      </div>
    </Panel>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Panel className="grid place-items-center py-14 text-center">
      <div className="flex max-w-[320px] flex-col items-center gap-2 text-text3">
        <Inbox size={26} strokeWidth={1.8} aria-hidden />
        <span className="text-[13px] font-medium text-text2">
          Aucun skill enregistre
        </span>
        <span className="text-[12px]">
          Cree un skill maison ou reference un skill Anthropic pour l&apos;injecter
          dans les agents.
        </span>
        <button
          type="button"
          onClick={onCreate}
          className="disp mt-2 flex items-center gap-2 rounded-[8px] bg-amber px-4 py-2 text-[12px] font-semibold tracking-[0.04em] text-bg transition-opacity hover:opacity-90"
        >
          <Plus size={14} strokeWidth={2.5} aria-hidden />
          Nouveau skill
        </button>
      </div>
    </Panel>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Panel className="grid place-items-center py-14 text-center">
      <div className="flex max-w-[360px] flex-col items-center gap-3">
        <Activity size={26} strokeWidth={1.8} className="text-stop" aria-hidden />
        <span className="text-[13px] font-medium text-text2">
          Impossible de charger les skills
        </span>
        <span className="text-[12px] text-text3">{message}</span>
        <button
          type="button"
          onClick={onRetry}
          className="disp mt-1 flex items-center gap-2 rounded-[8px] border border-line bg-bg-2 px-3.5 py-2 text-[12px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:border-amber-line hover:text-text"
        >
          <RefreshCw size={14} strokeWidth={2.2} aria-hidden />
          Reessayer
        </button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                  */
/* ------------------------------------------------------------------ */

type ModalMode =
  | { type: "create" }
  | { type: "edit"; skill: Skill }
  | { type: "delete"; skill: Skill }
  | null;

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalMode>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const data = await api.listSkills();
    return data;
  }, []);

  useEffect(() => {
    let active = true;
    load()
      .then((data) => {
        if (active) {
          setSkills(data);
          setLoadError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setLoadError(err instanceof Error ? err.message : "Chargement impossible.");
        }
      });
    return () => {
      active = false;
    };
  }, [load]);

  async function reload() {
    setLoadError(null);
    setSkills(null);
    try {
      setSkills(await load());
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Chargement impossible.");
    }
  }

  function openCreate() {
    setFormError(null);
    setModal({ type: "create" });
  }

  function openEdit(skill: Skill) {
    setFormError(null);
    setModal({ type: "edit", skill });
  }

  function openDelete(skill: Skill) {
    setModal({ type: "delete", skill });
  }

  function closeModal() {
    if (submitting) return;
    setModal(null);
    setFormError(null);
  }

  async function handleCreate(values: FormValues) {
    setSubmitting(true);
    setFormError(null);
    try {
      const input: SkillCreateInput = {
        name: values.name,
        slug: values.slug,
        description: values.description || undefined,
        source: values.source,
        instructions: values.source === "maison" ? values.instructions || undefined : undefined,
        anthropic_skill_id:
          values.source === "anthropic" ? values.anthropic_skill_id || undefined : undefined,
      };
      const created = await api.createSkill(input);
      setSkills((prev) => (prev ? [created, ...prev] : [created]));
      setModal(null);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Creation impossible.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(values: FormValues) {
    if (modal?.type !== "edit") return;
    setSubmitting(true);
    setFormError(null);
    try {
      const input: SkillUpdateInput = {
        name: values.name,
        description: values.description || undefined,
        source: values.source,
        instructions: values.source === "maison" ? values.instructions || undefined : undefined,
        anthropic_skill_id:
          values.source === "anthropic" ? values.anthropic_skill_id || undefined : undefined,
      };
      const updated = await api.updateSkill(modal.skill.id, input);
      setSkills((prev) => prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev);
      setModal(null);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Modification impossible.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (modal?.type !== "delete") return;
    const { skill } = modal;
    setSubmitting(true);
    try {
      await api.deleteSkill(skill.id);
      setSkills((prev) => prev ? prev.filter((s) => s.id !== skill.id) : prev);
      setModal(null);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(skill: Skill) {
    if (busyRef.current) return;
    busyRef.current = skill.id;
    setBusyId(skill.id);
    const nextEnabled = !skill.enabled;
    // Optimistic update.
    setSkills((prev) =>
      prev ? prev.map((s) => (s.id === skill.id ? { ...s, enabled: nextEnabled } : s)) : prev,
    );
    try {
      const updated = await api.updateSkill(skill.id, { enabled: nextEnabled });
      setSkills((prev) =>
        prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev,
      );
    } catch {
      // Roll back on failure.
      setSkills((prev) =>
        prev ? prev.map((s) => (s.id === skill.id ? { ...s, enabled: skill.enabled } : s)) : prev,
      );
    } finally {
      busyRef.current = null;
      setBusyId(null);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset input so selecting the same file again re-triggers onChange.
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      const imported = await api.importSkill(file);
      setSkills((prev) => {
        if (!prev) return [imported];
        const exists = prev.findIndex((s) => s.id === imported.id);
        if (exists >= 0) {
          return prev.map((s) => (s.id === imported.id ? imported : s));
        }
        return [imported, ...prev];
      });
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : "Import impossible.");
    } finally {
      setImporting(false);
    }
  }

  const enabled = skills?.filter((s) => s.enabled).length ?? 0;
  const total = skills?.length ?? 0;

  return (
    <div className="flex flex-col gap-5 p-[18px_22px]">
      {/* Header */}
      <header className="oc-fade flex items-start justify-between">
        <div>
          <h1 className="disp text-[19px] font-semibold tracking-[0.01em]">
            Skills
          </h1>
          <p className="mt-1 text-[12.5px] text-text3">
            Blocs d&apos;instructions injectes dans le prompt systeme des agents · maison ou
            Anthropic.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Hidden file input for .skill / .md / .zip */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".skill,.md,.zip"
            className="hidden"
            aria-label="Importer un fichier skill"
            onChange={handleImport}
          />
          <button
            type="button"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            className="disp flex items-center gap-2 rounded-[9px] border border-line bg-bg-2 px-4 py-2 text-[12.5px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:border-amber-line hover:text-text disabled:opacity-50"
          >
            {importing ? (
              <Spinner size={14} />
            ) : (
              <Upload size={14} strokeWidth={2.2} aria-hidden />
            )}
            Importer un skill (.skill)
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="disp flex items-center gap-2 rounded-[9px] bg-amber px-4 py-2 text-[12.5px] font-semibold tracking-[0.04em] text-bg transition-opacity hover:opacity-90"
          >
            <Plus size={15} strokeWidth={2.5} aria-hidden />
            Nouveau skill
          </button>
        </div>
      </header>

      {/* Import error banner */}
      {importError && (
        <div className="oc-fade flex items-start gap-2 rounded-[8px] border border-stop-bg bg-stop-bg px-3 py-2.5 text-[12px] text-stop">
          <AlertTriangle size={14} strokeWidth={2.2} className="mt-px flex-none" aria-hidden />
          <span className="flex-1">{importError}</span>
          <button
            type="button"
            onClick={() => setImportError(null)}
            aria-label="Fermer"
            className="grid h-5 w-5 flex-none place-items-center rounded-[4px] opacity-70 transition-opacity hover:opacity-100"
          >
            <X size={12} strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      )}

      {/* Summary strip */}
      {skills !== null && (
        <section
          className="oc-fade flex items-stretch overflow-hidden rounded-[11px] border border-line bg-panel"
          style={{ animationDelay: "0.03s" }}
        >
          <StripCell label="Skills" value={total} />
          <StripCell label="Actifs" value={`${enabled}/${total}`} tone="ok" />
          <StripCell
            label="Maison"
            value={skills.filter((s) => s.source === "maison").length}
          />
          <StripCell
            label="Anthropic"
            value={skills.filter((s) => s.source === "anthropic").length}
            tone="amber"
          />
        </section>
      )}

      {/* List */}
      <section className="oc-fade" style={{ animationDelay: "0.06s" }}>
        <SectionHeader
          title="Bibliotheque de skills"
          count={skills ? skills.length : undefined}
          icon={
            <Sparkles size={16} strokeWidth={2} className="text-text2" aria-hidden />
          }
        />

        {loadError && !skills ? (
          <ErrorState message={loadError} onRetry={reload} />
        ) : skills === null ? (
          <LoadingState />
        ) : skills.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : (
          <Panel bare>
            {skills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                busy={busyId === skill.id}
                onToggle={() => handleToggle(skill)}
                onEdit={() => openEdit(skill)}
                onDelete={() => openDelete(skill)}
              />
            ))}
          </Panel>
        )}
      </section>

      {/* Modals */}
      {modal?.type === "create" && (
        <Modal title="Nouveau skill" onClose={closeModal}>
          <SkillForm
            initial={EMPTY_FORM}
            slugLocked={false}
            submitting={submitting}
            error={formError}
            onSubmit={handleCreate}
            onCancel={closeModal}
          />
        </Modal>
      )}

      {modal?.type === "edit" && (
        <Modal title={`Modifier · ${modal.skill.name}`} onClose={closeModal}>
          <SkillForm
            initial={skillToForm(modal.skill)}
            slugLocked
            submitting={submitting}
            error={formError}
            onSubmit={handleEdit}
            onCancel={closeModal}
          />
        </Modal>
      )}

      {modal?.type === "delete" && (
        <Modal title="Supprimer le skill" onClose={closeModal}>
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-text2">
              Confirmer la suppression de{" "}
              <span className="font-semibold text-text">{modal.skill.name}</span>{" "}
              (<span className="mono text-[12px] text-text3">{modal.skill.slug}</span>)?
              Cette action est irreversible.
            </p>
            {formError && (
              <div className="flex items-start gap-2 rounded-[8px] border border-stop-bg bg-stop-bg px-3 py-2.5 text-[12px] text-stop">
                <AlertTriangle size={14} strokeWidth={2.2} className="mt-px flex-none" aria-hidden />
                <span>{formError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={submitting}
                className="disp rounded-[8px] border border-line bg-bg-2 px-4 py-2 text-[12px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:border-line-soft hover:text-text disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="disp flex items-center gap-2 rounded-[8px] bg-stop px-4 py-2 text-[12px] font-semibold tracking-[0.04em] text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {submitting && <Spinner size={13} />}
                Supprimer
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Strip cell (local copy — same pattern as agents page)                 */
/* ------------------------------------------------------------------ */

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
