"use client";

import { useState } from "react";
import { AlertTriangle, Check, Mail, Send, X } from "lucide-react";
import type { ExportFormat } from "@/lib/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/Spinner";

/** Accent colour per PDF variant (selected state of the brand picker). */
const BRAND_COLOR: Partial<Record<ExportFormat, string>> = {
  pdf: "#E30613",
  ced: "#0A8A0A",
  suivisio: "#1184CC",
  brume: "#0E80D0",
};

export interface BrandOption {
  value: ExportFormat;
  label: string;
}

interface EmailModalProps {
  documentId: string;
  defaultTo?: string;
  defaultSubject?: string;
  /** PDF variants offered. First entry is the default selection. */
  brands: BrandOption[];
  onClose: () => void;
}

const inputCls = cn(
  "w-full rounded-[9px] border border-line bg-bg-2 px-3 py-2.5 text-[13px] text-text",
  "placeholder:text-text3 outline-none transition-colors focus:border-amber-line",
);
const labelCls = "disp text-[10px] font-semibold uppercase tracking-[0.1em] text-text3";

export function EmailModal({
  documentId,
  defaultTo = "",
  defaultSubject = "",
  brands,
  onClose,
}: EmailModalProps) {
  const [to, setTo] = useState(defaultTo);
  const [brand, setBrand] = useState<ExportFormat>(brands[0]?.value ?? "pdf");
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(
    "Bonjour,\n\nVeuillez trouver ci-joint votre devis.\n\nCordialement,",
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const canSend = /\S+@\S+\.\S+/.test(to) && !sending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await api.emailDocument(documentId, { to, subject, message, brand });
      setSentTo(res.to);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Envoi impossible.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[oklch(0.12_0.006_68_/_0.62)] p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div
        className="oc-fade relative w-full max-w-[460px] overflow-hidden rounded-[12px] border border-line bg-bg-1 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span className="absolute inset-y-0 left-0 w-[3px] bg-amber" aria-hidden />

        <div className="flex items-center gap-2.5 border-b border-line-soft px-[18px] py-3.5">
          <Mail size={16} strokeWidth={2} className="text-amber" aria-hidden />
          <span className="disp text-[11.5px] font-semibold uppercase tracking-[0.13em] text-amber-2">
            Envoyer le devis par email
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="ml-auto grid h-7 w-7 place-items-center rounded-[7px] text-text2 transition-colors hover:bg-bg-2 hover:text-text"
          >
            <X size={15} strokeWidth={2.2} aria-hidden />
          </button>
        </div>

        {sentTo ? (
          <div className="flex flex-col items-center gap-3 px-[18px] py-10 text-center">
            <span
              className="grid h-11 w-11 place-items-center rounded-full"
              style={{ background: "#0A8A0A22" }}
            >
              <Check size={22} strokeWidth={2.4} style={{ color: "#0A8A0A" }} aria-hidden />
            </span>
            <p className="text-[13px] text-text">
              Devis envoyé à <span className="font-medium">{sentTo}</span>.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-1 rounded-[8px] border border-line px-3.5 py-2 font-[var(--font-saira)] text-[12px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:bg-bg-2 hover:text-text"
            >
              Fermer
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3.5 px-[18px] py-4">
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Destinataire</span>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="client@exemple.fr"
                required
                autoFocus
                className={inputCls}
              />
            </label>

            {brands.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <span className={labelCls}>Variante du PDF</span>
                <div className="flex gap-2">
                  {brands.map((b) => {
                    const active = b.value === brand;
                    const col = BRAND_COLOR[b.value] ?? "var(--amber)";
                    return (
                      <button
                        key={b.value}
                        type="button"
                        onClick={() => setBrand(b.value)}
                        className={cn(
                          "flex-1 rounded-[8px] border py-2 text-[12px] transition-colors",
                          active
                            ? "font-semibold"
                            : "border-line font-medium text-text2 hover:text-text",
                        )}
                        style={active ? { borderColor: col, color: col } : undefined}
                      >
                        {b.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Objet</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Votre devis"
                className={inputCls}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Message</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className={cn(inputCls, "resize-none leading-[1.55]")}
              />
            </label>

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
                disabled={sending}
                className="rounded-[8px] border border-line px-3.5 py-2 font-[var(--font-saira)] text-[12px] font-semibold tracking-[0.04em] text-text2 transition-colors hover:bg-bg-2 hover:text-text disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={!canSend}
                className="flex items-center gap-2 rounded-[8px] bg-amber px-4 py-2 font-[var(--font-saira)] text-[12px] font-semibold tracking-[0.04em] text-[color:var(--amber-fg)] transition-colors hover:bg-amber-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? <Spinner size={14} /> : <Send size={14} strokeWidth={2.2} aria-hidden />}
                {sending ? "Envoi…" : "Envoyer"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
