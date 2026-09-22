import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getRevenueForecast, getCashFlowProjection } from "@/lib/revenue/forecast";
import { computePredictedPipeline } from "@/lib/forecast/pipeline";
import { computeMonthlyForecast } from "@/lib/forecast/revenue-forecast";
import { computeAcquisitionOverview } from "@/lib/analytics/acquisition-funnel";
import { generateStructured } from "@/lib/ai/fallback";
import { recordAIUsage } from "@/lib/billing/ai-credits";
import { isAIConnected } from "@/lib/ai/client";
import { getPersona } from "@/lib/ai/personas";
import type { ExecutiveBriefing, Prisma } from "@/generated/prisma/client";

/**
 * AI CEO Daily Brief — assembles real, deterministic data first (every
 * field below except narrativeSummary is a plain Prisma aggregate), then
 * makes exactly ONE AI call to write a CEO-voice paragraph that reformats
 * and prioritizes that already-real data. The model is never asked to
 * invent a number — it only narrates what's given to it, same discipline
 * as generateExecutiveInsights.
 */

const NarrativeSchema = z.object({ narrativeSummary: z.string().trim().min(1) });

const NEW_LEADS_WINDOW_DAYS = 1;

// Non-terminal Deal stages, exactly the convention already established by
// evaluateDealStalled (src/lib/alerts/rules.ts) and reused verbatim at
// src/app/dashboard/crm/_lib/team-actions.ts and
// src/app/api/export/crm-report/[type]/route.ts.
const OPEN_DEAL_STAGE_NAMES_EXCLUDED = ["Won", "Lost", "Archived"];

// "At risk" here means "no real activity recorded in N days", a genuinely
// different definition from evaluateDealStalled's "past its expected close
// date" (which is about a missed target, not silence on the account) — see
// that function's doc comment in src/lib/alerts/rules.ts. Reusing the same
// 14-day value as DEAL_STALLED_DAYS/RECENCY_WINDOW_DAYS/AGE_THRESHOLD_DAYS
// (the codebase's established "stale pipeline" threshold) rather than
// inventing a new number, but scoped by Deal.updatedAt, not expectedCloseDate.
const AT_RISK_DEAL_INACTIVITY_DAYS = 14;

/**
 * Phase 10 (Autonomous Growth Operating System): real, deterministic
 * Phase 1-9 grounding data — every field is a plain Prisma count/aggregate
 * or a direct reuse of computeAcquisitionOverview(), never AI-estimated.
 * An empty table for this org simply produces an honest 0 / empty array /
 * null here — see buildGrowthSignalsSummaryLines() for how each is turned
 * into an honest "no data yet" sentence for the AI narrative prompt rather
 * than a bare, easy-to-misread 0.
 */
export interface GrowthSignals {
  /** Real LeadOpportunity rows created since yesterday, org-scoped via Company. */
  newOpportunitiesCount: number;
  /** Real LeadOpportunity rows currently at priority HOT, org-scoped via Company (live snapshot, not time-windowed — same convention as pendingApprovalsCount). */
  hotOpportunitiesCount: number;
  /** Real Reply rows received since yesterday, grouped by ReplyIntent. `intent: null` covers replies logged before/without AI intent classification. */
  repliesByIntent: Array<{ intent: string | null; count: number }>;
  /** Real open (non-Won/Lost/Archived) Deals with no real Deal.updatedAt activity in AT_RISK_DEAL_INACTIVITY_DAYS days. */
  atRiskDealsCount: number;
  /** Real Proposals currently in SENT status (sent, no client response yet). */
  pendingProposalsCount: number;
  /** Age in days of the oldest pending (SENT) Proposal, by sentAt (falling back to createdAt if sentAt is somehow unset). Null when pendingProposalsCount is 0 — never a fabricated age. */
  oldestPendingProposalAgeDays: number | null;
  /** Real ReferralPartner rows still at status CANDIDATE (discovered, not yet recruited). */
  referralPartnerCandidatesCount: number;
  /** Direct reuse of computeAcquisitionOverview(organizationId) (Phase 9) — all-time snapshot, never recomputed here. */
  acquisitionFunnel: Array<{ stage: string; count: number }>;
  acquisitionTotalRevenue: number;
}

export async function computeGrowthSignals(organizationId: string): Promise<GrowthSignals> {
  const yesterday = new Date(Date.now() - NEW_LEADS_WINDOW_DAYS * 86_400_000);
  const atRiskCutoff = new Date(Date.now() - AT_RISK_DEAL_INACTIVITY_DAYS * 86_400_000);

  const [
    newOpportunitiesCount,
    hotOpportunitiesCount,
    repliesByIntentGroups,
    atRiskDealsCount,
    pendingProposals,
    referralPartnerCandidatesCount,
    acquisitionOverview,
  ] = await Promise.all([
    prisma.leadOpportunity.count({ where: { company: { organizationId }, createdAt: { gte: yesterday } } }),
    prisma.leadOpportunity.count({ where: { company: { organizationId }, priority: "HOT" } }),
    // `_count: { _all: true }`, not `{ intent: true }` — Prisma's per-field
    // _count only counts non-null values of that field, which would
    // silently report 0 for the null-intent ("not yet AI-classified") group
    // even though real rows are sitting in it. `_all` counts every real row
    // in each group regardless of the grouped field's own nullability.
    prisma.reply.groupBy({
      by: ["intent"],
      where: { organizationId, receivedAt: { gte: yesterday } },
      _count: { _all: true },
    }),
    prisma.deal.count({
      where: {
        organizationId,
        dealStage: { name: { notIn: OPEN_DEAL_STAGE_NAMES_EXCLUDED } },
        updatedAt: { lt: atRiskCutoff },
      },
    }),
    prisma.proposal.findMany({
      where: { organizationId, status: "SENT" },
      select: { sentAt: true, createdAt: true },
    }),
    prisma.referralPartner.count({ where: { organizationId, status: "CANDIDATE" } }),
    computeAcquisitionOverview(organizationId),
  ]);

  const repliesByIntent = repliesByIntentGroups.map((g) => ({ intent: g.intent, count: g._count._all }));

  const now = Date.now();
  const oldestPendingProposalAgeDays =
    pendingProposals.length > 0
      ? Math.max(...pendingProposals.map((p) => Math.floor((now - (p.sentAt ?? p.createdAt).getTime()) / 86_400_000)))
      : null;

  return {
    newOpportunitiesCount,
    hotOpportunitiesCount,
    repliesByIntent,
    atRiskDealsCount,
    pendingProposalsCount: pendingProposals.length,
    oldestPendingProposalAgeDays,
    referralPartnerCandidatesCount,
    acquisitionFunnel: acquisitionOverview.funnel,
    acquisitionTotalRevenue: acquisitionOverview.totalRevenue,
  };
}

/**
 * Renders GrowthSignals into plain-English lines for the AI narrative
 * prompt — every line is either a real number or an honest "no ... yet"
 * sentence (same discipline the pre-existing risks/recommendedActions
 * lines below already follow), never a bare ambiguous 0 and never a
 * fabricated figure when a Phase 1-9 table is empty for this org.
 */
function buildGrowthSignalsSummaryLines(signals: GrowthSignals): string[] {
  const lines: string[] = [];

  lines.push(
    signals.newOpportunitiesCount > 0
      ? `Real new opportunities detected (last ${NEW_LEADS_WINDOW_DAYS} day): ${signals.newOpportunitiesCount}.`
      : "No new opportunities detected since yesterday.",
  );
  lines.push(
    signals.hotOpportunitiesCount > 0
      ? `Real HOT-priority opportunities awaiting action right now: ${signals.hotOpportunitiesCount}.`
      : "No HOT-priority opportunities on record right now.",
  );

  if (signals.repliesByIntent.length > 0) {
    const intentLines = signals.repliesByIntent
      .map((r) => `${r.intent ?? "UNCLASSIFIED"}: ${r.count}`)
      .join(", ");
    lines.push(`Real replies received (last ${NEW_LEADS_WINDOW_DAYS} day) by intent: ${intentLines}.`);
  } else {
    lines.push("No replies received since yesterday.");
  }

  lines.push(
    signals.atRiskDealsCount > 0
      ? `Real open deals with no activity in over ${AT_RISK_DEAL_INACTIVITY_DAYS} days (at risk): ${signals.atRiskDealsCount}.`
      : `No open deals have gone quiet for more than ${AT_RISK_DEAL_INACTIVITY_DAYS} days.`,
  );

  lines.push(
    signals.pendingProposalsCount > 0
      ? `Real pending proposals (sent, awaiting response): ${signals.pendingProposalsCount}, oldest ${signals.oldestPendingProposalAgeDays} day(s) old.`
      : "No proposals are currently pending a response.",
  );

  lines.push(
    signals.referralPartnerCandidatesCount > 0
      ? `Real referral partner candidates awaiting review: ${signals.referralPartnerCandidatesCount}.`
      : "No referral partner candidates on record.",
  );

  const nonZeroFunnelStages = signals.acquisitionFunnel.filter((s) => s.count > 0);
  if (nonZeroFunnelStages.length > 0) {
    const funnelLine = signals.acquisitionFunnel.map((s) => `${s.stage}: ${s.count}`).join(", ");
    lines.push(
      `Real all-time client acquisition funnel: ${funnelLine} (total won revenue ${signals.acquisitionTotalRevenue.toFixed(2)}).`,
    );
  } else {
    lines.push("No client acquisition funnel data yet (no companies/leads recorded).");
  }

  return lines;
}

export async function generateDailyBrief(organizationId: string): Promise<ExecutiveBriefing> {
  const yesterday = new Date(Date.now() - NEW_LEADS_WINDOW_DAYS * 86_400_000);

  const [
    newLeadsCount,
    topOpportunityDeals,
    topClientOpportunities,
    topOpportunityInsights,
    pendingApprovalsCount,
    revenueForecastDay,
    cashFlow,
    predictedPipeline,
    monthlyForecast,
    topAlerts,
    recommendedInsights,
    growthSignals,
  ] = await Promise.all([
    prisma.lead.count({ where: { pipelineStage: { workspace: { organizationId } }, createdAt: { gte: yesterday } } }),
    prisma.deal.findMany({
      where: { organizationId, dealStage: { name: { notIn: ["Won", "Lost", "Archived"] } }, value: { not: null } },
      orderBy: { value: "desc" },
      take: 3,
      select: { name: true, value: true, probability: true },
    }),
    prisma.clientOpportunity.findMany({
      where: { organizationId, status: "SUGGESTED" },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { client: { select: { name: true } } },
    }),
    prisma.insight.findMany({ where: { organizationId, type: "TOP_OPPORTUNITY" }, orderBy: { createdAt: "desc" }, take: 1 }),
    prisma.approval.count({ where: { organizationId, decision: "PENDING" } }),
    getRevenueForecast(organizationId, "day"),
    getCashFlowProjection(organizationId, 4),
    computePredictedPipeline(organizationId),
    computeMonthlyForecast(organizationId, 0),
    prisma.alert.findMany({ where: { organizationId, status: "ACTIVE" }, orderBy: [{ severity: "desc" }, { triggeredAt: "desc" }], take: 5 }),
    prisma.insight.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 5 }),
    computeGrowthSignals(organizationId),
  ]);

  const opportunities = [
    ...topOpportunityDeals.map((d) => ({ kind: "deal" as const, title: d.name, value: (d.value ?? 0) * ((d.probability ?? 0) / 100) })),
    ...topClientOpportunities.map((o) => ({ kind: o.kind.toLowerCase() as string, title: `${o.title} (${o.client.name})`, value: o.estimatedValue })),
    ...topOpportunityInsights.map((i) => ({ kind: "insight" as const, title: i.title, value: null })),
  ];

  const cashFlowNext4Weeks = cashFlow.reduce((sum, b) => sum + b.expectedInflow, 0);
  const risks = topAlerts.map((a) => `[${a.severity}] ${a.title}`);
  const recommendedActions = recommendedInsights.map((i) => i.title);

  let narrativeSummary: string | null = null;
  if (isAIConnected()) {
    try {
      const persona = getPersona("CEO");
      const dataSummary = [
        `Real new leads (last ${NEW_LEADS_WINDOW_DAYS} day): ${newLeadsCount}.`,
        `Real revenue forecast (today): ${revenueForecastDay.total.toFixed(2)}, confidence ${revenueForecastDay.confidenceScore}/100.`,
        `Real expected cash inflow (next 4 weeks): ${cashFlowNext4Weeks.toFixed(2)}.`,
        `Phase 12 predictive revenue engine — current forecast for ${monthlyForecast.periodLabel} is ${monthlyForecast.forecastTotal.toFixed(2)} with ${monthlyForecast.confidence} model confidence (actual so far: ${monthlyForecast.actualRevenue.toFixed(2)}, expected future: ${monthlyForecast.expectedFutureRevenue.toFixed(2)}). Predicted weighted pipeline: ${predictedPipeline.weightedPipelineValue.toFixed(2)} of ${predictedPipeline.openPipelineValue.toFixed(2)} real open pipeline. IMPORTANT: write about this forecast using hedged language ("current forecast is X with Y% confidence") — NEVER state it as a guaranteed future fact ("revenue will be X").`,
        `Real pending approvals: ${pendingApprovalsCount}.`,
        opportunities.length > 0 ? `Real top opportunities:\n${opportunities.map((o) => `- ${o.title}${o.value != null ? ` (${o.value.toFixed(2)})` : ""}`).join("\n")}` : "No real opportunities on record.",
        risks.length > 0 ? `Real active risks:\n${risks.join("\n")}` : "No active risk alerts.",
        recommendedActions.length > 0 ? `Real recent recommendations:\n${recommendedActions.join("\n")}` : "No recent recommendations.",
        ...buildGrowthSignalsSummaryLines(growthSignals),
      ].join("\n\n");

      const result = await generateStructured({
        system: `${persona.systemPrompt}\n\nYou are writing the AI CEO Daily Brief — a short executive-voice paragraph. Ground every sentence strictly in the real data given below — never invent a number, deal, or event not present in it. If a section has no real data, say so honestly. Any revenue forecast is a PREDICTION, not a fact — always phrase it as "current forecast is X with Y% confidence," never "revenue will be X."`,
        userContent: `Today's real business state:\n\n${dataSummary}\n\nWrite one short CEO-voice paragraph summarizing today's priorities.`,
        maxTokens: 1024,
        effort: "low",
        schema: NarrativeSchema,
      });
      await recordAIUsage(organizationId, result.provider, result.model, result.inputTokens, result.outputTokens, "ai:daily-brief-narrative");
      narrativeSummary = result.parsed.narrativeSummary;
    } catch {
      // Narrative is an enrichment only — the deterministic brief below still saves without it.
    }
  }

  return prisma.executiveBriefing.create({
    data: {
      organizationId,
      type: "DAILY",
      newLeadsCount,
      opportunities: opportunities as unknown as Prisma.InputJsonValue,
      pendingApprovalsCount,
      revenueForecast: { day: revenueForecastDay, cashFlowNext4Weeks, predictedWeightedPipeline: predictedPipeline.weightedPipelineValue, monthlyForecast } as unknown as Prisma.InputJsonValue,
      risks,
      recommendedActions,
      growthSignals: growthSignals as unknown as Prisma.InputJsonValue,
      narrativeSummary,
    },
  });
}
