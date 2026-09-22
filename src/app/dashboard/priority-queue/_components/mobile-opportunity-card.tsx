"use client";

import Link from "next/link";
import { ListOrdered } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { confidenceBadgeClassName, PRIORITY_BADGE_CLASSNAME, PRIORITY_LABEL } from "../../opportunities/_lib/opportunity-display";
import type { PriorityQueueRow } from "../_lib/types";
import { AgingBadge } from "./aging-badge";
import { ScoreBreakdownMenu } from "./score-breakdown-menu";
import { ScoreTrendBadge } from "./score-trend-badge";
import { RowActions, type MemberOption } from "./row-actions";

/**
 * Card layout for the Priority Queue on small screens — the dense 7-column
 * table (page.tsx's desktop <Table>) doesn't reflow usefully below ~640px,
 * so this is a genuinely different layout for the same rows, not a
 * squeezed table. Toggled purely by Tailwind breakpoints (`sm:hidden` on
 * the card list / `hidden sm:block` on the table) in priority-queue-table.tsx
 * — no JS viewport detection, so it's correct on first paint (no
 * flash-of-wrong-layout) and works with JS disabled too.
 */
export function MobileOpportunityCard({
  row,
  selected,
  onToggleSelect,
  currentUserId,
  members,
}: {
  row: PriorityQueueRow;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  currentUserId: string;
  members: MemberOption[];
}) {
  return (
    <div className="glass-panel flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="pt-0.5">
            <Checkbox checked={selected} onChange={() => onToggleSelect(row.id)} aria-label={`Select ${row.companyName}`} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <ListOrdered className="size-3.5 shrink-0 text-muted-foreground" />
              <Link href={`/dashboard/companies/${row.companyId}`} className="font-medium text-foreground transition-colors hover:text-primary">
                {row.companyName}
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">{[row.companyIndustry, row.companyCountry].filter(Boolean).join(" · ") || "No profile details yet"}</p>
          </div>
        </div>
        {row.priority && (
          <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium ${PRIORITY_BADGE_CLASSNAME[row.priority]}`}>
            {PRIORITY_LABEL[row.priority]}
          </span>
        )}
      </div>

      <Link href={`/dashboard/opportunities/${row.id}`} className="text-sm font-medium text-foreground transition-colors hover:text-primary">
        {row.title}
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        {row.opportunityScore !== null && row.opportunityScoreBreakdown ? (
          <ScoreBreakdownMenu breakdown={row.opportunityScoreBreakdown} priorityReasoning={row.priorityReasoning}>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${confidenceBadgeClassName(row.opportunityScore)}`}>
              Score {row.opportunityScore}
            </span>
          </ScoreBreakdownMenu>
        ) : (
          <span className="text-xs text-muted-foreground">Not scored yet</span>
        )}
        <ScoreTrendBadge current={row.opportunityScore} previous={row.previousOpportunityScore} />
        <AgingBadge days={row.ageDays} />
        {row.ownerName && (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{row.ownerName}</span>
        )}
      </div>

      <p className="line-clamp-2 text-sm text-muted-foreground">{row.nextAction}</p>

      <div className="flex items-center justify-end border-t border-border pt-2">
        <RowActions
          opportunityId={row.id}
          status={row.status}
          ownerUserId={row.ownerUserId}
          isSnoozed={row.isSnoozed}
          currentUserId={currentUserId}
          members={members}
        />
      </div>
    </div>
  );
}
