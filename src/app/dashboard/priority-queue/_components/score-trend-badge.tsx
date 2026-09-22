import { Minus, TrendingDown, TrendingUp } from "lucide-react";

/**
 * Score momentum indicator — compares the current Opportunity Score against
 * `previousOpportunityScore` (set inside computeOpportunityScore right
 * before it overwrites the score, see opportunity-priority.ts). Renders
 * nothing until a second real recompute has actually happened — never
 * fabricates a trend from a single snapshot.
 */
export function ScoreTrendBadge({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null) return null;

  const delta = current - previous;
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground" title="No change since last recompute">
        <Minus className="size-3" /> 0
      </span>
    );
  }

  const rising = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
        rising ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
      }`}
      title={`${rising ? "Up" : "Down"} ${Math.abs(delta)} points since the last recompute (was ${previous})`}
    >
      {rising ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {rising ? "+" : ""}
      {delta}
    </span>
  );
}
