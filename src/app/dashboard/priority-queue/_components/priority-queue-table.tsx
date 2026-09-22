"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Keyboard, ListOrdered } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { confidenceBadgeClassName, PRIORITY_BADGE_CLASSNAME, PRIORITY_LABEL } from "../../opportunities/_lib/opportunity-display";
import { BUYING_STAGE_LABEL } from "@/lib/business-development/buying-stage-display";
import type { SortKey } from "../_lib/queries";
import type { PriorityQueueRow } from "../_lib/types";
import { AgingBadge } from "./aging-badge";
import { BulkActionBar } from "./bulk-action-bar";
import { MobileOpportunityCard } from "./mobile-opportunity-card";
import { RowActions, type MemberOption } from "./row-actions";
import { ScoreBreakdownMenu } from "./score-breakdown-menu";
import { ScoreTrendBadge } from "./score-trend-badge";
import { addOpportunityToCrm, dismissOpportunity } from "../../opportunities/_lib/opportunity-actions";
import { toast } from "@/components/ui/toast";

/** Clickable, sort-toggling <TableHead> — preserves every other querystring param, flips `dir` when the same key is clicked again. */
function SortableHead({ sortKey, children }: { sortKey: SortKey; children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const currentSort = searchParams.get("sort") ?? "priority";
  const currentDir = searchParams.get("dir") ?? "desc";
  const active = currentSort === sortKey;
  const nextDir = active && currentDir === "desc" ? "asc" : "desc";

  const params = new URLSearchParams(searchParams);
  params.set("sort", sortKey);
  params.set("dir", nextDir);
  params.delete("page");

  return (
    <TableHead>
      <Link href={`/dashboard/priority-queue?${params.toString()}`} className="flex items-center gap-1 transition-colors hover:text-foreground">
        {children}
        {active ? currentDir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
      </Link>
    </TableHead>
  );
}

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "j / ↓", description: "Focus next row" },
  { keys: "k / ↑", description: "Focus previous row" },
  { keys: "x", description: "Select / deselect focused row" },
  { keys: "a", description: "Add focused row to CRM" },
  { keys: "d", description: "Dismiss focused row" },
  { keys: "↵ Enter", description: "Open focused opportunity" },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Client island for the Priority Queue's interactive layer — checkbox
 * multi-select, keyboard-driven triage (j/k/x/a/d/Enter, Superhuman/Linear-
 * style), and the responsive table/card split. Server-fetched `rows` are
 * handed in as plain props; every mutation goes through the real server
 * actions (row-actions.tsx / bulk-action-bar.tsx) and calls router.refresh()
 * on success, so this component holds only ephemeral UI state (selection,
 * keyboard focus) — never a client-side cache of server truth.
 */
export function PriorityQueueTable({
  rows,
  currentUserId,
  members,
}: {
  rows: PriorityQueueRow[];
  currentUserId: string;
  members: MemberOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Selection/focus can reference rows from a previous filter/page. Rather
  // than syncing via a useEffect + setState (which cascades an extra
  // render), this follows React's documented "adjust state during
  // rendering" recipe: track the last-seen row set in state (not a ref —
  // refs can't be read/written during render either) and, if it changed,
  // reset synchronously in the render body itself. A full reset (not a
  // partial prune) is also the right UX here, since a new filter/page is a
  // genuinely different result set to triage fresh.
  const rowsKey = rows.map((r) => r.id).join(",");
  const [prevRowsKey, setPrevRowsKey] = useState(rowsKey);
  if (prevRowsKey !== rowsKey) {
    setPrevRowsKey(rowsKey);
    setSelected(new Set());
    setFocusedIndex(0);
  }

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((checked: boolean) => {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  }, [rows]);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || rows.length === 0) return;
      if (event.key === "?") {
        setShowShortcuts((v) => !v);
        return;
      }

      const focused = rows[focusedIndex];
      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, rows.length - 1));
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
        case "x":
          if (focused) toggleSelect(focused.id);
          break;
        case "Enter":
          if (focused) router.push(`/dashboard/opportunities/${focused.id}`);
          break;
        case "a":
          if (focused && focused.status !== "ADDED_TO_CRM") {
            void addOpportunityToCrm(focused.id).then((result) => {
              if (!result.ok) {
                toast.error(result.error ?? "Could not add to CRM.");
                return;
              }
              toast.success(`Added ${focused.companyName} to CRM.`);
              router.refresh();
            });
          }
          break;
        case "d":
          if (focused && focused.status !== "DISMISSED") {
            void dismissOpportunity(focused.id).then((result) => {
              if (!result.ok) {
                toast.error(result.error ?? "Could not dismiss.");
                return;
              }
              toast.success(`Dismissed ${focused.companyName}.`);
              router.refresh();
            });
          }
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows, focusedIndex, router, toggleSelect]);

  const selectedIds = useMemo(() => [...selected], [selected]);

  if (rows.length === 0) return null;

  return (
    <>
      <div className="flex items-center justify-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setShowShortcuts((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Keyboard className="size-3.5" /> Keyboard shortcuts
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Press ? anytime to toggle this</TooltipContent>
        </Tooltip>
      </div>

      {showShortcuts && (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/40 p-3 sm:grid-cols-3">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center gap-2 text-xs">
              <kbd className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">{s.keys}</kbd>
              <span className="text-muted-foreground">{s.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* Mobile: card list, no horizontal table scroll */}
      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map((row) => (
          <MobileOpportunityCard
            key={row.id}
            row={row}
            selected={selected.has(row.id)}
            onToggleSelect={toggleSelect}
            currentUserId={currentUserId}
            members={members}
          />
        ))}
      </div>

      {/* Desktop: dense table with checkbox multi-select + keyboard focus ring */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox checked={allSelected} onChange={(e) => selectAll(e.target.checked)} aria-label="Select all" />
              </TableHead>
              <SortableHead sortKey="company">Company</SortableHead>
              <TableHead>Opportunity</TableHead>
              <SortableHead sortKey="leadScore">Lead Score</SortableHead>
              <SortableHead sortKey="intentScore">Intent Score</SortableHead>
              <SortableHead sortKey="opportunityScore">Opportunity Score</SortableHead>
              <SortableHead sortKey="priority">Priority</SortableHead>
              <SortableHead sortKey="aging">Aging</SortableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Recommended next action</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={row.id} className={index === focusedIndex ? "ring-1 ring-inset ring-primary/50" : undefined}>
                <TableCell>
                  <Checkbox checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} aria-label={`Select ${row.companyName}`} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <ListOrdered className="size-3.5 shrink-0 text-muted-foreground" />
                    <div>
                      <Link href={`/dashboard/companies/${row.companyId}`} className="font-medium text-foreground transition-colors hover:text-primary">
                        {row.companyName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{[row.companyIndustry, row.companyCountry].filter(Boolean).join(" · ") || "No profile details yet"}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Link href={`/dashboard/opportunities/${row.id}`} className="font-medium text-foreground transition-colors hover:text-primary">
                    {row.title}
                  </Link>
                </TableCell>
                <TableCell>
                  {row.leadScore !== null ? (
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${confidenceBadgeClassName(row.leadScore)}`}>
                      {row.leadScore} · {row.leadScoreBand}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not scored yet</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.intentScore !== null ? (
                    <div className="flex flex-col gap-1">
                      <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium ${confidenceBadgeClassName(row.intentScore)}`}>
                        {row.intentScore} · {row.intentScoreBand}
                      </span>
                      {row.buyingStage && row.buyingStage !== "UNKNOWN" && (
                        <span className="text-[11px] text-muted-foreground">{BUYING_STAGE_LABEL[row.buyingStage]}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not scored yet</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.opportunityScore !== null && row.opportunityScoreBreakdown ? (
                    <div className="flex items-center gap-1.5">
                      <ScoreBreakdownMenu breakdown={row.opportunityScoreBreakdown} priorityReasoning={row.priorityReasoning}>
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${confidenceBadgeClassName(row.opportunityScore)}`}>
                          {row.opportunityScore}
                        </span>
                      </ScoreBreakdownMenu>
                      <ScoreTrendBadge current={row.opportunityScore} previous={row.previousOpportunityScore} />
                      {row.learningShadow && row.learningShadow.scoreDiff !== 0 && (
                        <Link
                          href="/dashboard/learning/patterns"
                          title="Learning suggestion — historical observation only, not applied to this score"
                          className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:underline"
                        >
                          Learning: {row.learningShadow.shadowScore} ({row.learningShadow.scoreDiff > 0 ? "+" : ""}
                          {row.learningShadow.scoreDiff})
                        </Link>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not scored yet</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.priority ? (
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${PRIORITY_BADGE_CLASSNAME[row.priority]}`}>
                      {PRIORITY_LABEL[row.priority]}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not scored yet</span>
                  )}
                </TableCell>
                <TableCell>
                  <AgingBadge days={row.ageDays} />
                </TableCell>
                <TableCell>
                  {row.ownerName ? (
                    <span className="text-xs text-foreground">{row.ownerName}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Unassigned</span>
                  )}
                </TableCell>
                <TableCell className="max-w-xs">
                  <p className="line-clamp-2 text-sm text-muted-foreground">{row.nextAction}</p>
                </TableCell>
                <TableCell className="text-right">
                  <RowActions
                    opportunityId={row.id}
                    status={row.status}
                    ownerUserId={row.ownerUserId}
                    isSnoozed={row.isSnoozed}
                    currentUserId={currentUserId}
                    members={members}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <BulkActionBar selectedIds={selectedIds} onClear={() => setSelected(new Set())} />
    </>
  );
}
