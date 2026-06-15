"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Terminal,
  Building2,
  Bot,
  ListChecks,
  ShieldCheck,
  FileText,
  ClipboardList,
  ListTree,
  Settings,
  LogOut,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { clearToken } from "@/lib/auth";
import { api } from "@/lib/api";
import type { OpenClawStatus } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/openclaw", label: "Centre OpenClaw", icon: Terminal },
  { href: "/projects", label: "Projets", icon: Building2 },
  { href: "/agents", label: "Sous-agents", icon: Bot },
  { href: "/skills", label: "Skills", icon: Sparkles },
  { href: "/tasks", label: "Tâches", icon: ListChecks },
  { href: "/approvals", label: "Validations", icon: ShieldCheck },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/tenders", label: "Appels d'offres", icon: ClipboardList },
  { href: "/logs", label: "Logs", icon: ListTree },
  { href: "/settings", label: "Paramètres", icon: Settings },
];

function formatRelative(isoString: string | null): string {
  if (!isoString) return "—";
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `il y a ${diff}s`;
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`;
  return `il y a ${Math.floor(diff / 86400)}j`;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [ocStatus, setOcStatus] = useState<OpenClawStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const s = await api.getOpenclawStatus();
        if (!cancelled) setOcStatus(s);
      } catch {
        // backend unreachable — keep previous value
      }
    }

    void fetchStatus();
    const id = setInterval(() => void fetchStatus(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function logout() {
    clearToken();
    router.replace("/login");
  }

  const connected = ocStatus?.connected ?? false;
  const lastSeen = formatRelative(ocStatus?.last_seen ?? null);
  const modelInfo = ocStatus?.model_info;
  const modelLabel =
    typeof modelInfo?.default_provider === "string"
      ? modelInfo.default_provider
      : ocStatus === null
      ? "…"
      : "—";

  return (
    <aside className="flex h-full flex-col overflow-y-auto border-r border-line bg-bg-1 px-3 py-3.5">
      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-[11px] border-l-2 border-transparent py-2 pl-[13px] pr-[11px] text-[13px] font-medium text-text2 transition-colors",
                active
                  ? "rounded-r-[7px] border-l-amber bg-bg-2 text-text"
                  : "rounded-[7px] hover:bg-bg-2 hover:text-text",
              )}
            >
              <Icon
                size={18}
                strokeWidth={2}
                className={cn("flex-none", active && "text-amber")}
                aria-hidden
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="my-3.5 h-px bg-line-soft" />

      {/* OpenClaw status block */}
      <div className="mx-1 rounded-[9px] border border-line-soft bg-bg-2 p-3">
        <div className="mb-2 flex items-center gap-2 border-b border-line-soft pb-2">
          {connected ? <Pulse /> : <DotRed />}
          <span
            className={cn(
              "disp text-[11px] font-semibold uppercase tracking-[0.11em]",
              connected ? "text-ok" : "text-stop",
            )}
          >
            Statut OpenClaw
          </span>
        </div>
        <StatusRow
          k="État"
          v={connected ? "Connecté" : "Déconnecté"}
          ok={connected}
          err={!connected}
        />
        <StatusRow k="Dernier contact" v={lastSeen} />
        <StatusRow k="Modèle" v={modelLabel} />
      </div>

      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={logout}
          className="flex w-full items-center gap-[11px] rounded-[7px] px-[13px] py-2 text-[13px] font-medium text-text2 transition-colors hover:bg-bg-2 hover:text-text"
        >
          <LogOut size={18} strokeWidth={2} className="flex-none" aria-hidden />
          Déconnexion
        </button>
        <div className="mono mx-1.5 mt-3 text-[10px] leading-[1.8] text-text3">
          <span className={connected ? "text-ok" : "text-stop"}>●</span>{" "}
          backend · local
          <br />
          cockpit v0.1.0
        </div>
      </div>
    </aside>
  );
}

function StatusRow({
  k,
  v,
  ok = false,
  err = false,
}: {
  k: string;
  v: string;
  ok?: boolean;
  err?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11.5px] text-text3">{k}</span>
      <span
        className={cn(
          "mono text-[11.5px]",
          ok ? "text-ok" : err ? "text-stop" : "text-text2",
        )}
      >
        {v}
      </span>
    </div>
  );
}

function DotRed() {
  return (
    <span className="relative h-[8px] w-[8px] flex-none rounded-full bg-stop" />
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
