import { Flame, Sun, Snowflake, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import type { IntentBand } from "@/generated/prisma/client";

/**
 * Phase 28 — real IntentScore.band badge, same visual pattern as
 * LeadScoreBadge (lead-score-badge.tsx), reused (not duplicated) wherever
 * a compact real intent indicator is needed outside the full
 * CompanyIntentScorePanel (Watchlists, Priority Queue).
 */
const BAND_STYLE: Record<IntentBand, { label: string; icon: typeof Flame; className: string }> = {
  HIGH: { label: "High intent", icon: Flame, className: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400" },
  MEDIUM: { label: "Medium intent", icon: Sun, className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  LOW: { label: "Low intent", icon: Snowflake, className: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  NONE: { label: "No intent signal", icon: Minus, className: "border-border bg-muted text-muted-foreground" },
};

export interface IntentScoreBadgeProps {
  band: IntentBand;
  score?: number;
  className?: string;
}

export function IntentScoreBadge({ band, score, className }: IntentScoreBadgeProps) {
  const { label, icon: Icon, className: bandClassName } = BAND_STYLE[band];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        bandClassName,
        className,
      )}
    >
      <Icon className="size-3" />
      {label}
      {typeof score === "number" && <span className="opacity-70">· {score}</span>}
    </span>
  );
}
