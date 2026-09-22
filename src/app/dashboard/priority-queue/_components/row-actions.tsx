"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Check,
  Clock3,
  Eye,
  Flag,
  Handshake,
  Loader2,
  MoreHorizontal,
  Sparkles,
  UserPlus,
  UserX,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import type { OpportunityStatus } from "@/generated/prisma/client";
import { addOpportunityToCrm, dismissOpportunity, markOpportunityForReview } from "../../opportunities/_lib/opportunity-actions";
import { generateProposalFromOpportunity } from "../../opportunities/_lib/proposal-generation-actions";
import { assignOpportunity, assignOpportunityToMe, snoozeOpportunity, unsnoozeOpportunity } from "../actions";

export interface MemberOption {
  userId: string;
  name: string | null;
  email: string;
}

const SNOOZE_OPTIONS = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 30, label: "1 month" },
];

/**
 * Compact per-row triage actions for the Priority Queue — the whole point
 * of a "priority queue" is acting without leaving it. Reuses the exact same
 * server actions the /dashboard/opportunities list and detail page already
 * call (addOpportunityToCrm/dismissOpportunity/markOpportunityForReview/
 * generateProposalFromOpportunity), so triage rules can never drift between
 * the two surfaces. "Convert to outreach" deliberately stays a link to the
 * detail page — it needs a per-opportunity decision-maker/contact/draft
 * match this list's query doesn't fetch, and faking that cheaply here would
 * risk showing a wrong "already converted" state.
 */
export function RowActions({
  opportunityId,
  status,
  ownerUserId,
  isSnoozed,
  currentUserId,
  members,
}: {
  opportunityId: string;
  status: OpportunityStatus;
  ownerUserId: string | null;
  isSnoozed: boolean;
  currentUserId: string;
  members: MemberOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isAddedToCrm = status === "ADDED_TO_CRM";
  const isDismissed = status === "DISMISSED";
  const isReviewed = status === "REVIEWED";
  const isMine = ownerUserId === currentUserId;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(successMessage);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="icon-sm"
        variant="ghost"
        title={isAddedToCrm ? "Already added to CRM" : "Add to CRM"}
        disabled={pending || isAddedToCrm}
        onClick={() => run(() => addOpportunityToCrm(opportunityId), "Added to CRM.")}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Handshake className="size-3.5" />}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        title={isDismissed ? "Already dismissed" : "Dismiss"}
        disabled={pending || isDismissed}
        onClick={() => run(() => dismissOpportunity(opportunityId), "Dismissed.")}
      >
        <XCircle className="size-3.5" />
      </Button>
      <Button size="icon-sm" variant="ghost" title="View brief" asChild>
        <Link href={`/dashboard/opportunities/${opportunityId}`}>
          <Eye className="size-3.5" />
        </Link>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" title="More actions" disabled={pending}>
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem disabled={pending || isReviewed || isDismissed} onClick={() => run(() => markOpportunityForReview(opportunityId), "Marked for review.")}>
            <Flag className="size-3.5" /> {isReviewed ? "Reviewed" : "Mark for review"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={pending || isDismissed} onClick={() => run(() => generateProposalFromOpportunity(opportunityId), "Proposal drafted.")}>
            <Sparkles className="size-3.5" /> Generate proposal
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Assign</DropdownMenuLabel>
          {!isMine && (
            <DropdownMenuItem disabled={pending} onClick={() => run(() => assignOpportunityToMe(opportunityId), "Assigned to you.")}>
              <UserPlus className="size-3.5" /> Assign to me
            </DropdownMenuItem>
          )}
          {members
            .filter((m) => m.userId !== ownerUserId)
            .map((m) => (
              <DropdownMenuItem key={m.userId} disabled={pending} onClick={() => run(() => assignOpportunity(opportunityId, m.userId), `Assigned to ${m.name ?? m.email}.`)}>
                <UserPlus className="size-3.5" /> {m.name ?? m.email}
              </DropdownMenuItem>
            ))}
          {ownerUserId && (
            <DropdownMenuItem disabled={pending} onClick={() => run(() => assignOpportunity(opportunityId, null), "Unassigned.")}>
              <UserX className="size-3.5" /> Unassign
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Snooze</DropdownMenuLabel>
          {isSnoozed ? (
            <DropdownMenuItem disabled={pending} onClick={() => run(() => unsnoozeOpportunity(opportunityId), "Back in the queue.")}>
              <Check className="size-3.5" /> Bring back now
            </DropdownMenuItem>
          ) : (
            SNOOZE_OPTIONS.map((opt) => (
              <DropdownMenuItem key={opt.days} disabled={pending} onClick={() => run(() => snoozeOpportunity(opportunityId, opt.days), `Snoozed for ${opt.label}.`)}>
                <Clock3 className="size-3.5" /> Snooze {opt.label}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
