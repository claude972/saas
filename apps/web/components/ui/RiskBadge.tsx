import { cn } from "@/lib/cn";
import type { RiskLevel } from "@/lib/types";

const LABELS: Record<RiskLevel, string> = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
  blocked: "Bloqué",
};

const STYLES: Record<RiskLevel, string> = {
  low: "text-ok bg-ok-bg",
  medium: "text-amber-2 bg-amber-bg",
  high: "text-hot bg-hot-bg",
  blocked: "text-stop bg-stop-bg",
};

export function RiskBadge({
  level,
  className,
}: {
  level: RiskLevel;
  className?: string;
}) {
  const key: RiskLevel = level in LABELS ? level : "low";
  return (
    <span
      className={cn(
        "disp inline-block whitespace-nowrap rounded-[5px] px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em]",
        STYLES[key],
        className,
      )}
    >
      {LABELS[key]}
    </span>
  );
}
