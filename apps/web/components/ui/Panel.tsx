import { cn } from "@/lib/cn";

/**
 * Surface card matching the cockpit panels (.cmd / .rcard / .clist / .tasks).
 * - `accent` draws the amber left-bar like the command center panel.
 * - `bare` removes inner padding (for list/table panels that pad their rows).
 */
export function Panel({
  children,
  className,
  accent = false,
  bare = false,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
  bare?: boolean;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[11px] border border-line bg-panel",
        !bare && "p-4",
        className,
      )}
    >
      {accent && (
        <span
          className="absolute inset-y-0 left-0 w-[3px] bg-amber"
          aria-hidden
        />
      )}
      {children}
    </section>
  );
}
