"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  Building2,
  Check,
  Cpu,
  Database,
  FileText,
  Gauge,
  KeyRound,
  LogOut,
  Mail,
  Moon,
  Percent,
  Phone,
  RefreshCw,
  Rows3,
  Save,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  User,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  AuthUser,
  CompanySettings,
  CompanySettingsUpdateInput,
  LLMConfig,
} from "@/lib/types";
import { getToken, clearToken } from "@/lib/auth";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";

/* /health is a public endpoint and is NOT part of lib/api (which exposes only
   the documented entity methods), so we probe it directly against the same
   base URL the api client uses. */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/* Light self-healing poll: the status banner is informational, so a slower
   cadence than the task pages (3s) is intentional. */
const POLL_MS = 5000;

/* OPENCLAW_MODEL is a backend env var, never exposed over the API — shown as a
   static label, kept in sync with the value the backend defaults to. */
const MODEL_LABEL = "claude-opus-4.8";

interface Health {
  status: string;
  llm: boolean;
}

interface Snapshot {
  health: Health | null;
  user: AuthUser | null;
}

const EMPTY: Snapshot = { health: null, user: null };

async function fetchHealth(): Promise<Health> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
  } catch {
    throw new Error(
      "Impossible de joindre le backend. Vérifiez qu'il est démarré.",
    );
  }
  if (!res.ok) {
    throw new Error(`Backend indisponible (${res.status}).`);
  }
  return (await res.json()) as Health;
}

export default function SettingsPage() {
  const router = useRouter();
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial: boolean) => {
    try {
      // Health is the source of truth for the page; the account lookup is
      // best-effort so a transient /auth/me failure never blanks the screen.
      const [health, user] = await Promise.all([
        fetchHealth(),
        api.me().catch((): AuthUser | null => null),
      ]);
      setData((prev) => ({ health, user: user ?? prev.user }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement.");
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  // Keep the operational readout fresh without blocking the rest of the page.
  useEffect(() => {
    const id = window.setInterval(() => void load(false), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  function logout() {
    clearToken();
    router.replace("/login");
  }

  async function retry() {
    setError(null);
    setLoading(true);
    await load(true);
  }

  const health = data.health;
  const online = health?.status === "ok";

  return (
    <div className="flex flex-col gap-5 p-[18px_22px]">
      <header className="oc-fade">
        <h1 className="disp text-[19px] font-semibold tracking-[0.01em]">
          Paramètres
        </h1>
        <p className="mt-1 text-[12.5px] text-text3">
          État du système, runtime backend &amp; modèle, compte et préférences
          d&apos;affichage du cockpit.
        </p>
      </header>

      {error && loading ? (
        <ErrorState message={error} onRetry={retry} />
      ) : loading ? (
        <LoadingState />
      ) : (
        <>
          {error && <InlineError message={error} />}

          {/* operational readout — mirrors the Topbar status pill */}
          <StatusBanner
            online={online}
            llm={!!health?.llm}
            className="oc-fade"
          />

          {/* instrument strip — backend / LLM / model / database */}
          <section
            className="oc-fade flex flex-wrap items-stretch overflow-hidden rounded-[11px] border border-line bg-panel"
            style={{ animationDelay: "0.04s" }}
          >
            <StripCell
              label="Backend"
              value={online ? "En ligne" : "Hors ligne"}
              tone={online ? "ok" : "stop"}
            />
            <StripCell
              label="Modèle IA"
              value={health?.llm ? "Connecté" : "Stub"}
              tone={health?.llm ? "ok" : "amber"}
            />
            <StripCell label="Modèle actif" value="opus-4.8" tone="amber" />
            <StripCell label="Base de données" value="Postgres" />
            <StripCell label="Tables" value="7" />
          </section>

          {/* runtime + account */}
          <section
            className="oc-fade grid grid-cols-1 gap-4 lg:grid-cols-2"
            style={{ animationDelay: "0.08s" }}
          >
            <RuntimePanel online={online} llm={!!health?.llm} />
            <AccountPanel user={data.user} onLogout={logout} />
          </section>

          {/* company settings */}
          <section className="oc-fade" style={{ animationDelay: "0.12s" }}>
            <SectionHeader
              title="Société"
              icon={
                <Building2
                  size={16}
                  strokeWidth={2}
                  className="text-text2"
                  aria-hidden
                />
              }
            />
            <CompanySettingsPanel />
          </section>

          {/* LLM providers */}
          <section className="oc-fade" style={{ animationDelay: "0.16s" }}>
            <SectionHeader
              title="Modèles &amp; fournisseurs LLM"
              icon={
                <Bot
                  size={16}
                  strokeWidth={2}
                  className="text-text2"
                  aria-hidden
                />
              }
            />
            <LLMConfigPanel />
          </section>

          {/* static UI preferences */}
          <section className="oc-fade" style={{ animationDelay: "0.20s" }}>
            <SectionHeader
              title="Préférences d'affichage"
              icon={
                <SettingsIcon
                  size={16}
                  strokeWidth={2}
                  className="text-text2"
                  aria-hidden
                />
              }
            />
            <PreferencesPanel />
          </section>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Company settings form.                                               */
/* ------------------------------------------------------------------ */

function CompanySettingsPanel() {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [form, setForm] = useState<CompanySettingsUpdateInput>({});
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getCompanySettings()
      .then((s) => {
        setSettings(s);
        setForm({
          company_name: s.company_name,
          siret: s.siret ?? "",
          vat_number: s.vat_number ?? "",
          address: s.address ?? "",
          email: s.email ?? "",
          phone: s.phone ?? "",
          legal_mentions: s.legal_mentions ?? "",
          default_tva_rate: s.default_tva_rate,
        });
      })
      .catch((e: unknown) =>
        setErr(
          e instanceof Error ? e.message : "Impossible de charger les paramètres société.",
        ),
      )
      .finally(() => setLoadingData(false));
  }, []);

  function patch(key: keyof CompanySettingsUpdateInput, value: string | number | null) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      // Convert empty strings back to null for nullable fields
      const payload: CompanySettingsUpdateInput = {
        ...form,
        siret: form.siret || null,
        vat_number: form.vat_number || null,
        address: form.address || null,
        email: form.email || null,
        phone: form.phone || null,
        legal_mentions: form.legal_mentions || null,
      };
      const updated = await api.updateCompanySettings(payload);
      setSettings(updated);
      setSaved(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erreur lors de la sauvegarde.");
    } finally {
      setSaving(false);
    }
  }

  if (loadingData) {
    return (
      <Panel bare className="flex items-center justify-center py-8">
        <Spinner size={20} />
        <span className="ml-3 text-[12px] text-text3">Chargement…</span>
      </Panel>
    );
  }

  if (err && !settings) {
    return (
      <Panel bare className="px-3.5 py-4">
        <InlineError message={err} />
      </Panel>
    );
  }

  const tvaPercent =
    typeof form.default_tva_rate === "number"
      ? (form.default_tva_rate * 100).toFixed(0)
      : "20";

  return (
    <Panel bare>
      <form onSubmit={(e) => void handleSave(e)}>
        <div className="grid grid-cols-1 gap-0 divide-y divide-line-soft lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          {/* left column */}
          <div className="flex flex-col gap-0 divide-y divide-line-soft">
            <FormField
              icon={Building2}
              label="Nom de l'entreprise"
              required
            >
              <input
                type="text"
                value={form.company_name ?? ""}
                onChange={(e) => patch("company_name", e.target.value)}
                placeholder="Mon Entreprise BTP"
                className={fieldCls}
                required
              />
            </FormField>
            <FormField icon={FileText} label="SIRET">
              <input
                type="text"
                value={form.siret ?? ""}
                onChange={(e) => patch("siret", e.target.value)}
                placeholder="000 000 000 00000"
                className={fieldCls}
                maxLength={17}
              />
            </FormField>
            <FormField icon={FileText} label="N° TVA intra.">
              <input
                type="text"
                value={form.vat_number ?? ""}
                onChange={(e) => patch("vat_number", e.target.value)}
                placeholder="FR00000000000"
                className={fieldCls}
              />
            </FormField>
            <FormField icon={Percent} label="Taux TVA par défaut">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={tvaPercent}
                  onChange={(e) => {
                    const pct = parseFloat(e.target.value);
                    if (!isNaN(pct)) patch("default_tva_rate", pct / 100);
                  }}
                  className={cn(fieldCls, "w-20")}
                />
                <span className="text-[12px] text-text3">%</span>
              </div>
            </FormField>
          </div>

          {/* right column */}
          <div className="flex flex-col gap-0 divide-y divide-line-soft">
            <FormField icon={Mail} label="E-mail">
              <input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => patch("email", e.target.value)}
                placeholder="contact@entreprise.fr"
                className={fieldCls}
              />
            </FormField>
            <FormField icon={Phone} label="Téléphone">
              <input
                type="tel"
                value={form.phone ?? ""}
                onChange={(e) => patch("phone", e.target.value)}
                placeholder="+33 1 00 00 00 00"
                className={fieldCls}
              />
            </FormField>
            <FormField icon={Building2} label="Adresse">
              <textarea
                value={form.address ?? ""}
                onChange={(e) => patch("address", e.target.value)}
                placeholder="1 rue des Bâtisseurs, 75001 Paris"
                rows={2}
                className={cn(fieldCls, "resize-none")}
              />
            </FormField>
            <FormField icon={FileText} label="Mentions légales">
              <textarea
                value={form.legal_mentions ?? ""}
                onChange={(e) => patch("legal_mentions", e.target.value)}
                placeholder="Capital social : …"
                rows={3}
                className={cn(fieldCls, "resize-none")}
              />
            </FormField>
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center gap-3 border-t border-line-soft px-3.5 py-3">
          {err && (
            <span className="flex items-center gap-1.5 text-[12px] text-stop">
              <AlertTriangle size={13} strokeWidth={2.2} aria-hidden />
              {err}
            </span>
          )}
          {saved && !err && (
            <span className="flex items-center gap-1.5 text-[12px] text-ok">
              <Check size={13} strokeWidth={2.5} aria-hidden />
              Sauvegardé
            </span>
          )}
          <button
            type="submit"
            disabled={saving}
            className="disp ml-auto flex items-center gap-2 rounded-[8px] border border-amber-line bg-amber-bg px-3.5 py-2 text-[12px] font-semibold tracking-[0.04em] text-amber-2 transition-colors hover:bg-amber-line disabled:opacity-50"
          >
            {saving ? (
              <Spinner size={14} />
            ) : (
              <Save size={14} strokeWidth={2.2} aria-hidden />
            )}
            Enregistrer
          </button>
        </div>
      </form>
    </Panel>
  );
}

const fieldCls =
  "w-full rounded-[6px] border border-line bg-bg-2 px-2.5 py-1.5 text-[12.5px] text-text placeholder:text-text3 focus:border-amber-line focus:outline-none";

function FormField({
  icon: Icon,
  label,
  required,
  children,
}: {
  icon: LucideIcon;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-3.5 py-3">
      <div className="mt-1 flex-none">
        <Icon size={14} strokeWidth={2} className="text-text3" aria-hidden />
      </div>
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <label className="text-[11px] font-medium text-text2">
          {label}
          {required && <span className="ml-0.5 text-amber-2">*</span>}
        </label>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LLM config panel — read-only display of providers + default.        */
/* ------------------------------------------------------------------ */

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  deepseek: "DeepSeek",
};

const PROVIDER_MODELS: Record<string, string> = {
  anthropic: "claude-opus-4.8",
  openai: "GPT-4o",
  google: "Gemini 1.5 Pro",
  deepseek: "deepseek-chat",
};

function LLMConfigPanel() {
  const [config, setConfig] = useState<LLMConfig | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLlmConfig()
      .then(setConfig)
      .catch((e: unknown) =>
        setErr(
          e instanceof Error ? e.message : "Impossible de charger la config LLM.",
        ),
      )
      .finally(() => setLoadingData(false));
  }, []);

  if (loadingData) {
    return (
      <Panel bare className="flex items-center justify-center py-8">
        <Spinner size={20} />
        <span className="ml-3 text-[12px] text-text3">Chargement…</span>
      </Panel>
    );
  }

  if (err || !config) {
    return (
      <Panel bare className="px-3.5 py-4">
        <InlineError message={err ?? "Données indisponibles."} />
      </Panel>
    );
  }

  return (
    <Panel bare>
      {/* default provider banner */}
      <div className="flex items-center gap-3 border-b border-line-soft px-3.5 py-3">
        <Sparkles size={14} strokeWidth={2} className="flex-none text-amber-2" aria-hidden />
        <span className="text-[12px] text-text2">Fournisseur par défaut</span>
        <span className="ml-auto disp rounded-[5px] border border-amber-line bg-amber-bg px-[9px] py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-amber-2">
          {PROVIDER_LABELS[config.default_provider] ?? config.default_provider}
        </span>
      </div>

      {/* provider rows */}
      {config.providers.map((p, i) => {
        const label = PROVIDER_LABELS[p.name] ?? p.name;
        const modelLabel = p.default_model || (PROVIDER_MODELS[p.name] ?? p.default_model);
        const isDefault = p.name === config.default_provider;
        const isLast = i === config.providers.length - 1;

        return (
          <div
            key={p.name}
            className={cn(
              "flex items-center gap-3 px-3.5 py-3",
              !isLast && "border-b border-line-soft",
            )}
          >
            <div
              className={cn(
                "grid h-[30px] w-[30px] flex-none place-items-center rounded-[7px] border text-[11px] font-bold",
                p.available
                  ? "border-ok-bg bg-ok-bg text-ok"
                  : "border-line bg-bg-3 text-text3",
              )}
              aria-hidden
            >
              {label.slice(0, 2).toUpperCase()}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-medium text-text">{label}</span>
                {isDefault && (
                  <span className="disp rounded-[4px] border border-amber-line bg-amber-bg px-[6px] py-px text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-2">
                    Défaut
                  </span>
                )}
              </div>
              <span className="mono text-[11px] text-text3">{modelLabel}</span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <StateDot
                ok={p.available}
                okLabel="Clé présente"
                koLabel="Clé absente"
                koTone="amber"
              />
            </div>
          </div>
        );
      })}

      <div className="border-t border-line-soft px-3.5 py-2.5">
        <span className="mono text-[10.5px] text-text3">
          Configurez les clés via les variables d&apos;environnement backend (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, DEEPSEEK_API_KEY).
        </span>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Operational readout — same anatomy as the Topbar status pill.        */
/* ------------------------------------------------------------------ */

function StatusBanner({
  online,
  llm,
  className,
}: {
  online: boolean;
  llm: boolean;
  className?: string;
}) {
  return (
    <Panel accent className={cn("flex flex-wrap items-center gap-x-4 gap-y-3", className)}>
      <div className="flex items-center gap-[9px] rounded-[20px] border border-line-soft bg-bg-2 px-[13px] py-[6px]">
        {online ? <Pulse /> : <DeadDot />}
        <span
          className={cn(
            "disp text-[11px] font-semibold uppercase tracking-[0.1em]",
            online ? "text-ok" : "text-stop",
          )}
        >
          {online ? "Opérationnel" : "Hors ligne"}
        </span>
        <span className="mono text-[11px] text-text2">· {MODEL_LABEL}</span>
      </div>

      <span className="text-[12.5px] text-text3">
        {online
          ? llm
            ? "Backend joignable · clé Anthropic présente, génération IA active."
            : "Backend joignable · clé Anthropic absente, les agents renvoient des brouillons stub."
          : "Le backend ne répond pas. Les commandes OpenClaw ne peuvent pas être exécutées."}
      </span>

      <span className="ml-auto flex items-center gap-1.5 text-[11px] text-text3">
        <ShieldCheck size={13} strokeWidth={2} aria-hidden />
        OpenClaw propose · le backend valide
      </span>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Instrument strip cell — parity with the tasks/dashboard strips.      */
/* ------------------------------------------------------------------ */

function StripCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "amber" | "ok" | "stop";
}) {
  return (
    <div className="flex min-w-[140px] flex-1 flex-col gap-[7px] border-r border-line-soft px-4 py-[13px] last:border-r-0">
      <span className="disp text-[10px] font-semibold uppercase tracking-[0.12em] text-text3">
        {label}
      </span>
      <span
        className={cn(
          "disp text-[19px] font-semibold leading-none tracking-[0.01em]",
          tone === "amber" && "text-amber-2",
          tone === "ok" && "text-ok",
          tone === "stop" && "text-stop",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Runtime panel — connection / model / environment facts.              */
/* ------------------------------------------------------------------ */

function RuntimePanel({ online, llm }: { online: boolean; llm: boolean }) {
  return (
    <Panel bare className="flex flex-col">
      <PanelHead
        icon={<Server size={16} strokeWidth={2} className="text-text2" aria-hidden />}
        title="Connexion & runtime"
      />
      <div className="px-3.5 py-1">
        <InfoRow
          icon={Server}
          k="API backend"
          v={<span className="mono">{API_BASE}</span>}
        />
        <InfoRow
          icon={Gauge}
          k="Statut backend"
          v={
            <StateDot
              ok={online}
              okLabel="En ligne"
              koLabel="Hors ligne"
            />
          }
        />
        <InfoRow
          icon={KeyRound}
          k="Clé Anthropic"
          v={
            <StateDot
              ok={llm}
              okLabel="Présente"
              koLabel="Absente"
              koTone="amber"
            />
          }
        />
        <InfoRow
          icon={Cpu}
          k="Modèle actif"
          v={<span className="mono text-amber-2">{MODEL_LABEL}</span>}
          hint="OPENCLAW_MODEL · variable backend, non exposée"
        />
        <InfoRow
          icon={Sparkles}
          k="Génération IA"
          v={
            llm ? (
              <span className="text-ok">Active</span>
            ) : (
              <span className="text-amber-2">Mode stub (brouillons)</span>
            )
          }
        />
        <InfoRow
          icon={Database}
          k="Base de données"
          v={<span className="mono">PostgreSQL · 7 tables</span>}
          last
        />
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Account panel — current user + logout.                               */
/* ------------------------------------------------------------------ */

function AccountPanel({
  user,
  onLogout,
}: {
  user: AuthUser | null;
  onLogout: () => void;
}) {
  const email = user?.email ?? null;
  const initials = email ? email.slice(0, 2).toUpperCase() : "··";

  return (
    <Panel bare className="flex flex-col">
      <PanelHead
        icon={<User size={16} strokeWidth={2} className="text-text2" aria-hidden />}
        title="Compte"
      />
      <div className="flex flex-1 flex-col px-3.5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="disp grid h-[42px] w-[42px] flex-none place-items-center rounded-[10px] border border-line bg-bg-3 text-[14px] font-semibold text-amber-2">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-text">
              {user?.name || "Utilisateur interne"}
            </div>
            <div className="mono truncate text-[11.5px] text-text3">
              {email ?? "session active — e-mail indisponible"}
            </div>
          </div>
          <span className="disp ml-auto flex-none rounded-[5px] border border-steel-bg bg-steel-bg px-[9px] py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">
            Interne
          </span>
        </div>

        <div className="my-3.5 h-px bg-line-soft" />

        <InfoRow
          icon={ShieldCheck}
          k="Authentification"
          v={
            <StateDot
              ok={!!getToken()}
              okLabel="JWT actif"
              koLabel="Aucun jeton"
            />
          }
        />

        <button
          type="button"
          onClick={onLogout}
          className="disp mt-auto flex items-center justify-center gap-2 rounded-[8px] border border-line bg-bg-2 px-3.5 py-2.5 text-[12px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:border-stop hover:bg-stop-bg hover:text-stop"
        >
          <LogOut size={15} strokeWidth={2.2} aria-hidden />
          Se déconnecter
        </button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* UI preferences — static in V1, presented read-only.                  */
/* ------------------------------------------------------------------ */

interface Pref {
  icon: LucideIcon;
  label: string;
  value: string;
  on: boolean;
  note: string;
}

const PREFS: Pref[] = [
  {
    icon: Moon,
    label: "Thème",
    value: "Anthracite chaud",
    on: true,
    note: "Palette sombre + accent ambre hi-vis",
  },
  {
    icon: Rows3,
    label: "Densité",
    value: "Compacte",
    on: true,
    note: "Listes denses façon cockpit",
  },
  {
    icon: Wand2,
    label: "Animations",
    value: "Selon le système",
    on: true,
    note: "Respecte prefers-reduced-motion",
  },
];

function PreferencesPanel() {
  return (
    <Panel bare>
      {PREFS.map((p, i) => {
        const Icon = p.icon;
        return (
          <div
            key={p.label}
            className={cn(
              "flex items-center gap-3 px-3.5 py-3",
              i < PREFS.length - 1 && "border-b border-line-soft",
            )}
          >
            <div className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[7px] bg-bg-3 text-text2">
              <Icon size={16} strokeWidth={2} aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-text">{p.label}</div>
              <div className="text-[11px] text-text3">{p.note}</div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="mono text-[11.5px] text-text2">{p.value}</span>
              <StaticToggle on={p.on} />
            </div>
          </div>
        );
      })}
      <div className="border-t border-line-soft px-3.5 py-2.5">
        <span className="mono text-[10.5px] text-text3">
          Préférences fixes en V1 — non modifiables.
        </span>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Small shared bits (local — single-use).                              */
/* ------------------------------------------------------------------ */

function PanelHead({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-line-soft px-3.5 py-3">
      {icon}
      <span className="disp text-[11px] font-semibold uppercase tracking-[0.11em] text-text2">
        {title}
      </span>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  k,
  v,
  hint,
  last = false,
}: {
  icon: LucideIcon;
  k: string;
  v: React.ReactNode;
  hint?: string;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 py-2.5",
        !last && "border-b border-line-soft",
      )}
    >
      <Icon size={15} strokeWidth={2} className="flex-none text-text3" aria-hidden />
      <div className="min-w-0">
        <div className="text-[12px] text-text2">{k}</div>
        {hint && <div className="mono text-[10px] text-text3">{hint}</div>}
      </div>
      <div className="ml-auto text-right text-[12px] text-text">{v}</div>
    </div>
  );
}

function StateDot({
  ok,
  okLabel,
  koLabel,
  koTone = "stop",
}: {
  ok: boolean;
  okLabel: string;
  koLabel: string;
  koTone?: "stop" | "amber";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        ok ? "text-ok" : koTone === "amber" ? "text-amber-2" : "text-stop",
      )}
    >
      <span
        className={cn(
          "h-[7px] w-[7px] rounded-full",
          ok ? "bg-ok" : koTone === "amber" ? "bg-amber" : "bg-stop",
        )}
        aria-hidden
      />
      {ok ? okLabel : koLabel}
    </span>
  );
}

function StaticToggle({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "relative h-[17px] w-[30px] flex-none rounded-[10px]",
        on ? "bg-ok" : "bg-bg-3",
      )}
      aria-hidden
    >
      <span
        className={cn(
          "absolute top-[2px] h-[13px] w-[13px] rounded-full bg-[var(--bg)]",
          on ? "right-[2px]" : "left-[2px]",
        )}
      />
    </span>
  );
}

function Pulse() {
  return (
    <span className="relative h-[8px] w-[8px] flex-none rounded-full bg-ok">
      <span
        className="absolute -inset-[4px] rounded-full border-[1.5px] border-ok opacity-60"
        style={{ animation: "oc-ring 2.4s ease-out infinite" }}
        aria-hidden
      />
    </span>
  );
}

function DeadDot() {
  return <span className="h-[8px] w-[8px] flex-none rounded-full bg-stop" aria-hidden />;
}

/* ------------------------------------------------------------------ */
/* Loading / error states (shapes shared with the other cockpit pages). */
/* ------------------------------------------------------------------ */

function LoadingState() {
  return (
    <Panel className="grid place-items-center py-14">
      <div className="flex flex-col items-center gap-3 text-text3">
        <Spinner size={24} />
        <span className="disp text-[11px] font-semibold uppercase tracking-[0.1em]">
          Lecture de l&apos;état du système…
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
    <Panel className="grid place-items-center py-14 text-center">
      <div className="flex max-w-[360px] flex-col items-center gap-3">
        <Server size={26} strokeWidth={1.8} className="text-stop" aria-hidden />
        <span className="text-[13px] font-medium text-text2">
          Backend injoignable
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

function InlineError({ message }: { message: string }) {
  return (
    <div className="oc-fade mb-1 flex items-start gap-2 rounded-[8px] border border-stop-bg bg-stop-bg px-3 py-2.5 text-[12px] text-stop">
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
