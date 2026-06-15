"use client";

import { useState } from "react";
import { Download, AlertTriangle } from "lucide-react";
import type { ExportFormat } from "@/lib/types";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/Spinner";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  obat: "Obat",
};

const FORMAT_MIMES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  obat: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const ALL_FORMATS: ExportFormat[] = ["pdf", "docx", "xlsx"];

/**
 * Trigger a file download by fetching the streaming endpoint with the JWT
 * in the Authorization header, then creating a temporary object URL.
 * Using fetch instead of a direct <a href> because the export route is
 * protected and browsers cannot set custom request headers on navigation.
 */
async function downloadExport(documentId: string, format: ExportFormat): Promise<void> {
  const url = api.exportDocumentUrl(documentId, format);
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: string };
      if (data.detail) msg = data.detail;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(
    new Blob([blob], { type: FORMAT_MIMES[format] }),
  );

  // Determine filename from Content-Disposition or fall back to generic name
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
  const filename = match?.[1]?.replace(/['"]/g, "") ?? `document.${format}`;

  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

interface ExportBarProps {
  documentId: string;
  /** xlsx only makes sense for quotes; hide it for other types when false */
  showXlsx?: boolean;
  /** obat export only makes sense for devis/dpgf; hide it for other types when false */
  showObat?: boolean;
  className?: string;
}

export function ExportBar({ documentId, showXlsx = true, showObat = false, className }: ExportBarProps) {
  const [loading, setLoading] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base: ExportFormat[] = showXlsx ? ALL_FORMATS : ["pdf", "docx"];
  const formats: ExportFormat[] = showObat ? [...base, "obat"] : base;

  async function handleExport(fmt: ExportFormat) {
    setLoading(fmt);
    setError(null);
    try {
      await downloadExport(documentId, fmt);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export impossible.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="micro whitespace-nowrap">Exporter</span>
        {formats.map((fmt) => {
          const isLoading = loading === fmt;
          return (
            <button
              key={fmt}
              type="button"
              onClick={() => handleExport(fmt)}
              disabled={loading !== null}
              aria-label={`Exporter en ${FORMAT_LABELS[fmt]}`}
              className={cn(
                "disp flex h-[30px] items-center gap-1.5 rounded-[7px] border px-3 text-[11.5px] font-semibold transition-colors",
                loading !== null && !isLoading
                  ? "cursor-not-allowed border-line-soft text-text3"
                  : "border-line-soft bg-bg-2 text-text2 hover:border-amber-line hover:text-text",
              )}
            >
              {isLoading ? (
                <Spinner size={12} />
              ) : (
                <Download size={13} strokeWidth={2.2} aria-hidden />
              )}
              {FORMAT_LABELS[fmt]}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-stop">
          <AlertTriangle size={13} strokeWidth={2.2} aria-hidden />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
