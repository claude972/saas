import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Section heading matching `.sec-h` from the maquette:
 * Saira uppercase title + optional mono count + optional "see all" link.
 */
export function SectionHeader({
  title,
  count,
  action,
  icon,
  className,
}: {
  title: string;
  count?: string | number;
  action?: { label: string; href: string };
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center gap-2.5", className)}>
      {icon}
      <span className="disp text-xs font-semibold uppercase tracking-[0.1em] text-text2">
        {title}
      </span>
      {count !== undefined && (
        <span className="mono text-[11px] text-text3">{count}</span>
      )}
      {action && (
        <Link
          href={action.href}
          className="ml-auto flex items-center gap-1 text-[11.5px] text-text3 transition-colors hover:text-amber-2"
        >
          {action.label}
          <ArrowRight size={13} strokeWidth={2.2} aria-hidden />
        </Link>
      )}
    </div>
  );
}
