"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

const MODEL = "claude-opus-4.8";

function formatClock(d: Date): string {
  const date = new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "long",
  }).format(d);
  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${date} · ${time}`;
}

export function Topbar() {
  const [clock, setClock] = useState<string>("");

  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()));
    tick();
    const id = setInterval(tick, 1000 * 30);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="flex h-[54px] items-center gap-[18px] border-b border-line bg-bg-1 px-[18px]">
      {/* brand */}
      <div className="flex items-center gap-[11px] border-r border-line-soft pr-[18px]">
        <div className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[8px] bg-amber">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="oklch(0.2 0.02 70)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-[18px] w-[18px]"
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
          <div className="disp text-sm font-bold leading-none tracking-[0.04em]">
            BTP OpenClaw
          </div>
          <div className="disp mt-[3px] text-[9.5px] font-medium uppercase tracking-[0.22em] text-text3">
            Cockpit
          </div>
        </div>
      </div>

      {/* operational readout */}
      <div className="flex items-center gap-[9px] rounded-[20px] border border-line-soft bg-bg-2 px-[13px] py-[6px]">
        <Pulse />
        <span className="disp text-[11px] font-semibold uppercase tracking-[0.1em] text-ok">
          Opérationnel
        </span>
        <span className="mono text-[11px] text-text2">· {MODEL}</span>
      </div>

      <div className="flex-1" />

      <span className="disp rounded-[5px] border border-steel-bg bg-steel-bg px-[9px] py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">
        Interne
      </span>
      <div className="h-[22px] w-px bg-line-soft" />
      <span className="mono tnum text-[12px] text-text2">{clock || "—"}</span>

      <button
        type="button"
        aria-label="Notifications"
        className="relative grid h-[32px] w-[32px] place-items-center rounded-[7px] border border-transparent text-text2 transition-colors hover:bg-bg-2 hover:text-text"
      >
        <Bell size={17} strokeWidth={2} aria-hidden />
        <span className="absolute right-[5px] top-[5px] h-[7px] w-[7px] rounded-full border-[1.5px] border-bg-1 bg-hot" />
      </button>

      <div className="disp grid h-[30px] w-[30px] place-items-center rounded-full border border-line bg-bg-3 text-[12px] font-semibold text-amber-2">
        CB
      </div>
    </header>
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
