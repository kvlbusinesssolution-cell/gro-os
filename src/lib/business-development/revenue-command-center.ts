import { prisma } from "@/lib/prisma";

/**
 * Revenue Command Center — single-screen "TODAY" funnel across the whole
 * Company Discovery -> Opportunity -> Decision Maker -> Outreach ->
 * Reply -> Meeting -> Proposal -> Deal pipeline (Phases 1-10). Generic,
 * per-org (not KVL-hardcoded — every org running this pipeline gets its own
 * real numbers), same multi-tenant discipline as the rest of the app.
 *
 * Every count below is a real Prisma count()/aggregate(), scoped to a single
 * calendar day in the server's local time (same convention as
 * ensureTodayCampaignSnapshot's startOfDay, src/lib/outreach/campaign-analytics.ts)
 * — never estimated, never AI-generated.
 *
 * "Qualified" reuses decision-maker-sync-job.ts's own existing definition
 * (has at least one LeadOpportunity) rather than inventing a second one.
 * "Ready for outreach" = qualified AND has at least one DecisionMaker — the
 * two real preconditions convertOpportunityToOutreachCore
 * (opportunity-outreach-actions.ts) actually needs to succeed.
 */
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface RevenueCommandCenterToday {
  asOf: Date;
  dayStart: Date;
  companiesFound: number;
  qualified: number;
  highIntent: number;
  readyForOutreach: number;
  emailsSent: number;
  replies: number;
  meetings: number;
  proposals: number;
  won: number;
  /** Number of Won deals whose stage moved to Won today, best-effort — see field doc below. */
  wonCaveat: string;
  /** Real current open-pipeline value (not a "today" delta) from deals on companies this pipeline discovered. Null when there are no such deals with a real value yet — never a fabricated number. */
  pipelineValue: number | null;
  pipelineDealCount: number;
}

export interface RevenueCommandCenterFunnel {
  totalReplies: number;
  totalMeetings: number;
  totalProposals: number;
  totalWonDeals: number;
  /** Null when the denominator is 0 — "no data yet", never a fabricated 0% or 100%. */
  replyToMeetingRate: number | null;
  meetingToProposalRate: number | null;
  proposalToDealRate: number | null;
}

export async function computeRevenueCommandCenterToday(organizationId: string, now: Date = new Date()): Promise<RevenueCommandCenterToday> {
  const dayStart = startOfDay(now);

  const [
    companiesFoundToday,
    qualifiedToday,
    highIntentToday,
    readyForOutreachToday,
    emailsSent,
    replies,
    meetings,
    proposals,
    won,
    openPipelineDeals,
  ] = await Promise.all([
    prisma.company.findMany({
      where: { organizationId, createdAt: { gte: dayStart } },
      select: { id: true },
    }),
    prisma.company.count({
      where: { organizationId, createdAt: { gte: dayStart }, leadOpportunities: { some: {} } },
    }),
    prisma.company.count({
      where: { organizationId, createdAt: { gte: dayStart }, intentScore: { band: "HIGH" } },
    }),
    prisma.company.count({
      where: { organizationId, createdAt: { gte: dayStart }, leadOpportunities: { some: {} }, decisionMakers: { some: {} } },
    }),
    prisma.emailDraft.count({
      where: { organizationId, status: "SENT", sentAt: { gte: dayStart } },
    }),
    prisma.reply.count({
      where: { organizationId, receivedAt: { gte: dayStart } },
    }),
    prisma.outreachMeeting.count({
      where: { organizationId, createdAt: { gte: dayStart } },
    }),
    prisma.proposal.count({
      where: { organizationId, createdAt: { gte: dayStart } },
    }),
    prisma.deal.count({
      where: { organizationId, dealStage: { name: "Won" }, updatedAt: { gte: dayStart } },
    }),
    prisma.deal.findMany({
      where: {
        organizationId,
        dealStage: { name: { notIn: ["Won", "Lost", "Archived"] } },
        company: { leadOpportunities: { some: {} } },
      },
      select: { value: true },
    }),
  ]);

  const pipelineValues = openPipelineDeals.map((d) => d.value).filter((v): v is number => v != null);
  const pipelineValue = pipelineValues.length > 0 ? pipelineValues.reduce((sum, v) => sum + v, 0) : null;

  return {
    asOf: now,
    dayStart,
    companiesFound: companiesFoundToday.length,
    qualified: qualifiedToday,
    highIntent: highIntentToday,
    readyForOutreach: readyForOutreachToday,
    emailsSent,
    replies,
    meetings,
    proposals,
    won,
    wonCaveat: "Deals currently in the Won stage last updated today — Deal has no dedicated wonAt timestamp, so this is a best-effort proxy, not an exact 'moved to Won today' count.",
    pipelineValue,
    pipelineDealCount: openPipelineDeals.length,
  };
}

/** Lifetime-to-date conversion funnel (not scoped to today — a single day's counts are too small to show a meaningful rate on a brand-new pipeline). */
export async function computeRevenueCommandCenterFunnel(organizationId: string): Promise<RevenueCommandCenterFunnel> {
  const [totalReplies, totalMeetings, totalProposals, totalWonDeals] = await Promise.all([
    prisma.reply.count({ where: { organizationId } }),
    prisma.outreachMeeting.count({ where: { organizationId } }),
    prisma.proposal.count({ where: { organizationId } }),
    prisma.deal.count({ where: { organizationId, dealStage: { name: "Won" } } }),
  ]);

  return {
    totalReplies,
    totalMeetings,
    totalProposals,
    totalWonDeals,
    replyToMeetingRate: totalReplies > 0 ? totalMeetings / totalReplies : null,
    meetingToProposalRate: totalMeetings > 0 ? totalProposals / totalMeetings : null,
    proposalToDealRate: totalProposals > 0 ? totalWonDeals / totalProposals : null,
  };
}
