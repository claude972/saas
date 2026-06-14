"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  MapPin,
  User,
  Tag,
  FileText,
  ListChecks,
  ListTree,
  Receipt,
  Camera,
  ClipboardCheck,
  FileSearch,
  FileStack,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  AppDocument,
  LogEntry,
  Project,
  Task,
} from "@/lib/types";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { Spinner } from "@/components/ui/Spinner";

/* ============================================================
   Project detail — reuses the cockpit layout (Sidebar/Topbar)
   and shared UI components. Loads the project, its tasks,
   documents and logs; polls while work is in flight.
   ============================================================ */

const POLL_MS = 3000;

// Task statuses that mean "still moving" → keep polling.
const LIVE_TASK = new Set(["pending", "assigned", "running", "waiting_approval"]);

interface ProjectData {
  project: Project;
  tasks: Task[];
  documents: AppDocument[];
  logs: LogEntry[];
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // `silent` refreshes (polling) must not toggle the loading spinner.
  const load = useCallback(
    async (silent: boolean) => {
      if (!id) return;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const [project, allTasks, allDocs, logs] = await Promise.all([
          api.getProject(id),
          api.listTasks(),
          api.listDocuments(),
          api.listProjectLogs(id),
        ]);
        if (!mounted.current) return;
        // The API returns global lists; scope tasks/documents to this project.
        const tasks = allTasks.filter((t) => t.project_id === id);
        const documents = allDocs.filter((d) => d.project_id === id);
        setData({ project, tasks, documents, logs });
        setError(null);
      } catch (err) {
        if (!mounted.current) return;
        // Keep showing stale data on a failed silent refresh.
        if (!silent) {
          setError(err instanceof Error ? err.message : "Erreur inconnue.");
        }
      } finally {
        if (mounted.current && !silent) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // Poll only while at least one task is still in flight.
  const hasLiveWork = !!data?.tasks.some((t) => LIVE_TASK.has(t.status));
  useEffect(() => {
    if (!hasLiveWork) return;
    const handle = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(handle);
  }, [hasLiveWork, load]);

  if (loading) {
    return (
      <div className="grid h-full place-items-center py-24">
        <Spinner size={26} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-[22px] py-[18px]">
        <BackLink />
        <Panel className="mt-4 p-6 text-center">
          <p className="text-[13px] text-hot">{error}</p>
          <button
            type="button"
            onClick={() => void load(false)}
            className="disp mt-4 rounded-[7px] border border-line bg-bg-2 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-text2 transition-colors hover:border-amber-line hover:text-text"
          >
            Réessayer
          </button>
        </Panel>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="px-[22px] py-[18px]">
        <BackLink />
        <EmptyPanel label="Projet introuvable." />
      </div>
    );
  }

  const { project, tasks, documents, logs } = data;
  const draftCount = documents.filter((d) => d.status === "draft").length;
  const activeTaskCount = tasks.filter((t) => LIVE_TASK.has(t.status)).length;

  return (
    <div className="flex flex-col gap-5 px-[22px] py-[18px]">
      <BackLink />

      {/* ===== Header band ===== */}
      <Panel accent className="oc-fade pl-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="grid h-12 w-12 flex-none place-items-center rounded-[10px] bg-bg-3 text-text2">
            <Building2 size={24} strokeWidth={1.8} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="disp text-[20px] font-semibold leading-tight tracking-[0.01em] text-text">
              {project.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-text3">
              <Meta icon={User} label={project.client_name} />
              {project.project_type && (
                <Meta icon={Tag} label={project.project_type} />
              )}
              {project.address && (
                <Meta icon={MapPin} label={project.address} />
              )}
            </div>
          </div>
          <ProjectStatusBadge status={project.status} />
        </div>

        {project.description && (
          <p className="mt-4 max-w-3xl border-t border-line-soft pt-3 text-[12.5px] leading-relaxed text-text2">
            {project.description}
          </p>
        )}
      </Panel>

      {/* ===== Instrument strip ===== */}
      <div className="oc-fade flex items-stretch overflow-hidden rounded-[11px] border border-line bg-panel">
        <StripCell label="Tâches" value={tasks.length} />
        <StripCell label="En cours" value={activeTaskCount} amber={activeTaskCount > 0} />
        <StripCell label="Documents" value={documents.length} />
        <StripCell label="Brouillons" value={draftCount} />
        <StripCell label="ID projet" mono value={shortId(project.id)} />
      </div>

      {/* ===== Documents ===== */}
      <section className="oc-fade">
        <SectionHeader
          title="Documents"
          count={documents.length}
          icon={<FileText size={16} strokeWidth={2} className="text-text2" />}
        />
        {documents.length === 0 ? (
          <EmptyPanel label="Aucun document pour ce projet." />
        ) : (
          <div className="overflow-hidden rounded-[11px] border border-line bg-panel">
            {documents.map((doc) => {
              const Icon = docIcon(doc.document_type);
              return (
                <Link
                  key={doc.id}
                  href={`/documents/${doc.id}`}
                  className="flex items-center gap-3 border-b border-line-soft px-[14px] py-[11px] transition-colors last:border-b-0 hover:bg-bg-2"
                >
                  <Icon
                    size={16}
                    strokeWidth={2}
                    className="flex-none text-text2"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-text">
                      {doc.title}
                    </div>
                    <div className="mono mt-0.5 text-[10.5px] text-text3">
                      {doc.document_type}
                    </div>
                  </div>
                  <StatusChip status={doc.status} />
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ===== Tasks ===== */}
      <section className="oc-fade">
        <SectionHeader
          title="Tâches"
          count={tasks.length}
          icon={<ListChecks size={16} strokeWidth={2} className="text-text2" />}
        />
        {tasks.length === 0 ? (
          <EmptyPanel label="Aucune tâche pour ce projet." />
        ) : (
          <div className="overflow-hidden rounded-[11px] border border-line bg-panel">
            <div className="grid grid-cols-[1fr_130px_120px] items-center gap-3 bg-bg-2 px-[14px] py-[9px]">
              <HeadCell label="Tâche" />
              <HeadCell label="Priorité" />
              <HeadCell label="Statut" />
            </div>
            {tasks.map((task) => (
              <div
                key={task.id}
                className="grid grid-cols-[1fr_130px_120px] items-center gap-3 border-b border-line-soft px-[14px] py-[10px] transition-colors last:border-b-0 hover:bg-bg-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="truncate text-[12.5px] font-medium text-text">
                    {task.title}
                  </span>
                  {task.status === "running" && <RunningBar />}
                </div>
                <PriorityTag priority={task.priority} />
                <StatusChip status={task.status} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===== Logs console ===== */}
      <section className="oc-fade">
        <SectionHeader
          title="Logs du projet"
          count={logs.length}
          icon={<ListTree size={16} strokeWidth={2} className="text-text2" />}
        />
        {logs.length === 0 ? (
          <EmptyPanel label="Aucun log pour ce projet." />
        ) : (
          <div
            className="mono overflow-y-auto rounded-[10px] border border-line-soft p-3 text-[11px] leading-[1.75]"
            style={{ background: "var(--console-bg)", maxHeight: 320 }}
          >
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-baseline gap-2.5 whitespace-nowrap"
              >
                <span className="flex-none text-text3">{logTime(log.created_at)}</span>
                <span
                  className={cn(
                    "h-[6px] w-[6px] flex-none self-center rounded-full",
                    logDot(log.level),
                  )}
                  aria-hidden
                />
                <span className={cn("flex-none", logEvent(log.level))}>
                  {log.event_type}
                </span>
                <span className="overflow-hidden text-ellipsis text-text3">
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                       */
/* ------------------------------------------------------------------ */

function BackLink() {
  return (
    <Link
      href="/projects"
      className="inline-flex items-center gap-1.5 text-[12px] text-text3 transition-colors hover:text-amber-2"
    >
      <ArrowLeft size={14} strokeWidth={2.2} aria-hidden />
      Projets
    </Link>
  );
}

function Meta({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon size={13} strokeWidth={2} className="flex-none text-text3" aria-hidden />
      <span className="text-text2">{label}</span>
    </span>
  );
}

function StripCell({
  label,
  value,
  amber = false,
  mono = false,
}: {
  label: string;
  value: string | number;
  amber?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1.5 border-r border-line-soft px-4 py-[13px] last:border-r-0">
      <span className="disp text-[10px] font-semibold uppercase tracking-[0.12em] text-text3">
        {label}
      </span>
      <span
        className={cn(
          mono
            ? "mono text-[15px] font-medium leading-none"
            : "disp tnum text-[26px] font-semibold leading-none",
          amber ? "text-amber-2" : "text-text",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function HeadCell({ label }: { label: string }) {
  return (
    <span className="disp text-[10px] font-semibold uppercase tracking-[0.1em] text-text3">
      {label}
    </span>
  );
}

const PRIORITY_LABELS: Record<string, string> = {
  high: "Haute",
  normal: "Normale",
  low: "Basse",
};

const PRIORITY_STYLES: Record<string, string> = {
  high: "text-hot",
  normal: "text-text3",
  low: "text-text3 opacity-70",
};

function PriorityTag({ priority }: { priority: string }) {
  const label = PRIORITY_LABELS[priority] ?? priority;
  const style = PRIORITY_STYLES[priority] ?? "text-text3";
  return (
    <span
      className={cn(
        "disp text-[10px] font-semibold uppercase tracking-[0.06em]",
        style,
      )}
    >
      {label}
    </span>
  );
}

function ProjectStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "Actif", cls: "text-ok bg-ok-bg" },
    on_hold: { label: "En pause", cls: "text-amber-2 bg-amber-bg" },
    archived: { label: "Archivé", cls: "text-text2 bg-bg-3" },
  };
  const def = map[status] ?? { label: status, cls: "text-text2 bg-bg-3" };
  return (
    <span
      className={cn(
        "disp inline-block flex-none whitespace-nowrap rounded-[5px] px-2.5 py-[5px] text-[10px] font-semibold uppercase tracking-[0.08em]",
        def.cls,
      )}
    >
      {def.label}
    </span>
  );
}

function RunningBar() {
  return (
    <span className="relative h-[2px] w-[46px] flex-none overflow-hidden rounded-[2px] bg-bg-3">
      <span
        className="absolute h-full w-[45%] rounded-[2px] bg-amber"
        style={{ animation: "oc-slide 1.6s ease-in-out infinite" }}
        aria-hidden
      />
    </span>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="rounded-[11px] border border-dashed border-line bg-panel px-4 py-8 text-center text-[12.5px] text-text3">
      {label}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const DOC_ICONS: Record<string, LucideIcon> = {
  quote: Receipt,
  photo_report: Camera,
  site_report: ClipboardCheck,
  tender_response: FileSearch,
};

function docIcon(type: string): LucideIcon {
  return DOC_ICONS[type] ?? FileStack;
}

function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}

function logTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function logDot(level: string): string {
  if (level === "error") return "bg-stop";
  if (level === "warn") return "bg-amber";
  return "bg-steel";
}

function logEvent(level: string): string {
  if (level === "error") return "text-stop";
  if (level === "warn") return "text-amber-2";
  return "text-text2";
}
