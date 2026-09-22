import { Clock } from "lucide-react";

/**
 * "How long has this been sitting untouched?" — `days` is computed once,
 * server-side, from `createdAt` (see page.tsx) — deliberately never calls
 * `Date.now()` inside this (or any) component body, which React's purity
 * rules flag as an impure render. Color-escalating so a HOT lead that's
 * gone stale actually looks urgent instead of blending into the row.
 * Keyed off `createdAt`, not `updatedAt` (which the AI's own background
 * rescoring bumps), so it reflects real human idle time, not "the AI
 * touched it recently."
 */
export function AgingBadge({ days }: { days: number }) {
  const className =
    days >= 5
      ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
      : days >= 2
        ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border-border bg-muted text-muted-foreground";

  const label = days === 0 ? "New today" : days === 1 ? "1 day idle" : `${days} days idle`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}
      title={`Created ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}`}
    >
      <Clock className="size-3" /> {label}
    </span>
  );
}
