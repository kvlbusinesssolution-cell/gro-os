"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Clock3, Handshake, Loader2, UserPlus, X, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { bulkAddToCrm, bulkAssignToMe, bulkDismiss, bulkSnooze, type ActionResult, type BulkActionResult } from "../actions";

const SNOOZE_OPTIONS = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
];

/**
 * Floating bulk-triage bar — appears once 1+ rows are checkbox-selected
 * (see priority-queue-table.tsx). Every action here is a thin wrapper over
 * the same bulk server actions the "..." per-row menu's single-row actions
 * are built on (actions.ts's runBulk loop over the shared triage cores), so
 * bulk triage can never diverge from single-row triage rules.
 */
export function BulkActionBar({ selectedIds, onClear }: { selectedIds: string[]; onClear: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const count = selectedIds.length;

  function report(label: string, result: BulkActionResult) {
    if (result.error) {
      toast.error(result.error);
    } else if (result.failed === 0) {
      toast.success(`${label}: ${result.succeeded} opportunit${result.succeeded === 1 ? "y" : "ies"}.`);
    } else {
      toast.error(`${label}: ${result.succeeded} succeeded, ${result.failed} skipped (already in a terminal state).`);
    }
    router.refresh();
    onClear();
  }

  function run(action: () => Promise<BulkActionResult>, label: string) {
    startTransition(async () => {
      const result = await action();
      report(label, result);
    });
  }

  // assignOpportunity/snoozeOpportunity's bulk wrappers (bulkAssignToMe,
  // bulkSnooze) apply to every selected id in one updateMany and return a
  // plain ActionResult, not a per-row succeeded/failed tally — normalize to
  // the same report() shape (all-or-nothing) rather than duplicating the
  // toast logic.
  function runSimple(action: () => Promise<ActionResult>, label: string) {
    startTransition(async () => {
      const result = await action();
      report(label, result.ok ? { ok: true, succeeded: count, failed: 0 } : { ok: false, error: result.error, succeeded: 0, failed: count });
    });
  }

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
        >
          <div className="flex items-center gap-2 rounded-2xl border border-border glass-panel-strong px-4 py-3 shadow-elevated">
            <span className="text-sm font-medium text-foreground">
              {count} selected
            </span>
            <div className="h-5 w-px bg-border" />
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => bulkAddToCrm(selectedIds), "Added to CRM")}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Handshake className="size-3.5" />} Add to CRM
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => bulkDismiss(selectedIds), "Dismissed")}>
              <XCircle className="size-3.5" /> Dismiss
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => runSimple(() => bulkAssignToMe(selectedIds), "Assigned to you")}>
              <UserPlus className="size-3.5" /> Assign to me
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" disabled={pending}>
                  <Clock3 className="size-3.5" /> Snooze
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" side="top">
                {SNOOZE_OPTIONS.map((opt) => (
                  <DropdownMenuItem key={opt.days} disabled={pending} onClick={() => runSimple(() => bulkSnooze(selectedIds, opt.days), `Snoozed for ${opt.label}`)}>
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="h-5 w-px bg-border" />
            <Button size="icon-sm" variant="ghost" title="Clear selection" onClick={onClear}>
              <X className="size-3.5" />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
