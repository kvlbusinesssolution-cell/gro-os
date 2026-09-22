"use client";

import { Info } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OpportunityScoreBreakdown } from "@/lib/business-development/opportunity-priority";

const FACTOR_LABELS: { key: keyof Omit<OpportunityScoreBreakdown, "total">; label: string }[] = [
  { key: "problemSeverity", label: "Problem severity" },
  { key: "serviceMatch", label: "Service match" },
  { key: "evidenceQuality", label: "Evidence quality" },
  { key: "intent", label: "Buying intent" },
  { key: "businessRelevance", label: "Business relevance" },
];

function barColor(value: number): string {
  if (value >= 70) return "bg-emerald-500";
  if (value >= 40) return "bg-amber-500";
  return "bg-red-500";
}

/**
 * "Why this score?" explainability — click-to-open, not hover, since the
 * content is read-length text plus five bars, not a one-line tooltip.
 * Renders ONLY real, already-stored data (`opportunityScoreBreakdown` +
 * `priorityReasoning`, both written by computeOpportunityScore — see
 * opportunity-priority.ts) — never a fabricated explanation for
 * pre-Phase-4 rows that haven't been scored yet.
 */
export function ScoreBreakdownMenu({
  children,
  breakdown,
  priorityReasoning,
}: {
  children: React.ReactNode;
  breakdown: OpportunityScoreBreakdown | null;
  priorityReasoning: string | null;
}) {
  if (!breakdown) return <>{children}</>;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="group inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {children}
          <Info className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-3">
        <DropdownMenuLabel className="px-0 text-sm font-semibold text-foreground">Why this score?</DropdownMenuLabel>
        {priorityReasoning && <p className="mb-3 mt-1 text-xs text-muted-foreground">{priorityReasoning}</p>}
        <DropdownMenuSeparator className="mb-3" />
        <div className="flex flex-col gap-2.5">
          {FACTOR_LABELS.map(({ key, label }) => {
            const value = breakdown[key];
            return (
              <div key={key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{label}</span>
                  <span className="font-medium text-foreground">{value}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${barColor(value)}`} style={{ width: `${value}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <DropdownMenuSeparator className="my-3" />
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Total opportunity score</span>
          <span className="font-semibold text-foreground">{breakdown.total}</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
