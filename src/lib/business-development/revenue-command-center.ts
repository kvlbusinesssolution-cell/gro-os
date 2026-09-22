import { prisma } from "@/lib/prisma";
import { evaluateSendingIdentityHealth } from "@/lib/outreach/sending-identity";

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
  /** Deals currently in the Lost stage, same best-effort "last updated today" proxy as won/negotiations — see wonCaveat. */
  lost: number;
  /** Deals currently in the Negotiation stage, same best-effort "last updated today" proxy as won — see wonCaveat. */
  negotiations: number;
  /** EmailDraft rows with channel WHATSAPP sent today — reuses the same channel-neutral EmailDraft model WhatsAppConversation.messages points at (see schema doc on WhatsAppConversation), never a separate dataset. */
  whatsappSent: number;
  /**
   * EmailDraft rows with channel LINKEDIN sent today. Honestly near-zero by
   * design: this app's LinkedIn integration only has OIDC login/profile
   * scopes (no Partner Program messaging access — see linkedin.ts), so real
   * LinkedIn sends can't happen yet. A real 0 here reflects that limitation
   * accurately rather than fabricating LinkedIn activity.
   */
  linkedinActivity: number;
  /** Real Call rows (Phase 10 Voice) created today, any outcome. */
  calls: number;
  /** Reply rows today whose AI-classified intent is INTERESTED — a real subset of `replies`, never a separate count. */
  interestedReplies: number;
  /** Real current open-pipeline value (not a "today" delta) from deals on companies this pipeline discovered. Null when there are no such deals with a real value yet — never a fabricated number. */
  pipelineValue: number | null;
  pipelineDealCount: number;
  /** EmailDraft rows created today with `generatedByAgentId` set (an AI agent generated the draft). */
  aiDraftsCreated: number;
  /** EmailDraft rows created today with `generatedByAgentId` null — i.e. composed by a human via composeEmailCore (compose-actions.ts). Never conflated with aiDraftsCreated above. */
  humanDraftsCreated: number;
  /** EmailDraft rows created today currently sitting in PENDING_APPROVAL. */
  pendingApproval: number;
  /**
   * Phase 17: the Resend webhook now handles a real `email.delivered` event
   * (src/app/api/webhooks/resend/route.ts), setting a real EmailDraft.
   * deliveredAt from a signature-verified provider callback — the same
   * real-confirmation discipline the WhatsApp channel already had. This
   * count is still `status: SENT, bouncedAt: null` (unchanged query — see
   * that route's own comment on why `status` deliberately never moves off
   * SENT), so it remains the same honest "sent and not bounced" proxy at
   * the aggregate level; `deliveredAt` is the real per-row confirmation
   * signal now available wherever a caller reads the individual row.
   */
  delivered: number;
  /** EmailDraft rows in FAILED or BOUNCED whose sentAt (falling back to updatedAt when sentAt is null, e.g. a FAILED draft that never sent) is today. */
  failedEmails: number;
  /**
   * Phase 4 (Email Deliverability & Sender Health Engine) — real
   * SendingIdentity status counts for this org, never a revenue attribution
   * claim (rule 23: "do not attribute revenue from email metrics unless the
   * existing attribution relationship can prove it" — this is deliberately
   * just a status rollup, nothing more).
   */
  emailHealth: { identityCount: number; healthy: number; warning: number; critical: number; paused: number };
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

/**
 * Maps each Revenue Command Center tile to the real, existing page it should
 * deep-link to — never a fabricated route. Returns `null` when no honest
 * destination exists yet, in which case callers should render the tile as
 * plain (non-linked) text rather than link to `#` or an invented URL.
 *
 * - companiesFound/qualified/highIntent/readyForOutreach are Company
 *   Discovery concepts, not Email Center ones — they link to the real
 *   existing Company Discovery page.
 * - emailsSent/replies link into the real Email Center inbox
 *   (src/app/dashboard/outreach/inbox/page.tsx), using that page's actual
 *   `?view=` values (`inbox`, `sent`, `drafts` today — there is no
 *   `?view=replies` tab, so replies use `?view=inbox`, where real inbound
 *   Replies are genuinely rendered).
 * - meetings links to the CRM calendar (src/app/dashboard/crm/calendar/page.tsx),
 *   which genuinely renders OutreachMeeting rows (KIND_LABEL.outreachMeeting
 *   = "Meeting") — the only real, existing meetings view in this app today.
 * - proposals links to the Proposal Engine home.
 * - won/pipelineValue link to the real Deals board
 *   (src/app/dashboard/crm/deals/page.tsx), which has no per-stage query-param
 *   filter today, so both link to the same unfiltered board rather than an
 *   invented `?stage=Won` route.
 * - aiDraftsCreated links to the real `?view=ai` tab (getAiGeneratedEmails,
 *   src/lib/outreach/inbox.ts — `generatedByAgentId: { not: null }`, exactly
 *   matching this tile's own definition).
 * - humanDraftsCreated links to `?view=drafts` (getDraftEmails — status IN
 *   DRAFT/PENDING_APPROVAL/APPROVED/QUEUED). There is no view filtered to
 *   `generatedByAgentId: null` specifically, so this is the closest honest
 *   destination — the same "closest real view" pattern as replies -> `?view=inbox`.
 * - pendingApproval also links to `?view=drafts` — there is no dedicated
 *   `PENDING_APPROVAL`-only view; Drafts is the closest existing real page
 *   (PENDING_APPROVAL is one of the statuses it shows), per this function's
 *   own "closest honest destination" convention.
 * - delivered links to `?view=sent` (getSentEmails — status: SENT), the
 *   closest real view given this app tracks no separate delivered state.
 * - failedEmails links to the real `?view=failed` tab (getFailedEmails —
 *   status IN FAILED/REJECTED/BOUNCED, a superset of this tile's
 *   FAILED/BOUNCED definition since REJECTED isn't a send failure).
 */
export function emailCenterLinkForTile(tileKey: string): string | null {
  switch (tileKey) {
    case "companiesFound":
    case "qualified":
    case "highIntent":
    case "readyForOutreach":
      return "/dashboard/company-discovery";
    case "emailsSent":
      return "/dashboard/outreach/inbox?view=sent";
    case "replies":
      return "/dashboard/outreach/inbox?view=inbox";
    case "meetings":
      return "/dashboard/crm/calendar";
    case "proposals":
      return "/dashboard/proposal";
    case "won":
    case "lost":
    case "negotiations":
    case "pipelineValue":
      return "/dashboard/crm/deals";
    case "aiDraftsCreated":
      return "/dashboard/outreach/inbox?view=ai";
    case "humanDraftsCreated":
    case "pendingApproval":
      return "/dashboard/outreach/inbox?view=drafts";
    case "delivered":
      return "/dashboard/outreach/inbox?view=sent";
    case "failedEmails":
      return "/dashboard/outreach/inbox?view=failed";
    case "whatsappSent":
      return "/dashboard/outreach/inbox?view=sent";
    case "interestedReplies":
      return "/dashboard/outreach/inbox?view=inbox";
    // linkedinActivity and calls: no dedicated list view exists yet
    // (LinkedIn has no real send capability — see the field's own doc
    // comment — and calls are only viewable per-contact today, not as a
    // standalone list), so per this function's own rule these render as
    // plain, non-linked text rather than an invented route.
    default:
      return null;
  }
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
    aiDraftsCreated,
    humanDraftsCreated,
    pendingApproval,
    delivered,
    failedEmails,
    lost,
    negotiations,
    whatsappSent,
    linkedinActivity,
    calls,
    interestedReplies,
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
    prisma.emailDraft.count({
      where: { organizationId, generatedByAgentId: { not: null }, createdAt: { gte: dayStart } },
    }),
    prisma.emailDraft.count({
      where: { organizationId, generatedByAgentId: null, createdAt: { gte: dayStart } },
    }),
    prisma.emailDraft.count({
      where: { organizationId, status: "PENDING_APPROVAL", createdAt: { gte: dayStart } },
    }),
    prisma.emailDraft.count({
      where: { organizationId, status: "SENT", bouncedAt: null, sentAt: { gte: dayStart } },
    }),
    prisma.emailDraft.count({
      where: {
        organizationId,
        status: { in: ["FAILED", "BOUNCED"] },
        OR: [{ sentAt: { gte: dayStart } }, { sentAt: null, updatedAt: { gte: dayStart } }],
      },
    }),
    prisma.deal.count({
      where: { organizationId, dealStage: { name: "Lost" }, updatedAt: { gte: dayStart } },
    }),
    prisma.deal.count({
      where: { organizationId, dealStage: { name: "Negotiation" }, updatedAt: { gte: dayStart } },
    }),
    prisma.emailDraft.count({
      where: { organizationId, channel: "WHATSAPP", status: "SENT", sentAt: { gte: dayStart } },
    }),
    prisma.emailDraft.count({
      where: { organizationId, channel: "LINKEDIN", status: "SENT", sentAt: { gte: dayStart } },
    }),
    prisma.call.count({
      where: { organizationId, createdAt: { gte: dayStart } },
    }),
    prisma.reply.count({
      where: { organizationId, intent: "INTERESTED", receivedAt: { gte: dayStart } },
    }),
  ]);

  const pipelineValues = openPipelineDeals.map((d) => d.value).filter((v): v is number => v != null);
  const pipelineValue = pipelineValues.length > 0 ? pipelineValues.reduce((sum, v) => sum + v, 0) : null;

  const identities = await prisma.sendingIdentity.findMany({ where: { organizationId } });
  const identityHealths = await Promise.all(identities.map((identity) => evaluateSendingIdentityHealth(identity)));
  const emailHealth = {
    identityCount: identities.length,
    healthy: identityHealths.filter((h) => h.status === "GOOD" || h.status === "NOT_VERIFIED").length,
    warning: identityHealths.filter((h) => h.status === "WARNING").length,
    critical: identityHealths.filter((h) => h.status === "CRITICAL").length,
    paused: identities.filter((i) => i.status === "PAUSED").length,
  };

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
    lost,
    negotiations,
    whatsappSent,
    linkedinActivity,
    calls,
    interestedReplies,
    pipelineValue,
    pipelineDealCount: openPipelineDeals.length,
    aiDraftsCreated,
    humanDraftsCreated,
    pendingApproval,
    delivered,
    failedEmails,
    emailHealth,
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
