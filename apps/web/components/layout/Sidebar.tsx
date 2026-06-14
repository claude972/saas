"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Terminal,
  Building2,
  Bot,
  ListChecks,
  ShieldCheck,
  FileText,
  ListTree,
  Settings,
  LogOut,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { clearToken } from "@/lib/auth";

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
  { href: "/logs", label: "Logs", icon: ListTree },
  { href: "/settings", label: "Paramètres", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function logout() {
    clearToken();
    router.replace("/login");
  }

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
          <Pulse />
          <span className="disp text-[11px] font-semibold uppercase tracking-[0.11em] text-ok">
            Statut OpenClaw
          </span>
        </div>
        <StatusRow k="État" v="Opérationnel" amber />
        <StatusRow k="Modèle actif" v="opus-4.8" />
        <StatusRow k="Backend" v="FastAPI" />
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
          <span className="text-ok">●</span> backend · local
          <br />
          postgres · 7 tables
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
  amber = false,
}: {
  k: string;
  v: string;
  amber?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11.5px] text-text3">{k}</span>
      <span
        className={cn(
          "mono text-[11.5px]",
          amber ? "text-amber-2" : "text-text2",
        )}
      >
        {v}
      </span>
    </div>
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
