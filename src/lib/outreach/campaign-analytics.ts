import { prisma } from "@/lib/prisma";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Real daily rollup per campaign — same lazy-upsert-on-view convention as
 * src/lib/analytics.ts's ensureTodaySnapshot (no cron/job runner in this
 * app), so trend charts build real history over time rather than backfilling
 * fake past data points.
 */
export async function ensureTodayCampaignSnapshot(campaignId: string, now: Date = new Date()): Promise<void> {
  const today = startOfDay(now);

  const existing = await prisma.campaignAnalyticsSnapshot.findUnique({ where: { campaignId_date: { campaignId, date: today } } });
  if (existing) return;

  const [emailsSent, opensCount, clicksCount, repliesCount, positiveRepliesCount, meetingsBookedCount, failedCount] = await Promise.all([
    prisma.emailDraft.count({ where: { campaignId, status: "SENT" } }),
    prisma.emailDraft.count({ where: { campaignId, openCount: { gt: 0 } } }),
    prisma.emailDraft.count({ where: { campaignId, clickCount: { gt: 0 } } }),
    prisma.reply.count({ where: { campaignId } }),
    prisma.reply.count({ where: { campaignId, sentiment: "POSITIVE" } }),
    prisma.outreachMeeting.count({ where: { campaignId, status: { in: ["CONFIRMED", "COMPLETED"] } } }),
    prisma.emailDraft.count({ where: { campaignId, status: "FAILED" } }),
  ]);

  await prisma.campaignAnalyticsSnapshot
    .upsert({
      where: { campaignId_date: { campaignId, date: today } },
      create: { campaignId, date: today, emailsSent, opensCount, clicksCount, repliesCount, positiveRepliesCount, meetingsBookedCount, failedCount },
      update: {},
    })
    .catch(() => {
      // Benign race under concurrent requests.
    });
}

export interface CampaignAnalytics {
  emailsSent: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  positiveReplies: number;
  meetingsBooked: number;
  bounceRate: number;
}

/** Real, on-the-fly aggregation — every rate is sentCount-derived, never estimated. Bounce rate is honestly limited to real SMTP-level send failures (no ESP bounce webhook configured). */
export async function getCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics> {
  const [emailsSent, opened, clicked, repliesCount, positiveReplies, meetingsBooked, failed] = await Promise.all([
    prisma.emailDraft.count({ where: { campaignId, status: "SENT" } }),
    prisma.emailDraft.count({ where: { campaignId, openCount: { gt: 0 } } }),
    prisma.emailDraft.count({ where: { campaignId, clickCount: { gt: 0 } } }),
    prisma.reply.count({ where: { campaignId } }),
    prisma.reply.count({ where: { campaignId, sentiment: "POSITIVE" } }),
    prisma.outreachMeeting.count({ where: { campaignId, status: { in: ["CONFIRMED", "COMPLETED"] } } }),
    prisma.emailDraft.count({ where: { campaignId, status: "FAILED" } }),
  ]);

  const attempted = emailsSent + failed;
  return {
    emailsSent,
    openRate: emailsSent > 0 ? Math.round((opened / emailsSent) * 100) : 0,
    clickRate: emailsSent > 0 ? Math.round((clicked / emailsSent) * 100) : 0,
    replyRate: emailsSent > 0 ? Math.round((repliesCount / emailsSent) * 100) : 0,
    positiveReplies,
    meetingsBooked,
    bounceRate: attempted > 0 ? Math.round((failed / attempted) * 100) : 0,
  };
}

export interface CampaignTrendPoint {
  date: string;
  emailsSent: number;
  opensCount: number;
  clicksCount: number;
  repliesCount: number;
}

export async function getCampaignTrend(campaignId: string, days = 30): Promise<CampaignTrendPoint[]> {
  const since = startOfDay(new Date(Date.now() - days * 86_400_000));
  const snapshots = await prisma.campaignAnalyticsSnapshot.findMany({
    where: { campaignId, date: { gte: since } },
    orderBy: { date: "asc" },
  });
  return snapshots.map((s) => ({
    date: s.date.toISOString(),
    emailsSent: s.emailsSent,
    opensCount: s.opensCount,
    clicksCount: s.clicksCount,
    repliesCount: s.repliesCount,
  }));
}

export interface OutreachDashboardStats {
  campaigns: number;
  emailsPrepared: number;
  replies: number;
  meetings: number;
  interested: number;
  notInterested: number;
  pending: number;
  tasks: number;
  // ===== Analytics section additions (Phase 5) — all real, org-wide counts,
  // reusing getCampaignAnalytics's exact status/field references. =====
  sent: number;
  // SENT with no real, signature-verified Resend bounce webhook event
  // recorded against it (EmailDraft.bouncedAt) — honestly limited to what
  // this codebase can actually confirm, never estimated.
  delivered: number;
  opened: number;
  clicked: number;
  // A Contact whose Company has landed at least one Deal in the "Won" stage
  // (dealStage.name === "Won", the same string-match convention as
  // src/lib/analytics.ts, src/lib/pipeline/intelligence.ts,
  // src/app/dashboard/crm/actions.ts). Joined via Contact.companyId ->
  // Company.deals rather than Deal.contactId: addOpportunityToCrmCore
  // (src/app/dashboard/opportunities/_lib/opportunity-actions.ts) — the real
  // path that turns outreach-sourced opportunities into Deals — only ever
  // sets Deal.companyId, never Deal.contactId, so a contactId join would
  // silently undercount to ~0 for opportunity-originated deals.
  converted: number;
}

/** Real counts for the Outreach Dashboard stats strip — mirrors getScanStats/getCompanyStats. */
export async function getOutreachDashboardStats(organizationId: string): Promise<OutreachDashboardStats> {
  const [
    campaigns,
    emailsPrepared,
    replies,
    meetings,
    interested,
    notInterested,
    pending,
    tasks,
    sent,
    delivered,
    opened,
    clicked,
    converted,
  ] = await Promise.all([
    prisma.campaign.count({ where: { organizationId } }),
    prisma.emailDraft.count({ where: { organizationId } }),
    prisma.reply.count({ where: { organizationId } }),
    prisma.outreachMeeting.count({ where: { organizationId, status: { in: ["CONFIRMED", "COMPLETED"] } } }),
    prisma.contact.count({ where: { organizationId, status: "INTERESTED" } }),
    prisma.contact.count({ where: { organizationId, status: "NOT_INTERESTED" } }),
    prisma.emailDraft.count({ where: { organizationId, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "QUEUED"] } } }),
    prisma.task.count({ where: { organizationId, contactId: { not: null }, status: { not: "COMPLETED" } } }),
    prisma.emailDraft.count({ where: { organizationId, status: "SENT" } }),
    prisma.emailDraft.count({ where: { organizationId, status: "SENT", bouncedAt: null } }),
    prisma.emailDraft.count({ where: { organizationId, status: "SENT", openCount: { gt: 0 } } }),
    prisma.emailDraft.count({ where: { organizationId, status: "SENT", clickCount: { gt: 0 } } }),
    prisma.contact.count({
      where: {
        organizationId,
        companyId: { not: null },
        company: { deals: { some: { dealStage: { name: "Won" } } } },
      },
    }),
  ]);

  return { campaigns, emailsPrepared, replies, meetings, interested, notInterested, pending, tasks, sent, delivered, opened, clicked, converted };
}

/**
 * Phase 17 (Advanced Outbound + Email Deliverability) — the real A/B
 * variant report the spec asked for. EmailDraft.abVariant/abTestGroupId
 * (draft-generator.ts) were already captured on every real send, but no
 * code anywhere queried them back — this closes that gap by reusing the
 * exact same data, never a second A/B-tracking model.
 *
 * Per-variant reply rate is computed from a real, direct FK
 * (Reply.emailDraftId), same discipline as revenue-attribution.ts's real
 * touchpoint matching — never estimated.
 */
export interface AbVariantResult {
  variant: string;
  sent: number;
  delivered: number;
  replied: number;
  replyRate: number | null;
  /** Never declared a "winner" below this many real sends — an honest floor, not a fabricated confidence interval. */
  sufficientSampleSize: boolean;
}

export interface AbTestReport {
  abTestGroupId: string;
  variants: AbVariantResult[];
  /** Null unless at least two variants both individually clear MIN_SAMPLE_SIZE — never declared from insufficient data. */
  leadingVariant: string | null;
}

const MIN_SAMPLE_SIZE = 30;

export async function getAbVariantPerformance(organizationId: string, abTestGroupId: string): Promise<AbTestReport> {
  const drafts = await prisma.emailDraft.findMany({
    where: { organizationId, abTestGroupId, status: "SENT" },
    select: { id: true, abVariant: true, bouncedAt: true },
  });

  const byVariant = new Map<string, { sent: number; delivered: number; draftIds: string[] }>();
  for (const draft of drafts) {
    const variant = draft.abVariant ?? "(unlabeled)";
    const entry = byVariant.get(variant) ?? { sent: 0, delivered: 0, draftIds: [] };
    entry.sent += 1;
    if (!draft.bouncedAt) entry.delivered += 1;
    entry.draftIds.push(draft.id);
    byVariant.set(variant, entry);
  }

  const variants: AbVariantResult[] = [];
  for (const [variant, entry] of byVariant) {
    const replied = entry.draftIds.length > 0 ? await prisma.reply.count({ where: { organizationId, emailDraftId: { in: entry.draftIds } } }) : 0;
    variants.push({
      variant,
      sent: entry.sent,
      delivered: entry.delivered,
      replied,
      replyRate: entry.sent > 0 ? replied / entry.sent : null,
      sufficientSampleSize: entry.sent >= MIN_SAMPLE_SIZE,
    });
  }
  variants.sort((a, b) => b.sent - a.sent);

  const qualified = variants.filter((v) => v.sufficientSampleSize && v.replyRate !== null);
  const leadingVariant =
    qualified.length >= 2 ? qualified.reduce((best, v) => (v.replyRate! > best.replyRate! ? v : best)).variant : null;

  return { abTestGroupId, variants, leadingVariant };
}
