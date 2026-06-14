import { cn } from "@/lib/cn";

/**
 * Generic loading ring (amber accent). Used for page-level loading states.
 * For the inline "running" pulse inside status chips, see StatusChip.
 */
export function Spinner({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label="Chargement"
      className={cn("inline-block animate-spin rounded-full", className)}
      style={{
        width: size,
        height: size,
        borderWidth: Math.max(2, Math.round(size / 9)),
        borderStyle: "solid",
        borderColor: "var(--line)",
        borderTopColor: "var(--amber)",
      }}
    />
  );
}
