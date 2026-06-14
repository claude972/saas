"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, Lock, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { setToken, isAuthenticated } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Already authenticated -> skip straight to the cockpit.
  useEffect(() => {
    if (isAuthenticated()) {
      router.replace("/dashboard");
    }
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login({ email, password });
      setToken(res.access_token);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible.");
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center border-t-2 border-amber bg-bg px-4">
      <div className="w-full max-w-[380px]">
        {/* brand */}
        <div className="mb-7 flex items-center gap-3">
          <div className="grid h-[38px] w-[38px] flex-none place-items-center rounded-[9px] bg-amber">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="oklch(0.2 0.02 70)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[22px] w-[22px]"
              aria-hidden
            >
              <path d="M9 4H6a2 2 0 0 0-2 2v3" />
              <path d="M15 4h3a2 2 0 0 1 2 2v3" />
              <path d="M9 20H6a2 2 0 0 1-2-2v-3" />
              <path d="M15 20h3a2 2 0 0 0 2-2v-3" />
              <circle cx="12" cy="12" r="2.4" />
            </svg>
          </div>
          <div>
            <div className="disp text-lg font-bold leading-none tracking-[0.03em]">
              BTP OpenClaw
            </div>
            <div className="disp mt-1 text-[9.5px] font-medium uppercase tracking-[0.22em] text-text3">
              Cockpit · Accès interne
            </div>
          </div>
        </div>

        <div className="oc-fade relative overflow-hidden rounded-[12px] border border-line bg-bg-1 p-6">
          <span className="absolute inset-x-0 top-0 h-[3px] bg-amber" aria-hidden />

          <div className="mb-5 flex items-center gap-2">
            <Lock size={15} strokeWidth={2.2} className="text-amber" aria-hidden />
            <span className="disp text-[11.5px] font-semibold uppercase tracking-[0.13em] text-amber-2">
              Authentification
            </span>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Field
              label="Adresse e-mail"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="vous@entreprise.fr"
              autoComplete="username"
            />
            <Field
              label="Mot de passe"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete="current-password"
            />

            {error && (
              <div className="flex items-start gap-2 rounded-[8px] border border-stop-bg bg-stop-bg px-3 py-2.5 text-[12px] text-stop">
                <AlertTriangle
                  size={14}
                  strokeWidth={2.2}
                  className="mt-px flex-none"
                  aria-hidden
                />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="disp mt-1 flex h-[46px] items-center justify-center gap-2 rounded-[9px] bg-amber text-[13px] font-semibold tracking-[0.04em] text-[var(--amber-fg)] transition-colors hover:bg-amber-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogIn size={17} strokeWidth={2.4} aria-hidden />
              {loading ? "Connexion…" : "Se connecter"}
            </button>
          </form>
        </div>

        <p className="mono mt-5 text-center text-[10.5px] leading-[1.7] text-text3">
          Cockpit interne · OpenClaw propose · le backend valide
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="micro">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange(e.target.value)
        }
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        className="rounded-[9px] border border-line bg-bg-2 px-3.5 py-3 text-[13.5px] text-text outline-none transition-colors placeholder:text-text3 focus:border-amber-line"
      />
    </label>
  );
}
