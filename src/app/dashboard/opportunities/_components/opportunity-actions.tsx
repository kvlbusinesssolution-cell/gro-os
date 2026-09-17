"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Eye, Handshake, XCircle, Flag, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { OpportunityStatus } from "@/generated/prisma/client";
import { addOpportunityToCrm, dismissOpportunity, markOpportunityForReview } from "../_lib/opportunity-actions";

/**
 * Triage actions for a single LeadOpportunity — "Add to CRM" / "Dismiss" /
 * "Mark for Review", plus an optional "View" link to the detail brief. Pure
 * review/triage surface: nothing here ever sends outreach or triggers a
 * campaign, it only calls the three server actions and refreshes.
 *
 * Each action is its own useTransition so one pending action never disables
 * the others, and every result is surfaced via toast (mirrors
 * install-button.tsx's convention) plus a router.refresh() on success so the
 * list/status/brief re-render with the new `status` without a full reload.
 */
export function OpportunityActions({
  opportunityId,
  status,
  showView = false,
}: {
  opportunityId: string;
  status: OpportunityStatus;
  showView?: boolean;
}) {
  const router = useRouter();
  const [addingToCrm, startAddToCrm] = useTransition();
  const [dismissing, startDismiss] = useTransition();
  const [markingReview, startMarkReview] = useTransition();

  const isAddedToCrm = status === "ADDED_TO_CRM";
  const isDismissed = status === "DISMISSED";
  const pending = addingToCrm || dismissing || markingReview;

  function handleAddToCrm() {
    startAddToCrm(async () => {
      const result = await addOpportunityToCrm(opportunityId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not add to CRM.");
        return;
      }
      toast.success("Added to CRM.");
      router.refresh();
    });
  }

  function handleDismiss() {
    startDismiss(async () => {
      const result = await dismissOpportunity(opportunityId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not dismiss.");
        return;
      }
      toast.success("Dismissed.");
      router.refresh();
    });
  }

  function handleMarkForReview() {
    startMarkReview(async () => {
      const result = await markOpportunityForReview(opportunityId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not mark for review.");
        return;
      }
      toast.success("Marked for review.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showView && (
        <Button asChild size="sm" variant="outline">
          <Link href={`/dashboard/opportunities/${opportunityId}`}>
            <Eye className="size-3.5" /> View
          </Link>
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={handleMarkForReview} disabled={pending || status === "REVIEWED" || isDismissed}>
        {markingReview ? <Loader2 className="size-3.5 animate-spin" /> : <Flag className="size-3.5" />}
        {status === "REVIEWED" ? "Reviewed" : "Mark for review"}
      </Button>
      <Button size="sm" onClick={handleAddToCrm} disabled={pending || isAddedToCrm}>
        {addingToCrm ? <Loader2 className="size-3.5 animate-spin" /> : <Handshake className="size-3.5" />}
        {isAddedToCrm ? "Added to CRM" : "Add to CRM"}
      </Button>
      <Button size="sm" variant="outline" onClick={handleDismiss} disabled={pending || isDismissed}>
        {dismissing ? <Loader2 className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
        {isDismissed ? "Dismissed" : "Dismiss"}
      </Button>
    </div>
  );
}
