import {
  Check,
  Clock,
  PauseCircle,
  Loader,
  Send,
  X,
  Archive,
  Ban,
  CircleDot,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "run" | "wait" | "done" | "pend" | "fail";

interface ChipDef {
  label: string;
  tone: Tone;
  icon: LucideIcon | null; // null => blinking dot (running)
}

// Covers TaskStatus + CommandStatus + DocumentStatus + ApprovalStatus values.
const MAP: Record<string, ChipDef> = {
  // task / command shared
  pending: { label: "En attente", tone: "pend", icon: Clock },
  received: { label: "Reçu", tone: "pend", icon: CircleDot },
  routing: { label: "Routage", tone: "run", icon: null },
  assigned: { label: "Assigné", tone: "pend", icon: CircleDot },
  running: { label: "En cours", tone: "run", icon: null },
  waiting_approval: { label: "Validation", tone: "wait", icon: PauseCircle },
  completed: { label: "Terminé", tone: "done", icon: Check },
  failed: { label: "Échec", tone: "fail", icon: X },
  cancelled: { label: "Annulé", tone: "fail", icon: Ban },
  // document
  draft: { label: "Brouillon", tone: "pend", icon: CircleDot },
  approved: { label: "Approuvé", tone: "done", icon: Check },
  rejected: { label: "Refusé", tone: "fail", icon: X },
  sent: { label: "Envoyé", tone: "done", icon: Send },
  archived: { label: "Archivé", tone: "pend", icon: Archive },
  // approval
  accepted: { label: "Accepté", tone: "done", icon: Check },
};

const TONE_STYLES: Record<Tone, string> = {
  run: "text-amber-2 bg-amber-bg",
  wait: "text-hot bg-hot-bg",
  done: "text-ok bg-ok-bg",
  pend: "text-text2 bg-bg-3",
  fail: "text-stop bg-stop-bg",
};

const FALLBACK: ChipDef = { label: "—", tone: "pend", icon: Loader };

export function StatusChip({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const def = MAP[status] ?? { ...FALLBACK, label: status };
  const Icon = def.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium",
        TONE_STYLES[def.tone],
        className,
      )}
    >
      {Icon ? (
        <Icon size={13} strokeWidth={2.2} aria-hidden />
      ) : (
        <span
          className="inline-block h-[7px] w-[7px] rounded-full bg-amber"
          style={{ animation: "oc-blink 1.3s ease-in-out infinite" }}
          aria-hidden
        />
      )}
      {def.label}
    </span>
  );
}
