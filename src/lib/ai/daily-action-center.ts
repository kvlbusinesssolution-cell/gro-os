import { prisma } from "@/lib/prisma";

import { computeGrowthSignals } from "./executive-briefing";

/**
 * Phase 10 (Autonomous Growth Operating System) — the "Daily Action Center"
 * spec's TODAY'S AI ACTIONS list ("1. Follow up with 3 proposal
 * opportunities. 2. Review 5 high-intent leads. 3. Approve 8 outreach
 * drafts. 4. Contact 2 meeting-ready prospects. 5. Review stalled deal.").
 *
 * Every number here is a plain Prisma count (or a direct reuse of an
 * already-computed GrowthSignals field — never requeried) against a real
 * Phase 1-9 table. Nothing is AI-generated: this function composes a
 * deterministic navigational list, not a to-do list an LLM invented. Each
 * item is meant to be rendered as a link to the real existing page where a
 * human takes the actual (consequential, approval-gated) action — this
 * function never executes anything itself.
 *
 * Items with a count of 0 are omitted entirely (an honest empty state, not
 * a fabricated placeholder row) — see buildGrowthSignalsSummaryLines in
 * executive-briefing.ts for the same "never a bare misleading 0" discipline.
 */
export interface TodaysActionItem {
  /** Noun phrase describing what the count refers to, meant to be rendered as `${count} ${label}`. */
  label: string;
  count: number;
  /** Real existing page where a human reviews/approves the underlying rows. */
  href: string;
}

// Same "not yet done" definition action-items/page.tsx's status tabs use —
// OPEN/IN_PROGRESS are still actionable, DONE/CANCELLED are not.
const OPEN_ACTION_ITEM_STATUSES = ["OPEN", "IN_PROGRESS"] as const;

export async function computeTodaysActions(organizationId: string): Promise<TodaysActionItem[]> {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const [signals, dueActionItemsCount, pendingDraftsCount, requestCallReplies] = await Promise.all([
    // Reuses computeGrowthSignals rather than requerying Proposal/LeadOpportunity/Deal —
    // pendingProposalsCount (real Proposal.status === "SENT"), hotOpportunitiesCount
    // (real LeadOpportunity.priority === "HOT"), and atRiskDealsCount are already
    // computed there with the org's real Phase 1-9 rows.
    computeGrowthSignals(organizationId),
    prisma.actionItem.count({
      where: {
        organizationId,
        status: { in: [...OPEN_ACTION_ITEM_STATUSES] },
        dueDate: { lte: endOfToday },
      },
    }),
    prisma.emailDraft.count({ where: { organizationId, status: "PENDING_APPROVAL" } }),
    // Real Reply.intent === "REQUEST_CALL" rows, one per distinct contact —
    // "meeting-ready prospects" the outreach team hasn't been asked to
    // follow up on yet (see the no-Task check below).
    prisma.reply.findMany({
      where: { organizationId, intent: "REQUEST_CALL" },
      select: { contactId: true },
      distinct: ["contactId"],
    }),
  ]);

  // A prospect only counts as still needing outreach if no real Task has
  // been created for that contact yet — once a Task exists, a human/agent
  // is already tracking the follow-up, so it would be misleading to keep
  // surfacing it here as an unactioned item.
  let meetingReadyProspectsCount = 0;
  if (requestCallReplies.length > 0) {
    const contactIds = requestCallReplies.map((r) => r.contactId);
    const contactsWithTask = await prisma.task.findMany({
      where: { organizationId, contactId: { in: contactIds } },
      select: { contactId: true },
      distinct: ["contactId"],
    });
    const contactIdsWithTask = new Set(contactsWithTask.map((t) => t.contactId));
    meetingReadyProspectsCount = contactIds.filter((id) => !contactIdsWithTask.has(id)).length;
  }

  const items: TodaysActionItem[] = [
    {
      label: "action items due today or overdue",
      count: dueActionItemsCount,
      href: "/board/action-items",
    },
    {
      label: "proposal opportunities to follow up with",
      count: signals.pendingProposalsCount,
      href: "/dashboard/proposal/proposals",
    },
    {
      label: "high-intent leads to review",
      count: signals.hotOpportunitiesCount,
      href: "/dashboard/priority-queue?priority=HOT",
    },
    {
      label: "outreach drafts to approve",
      count: pendingDraftsCount,
      href: "/dashboard/outreach",
    },
    {
      label: "meeting-ready prospects to contact",
      count: meetingReadyProspectsCount,
      href: "/dashboard/outreach/contacts",
    },
    {
      label: "stalled deals to review",
      count: signals.atRiskDealsCount,
      href: "/dashboard/crm/deals",
    },
  ];

  return items.filter((item) => item.count > 0);
}
