"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Plus,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import type { LLMConfig, RiskLevel, Skill } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { Spinner } from "@/components/ui/Spinner";
import { ModelSelector } from "@/components/agents/ModelSelector";

/* ------------------------------------------------------------------ */
/* constants                                                            */
/* ------------------------------------------------------------------ */

const INPUT_CLS =
  "w-full rounded-[9px] border border-line bg-bg-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-text outline-none transition-colors placeholder:text-text3 focus:border-amber-line";

const RISK_OPTIONS: Array<{ value: RiskLevel; label: string }> = [
  { value: "low", label: "Faible" },
  { value: "medium", label: "Moyen" },
  { value: "high", label: "Élevé" },
  { value: "blocked", label: "Bloqué" },
];

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

/** Derive a URL-safe slug from a human name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/* ------------------------------------------------------------------ */
/* page                                                                 */
/* ------------------------------------------------------------------ */

export default function NewAgentPage() {
  const router = useRouter();

  // Basic fields
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("low");

  // LLM
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null);

  // System prompt — uncontrolled textarea to avoid cursor-reset on re-render
  const systemPromptRef = useRef<HTMLTextAreaElement>(null);

  // Skills
  const [allSkills, setAllSkills] = useState<Skill[]>([]);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);

  // Submit state
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load LLM config and skills once
  useEffect(() => {
    api.getLlmConfig().then(setLlmConfig).catch(() => {});
    api
      .listSkills()
      .then((skills) => setAllSkills(skills.filter((s) => s.enabled)))
      .catch(() => {});
  }, []);

  // Auto-derive slug from name unless the user has edited slug manually
  function handleNameChange(value: string) {
    setName(value);
    if (!slugManual) {
      setSlug(slugify(value));
    }
  }

  function handleSlugChange(value: string) {
    setSlug(value);
    setSlugManual(true);
  }

  function toggleSkill(s: string) {
    setSelectedSlugs((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  const providerInfo = llmConfig?.providers.find((p) => p.name === provider);
  const modelPlaceholder = providerInfo?.default_model ?? "défaut du fournisseur";
  const providerModels = providerInfo?.models ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    const trimmedRole = role.trim();

    if (!trimmedName) {
      setErr("Le nom est requis.");
      return;
    }
    if (!trimmedSlug) {
      setErr("Le slug est requis.");
      return;
    }
    if (!trimmedRole) {
      setErr("Le rôle est requis.");
      return;
    }

    const systemPrompt = systemPromptRef.current?.value ?? "";

    setBusy(true);
    setErr(null);

    try {
      const agent = await api.createAgent({
        name: trimmedName,
        slug: trimmedSlug,
        role: trimmedRole,
        description: description.trim() || null,
        provider,
        model: model.trim() || null,
        config: {
          agent_type: "custom",
          version,
          risk_level: riskLevel,
          system_prompt: systemPrompt,
          skills: selectedSlugs,
        },
      });
      router.push(`/agents/${agent.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Création impossible.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 px-[22px] py-[18px]">
      {/* back */}
      <button
        type="button"
        onClick={() => router.push("/agents")}
        className="flex w-fit items-center gap-1.5 text-[12px] text-text3 transition-colors hover:text-amber-2"
      >
        <ArrowLeft size={14} strokeWidth={2.2} aria-hidden />
        Sous-agents
      </button>

      {/* header */}
      <header className="oc-fade flex items-center gap-3">
        <div className="grid h-11 w-11 flex-none place-items-center rounded-[9px] bg-amber-bg text-amber">
          <Bot size={22} strokeWidth={2} aria-hidden />
        </div>
        <div>
          <h1 className="disp text-[19px] font-semibold tracking-[0.01em] text-text">
            Nouvel agent
          </h1>
          <p className="mt-0.5 text-[12px] text-text3">
            Crée un agent custom piloté par un prompt système.
          </p>
        </div>
      </header>

      {/* form */}
      <form onSubmit={submit} noValidate>
        <div className="flex flex-col gap-5">
          {/* identity panel */}
          <Panel bare>
            <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
              <span className="disp text-[11px] font-semibold uppercase tracking-[0.11em] text-text2">
                Identité
              </span>
            </div>
            <div className="flex flex-col gap-4 p-4">
              {/* name + slug */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Nom *">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className={INPUT_CLS}
                    placeholder="Ex. : Assistant planification"
                    autoFocus
                    required
                  />
                </Field>
                <Field label="Slug *">
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    className={INPUT_CLS}
                    placeholder="assistant_planification"
                    pattern="[a-z0-9_]+"
                  />
                  <span className="mt-1 text-[10.5px] text-text3">
                    Identifiant unique (lettres minuscules, chiffres, _)
                  </span>
                </Field>
              </div>

              {/* role */}
              <Field label="Rôle *">
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="Ex. : Planificateur de chantier"
                  required
                />
              </Field>

              {/* description */}
              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className={cn(INPUT_CLS, "resize-y")}
                  placeholder="Décris le rôle de cet agent…"
                />
              </Field>

              {/* version + risk */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Version">
                  <input
                    type="text"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    className={INPUT_CLS}
                    placeholder="1.0.0"
                  />
                </Field>
                <Field label="Niveau de risque">
                  <select
                    value={riskLevel}
                    onChange={(e) => setRiskLevel(e.target.value as RiskLevel)}
                    className={INPUT_CLS}
                  >
                    {RISK_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </Panel>

          {/* LLM panel */}
          <Panel bare>
            <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
              <span className="disp text-[11px] font-semibold uppercase tracking-[0.11em] text-text2">
                Modèle LLM
              </span>
            </div>
            <div className="flex flex-col gap-4 p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Fournisseur">
                  <select
                    value={provider}
                    onChange={(e) => {
                      setProvider(e.target.value);
                      setModel("");
                    }}
                    className={INPUT_CLS}
                  >
                    {llmConfig ? (
                      llmConfig.providers.map((p) => (
                        <option key={p.name} value={p.name} disabled={!p.available}>
                          {p.name}
                          {!p.available ? " (clé manquante)" : ""}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="anthropic">anthropic</option>
                        <option value="openai">openai</option>
                        <option value="google">google</option>
                        <option value="deepseek">deepseek</option>
                      </>
                    )}
                  </select>
                </Field>
                <Field label={`Modèle (vide = ${modelPlaceholder})`}>
                  <ModelSelector
                    models={providerModels}
                    value={model}
                    onChange={setModel}
                    placeholder={modelPlaceholder}
                    className={INPUT_CLS}
                  />
                </Field>
              </div>

              {/* system prompt — uncontrolled to prevent cursor-reset bug */}
              <Field label="Prompt système">
                <textarea
                  ref={systemPromptRef}
                  defaultValue=""
                  rows={10}
                  spellCheck={false}
                  className={cn(
                    INPUT_CLS,
                    "mono resize-y py-3 text-[12px] leading-[1.7]",
                  )}
                  placeholder="Instruction système envoyée au LLM avant chaque exécution de cet agent…"
                />
              </Field>
            </div>
          </Panel>

          {/* skills panel */}
          {allSkills.length > 0 && (
            <Panel bare>
              <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
                <span className="disp text-[11px] font-semibold uppercase tracking-[0.11em] text-text2">
                  Skills actifs
                </span>
                {selectedSlugs.length > 0 && (
                  <span className="mono ml-auto text-[11px] text-amber-2">
                    {selectedSlugs.length} sélectionné
                    {selectedSlugs.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <div className="p-4">
                <div className="flex flex-wrap gap-2 rounded-[9px] border border-line bg-bg-2 px-3 py-2.5">
                  {allSkills.map((skill) => {
                    const checked = selectedSlugs.includes(skill.slug);
                    return (
                      <button
                        key={skill.slug}
                        type="button"
                        onClick={() => toggleSkill(skill.slug)}
                        title={skill.description ?? skill.name}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors",
                          checked
                            ? "bg-amber text-[var(--amber-fg)]"
                            : "bg-bg-3 text-text2 hover:text-text",
                        )}
                      >
                        <Zap size={11} strokeWidth={2.2} aria-hidden />
                        {skill.name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-text3">
                  Les instructions des skills sélectionnés seront injectées dans le prompt système.
                </p>
              </div>
            </Panel>
          )}

          {/* error */}
          {err && (
            <div className="flex items-start gap-2 rounded-[8px] border border-stop-bg bg-stop-bg px-3 py-2.5 text-[12px] text-stop">
              <AlertTriangle size={14} strokeWidth={2.2} className="mt-px flex-none" aria-hidden />
              <span>{err}</span>
            </div>
          )}

          {/* actions */}
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => router.push("/agents")}
              className="disp flex h-[40px] items-center gap-2 rounded-[9px] border border-line bg-panel px-4 text-[12.5px] font-semibold text-text2 transition-colors hover:text-text"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={busy}
              className="disp flex h-[40px] items-center gap-2 rounded-[9px] bg-amber px-5 text-[12.5px] font-semibold tracking-[0.04em] text-[var(--amber-fg)] transition-colors hover:bg-amber-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <Spinner size={15} className="border-[var(--amber-fg)] border-t-transparent" />
              ) : (
                <Plus size={16} strokeWidth={2.4} aria-hidden />
              )}
              {busy ? "Création…" : "Créer l'agent"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* field wrapper                                                        */
/* ------------------------------------------------------------------ */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="disp text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text3">
        {label}
      </span>
      {children}
    </label>
  );
}
