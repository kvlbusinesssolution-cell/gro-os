import { prisma } from "@/lib/prisma";
import type { LearningOutcome, DraftChannel, Prisma } from "@/generated/prisma/client";
import { DATASET_VERSION, ANALYSIS_VERSION } from "./config";
import type { StageTimestamps, ObjectionSnapshot } from "./types";

/** Same convention as acquisition-funnel.ts's own QUALIFIED_BANDS. */
const QUALIFIED_BANDS = new Set(["HOT", "WARM"]);

/** Contacted with no reply after this many days is NO_RESPONSE, not indefinitely CONTACTED. */
const NO_RESPONSE_DAYS = 30;

/**
 * Postgres unique constraints treat every NULL as distinct from every other
 * NULL, so `@@unique([organizationId, companyId, leadOpportunityId])` alone
 * cannot make upserts idempotent for a company with no LeadOpportunity (each
 * run would insert a new row instead of updating the same one). This empty
 * string is the real, concrete "no specific opportunity — a company-level
 * observation" value instead of null, so the unique constraint (and
 * upsert's ON CONFLICT) actually enforces one row per company in that case.
 */
const NO_OPPORTUNITY_SENTINEL = "";

const MESSAGE_ANGLE_KEYWORDS: Array<{ bucket: string; keywords: string[] }> = [
  { bucket: "cost_reduction", keywords: ["cost", "save", "reduce", "cheaper", "budget"] },
  { bucket: "automation", keywords: ["automat", "efficien", "streamlin"] },
  { bucket: "ai_transformation", keywords: ["ai ", " ai", "artificial intelligence", "machine learning", "intelligent"] },
  { bucket: "revenue_growth", keywords: ["revenue", "growth", "sales increase", "conversion"] },
  { bucket: "website_conversion", keywords: ["website", "landing page", "conversion rate", "ux"] },
  { bucket: "digital_transformation", keywords: ["digital transformation", "modernize", "legacy"] },
  { bucket: "custom_development", keywords: ["custom", "bespoke", "tailored", "build you"] },
  { bucket: "performance", keywords: ["performance", "speed", "scalab", "slow"] },
  { bucket: "migration", keywords: ["migrat", "replatform"] },
];

/** Best-effort keyword bucket of free-text salesAngle — NOT a controlled vocabulary; returns null rather than guessing when nothing matches. */
function bucketMessageAngle(salesAngle: string | null | undefined): string | null {
  if (!salesAngle) return null;
  const lower = salesAngle.toLowerCase();
  for (const { bucket, keywords } of MESSAGE_ANGLE_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return bucket;
  }
  return null;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

const companyInclude = {
  leadScore: true,
  intentScoreHistory: true,
  decisionMakers: true,
  leadOpportunities: true,
  conversationIntelligence: true,
  revenueAttributions: true,
  proposals: true,
  contacts: { include: { emailDrafts: true, replies: true, outreachMeetings: true } },
  deals: { include: { dealStage: true, invoices: true, proposals: true } },
} satisfies Prisma.CompanyInclude;

type CompanyWithRelations = Prisma.CompanyGetPayload<{ include: typeof companyInclude }>;

interface DerivedCompanyFacts {
  outcome: LearningOutcome;
  stageTimestamps: StageTimestamps;
  channel: DraftChannel | null;
  contactedAt: Date | null;
  repliedAt: Date | null;
  revenue: number | null;
  dealId: string | null;
  proposalId: string | null;
  meetingId: string | null;
  replyId: string | null;
  campaignId: string | null;
  revenueAttributionId: string | null;
  decisionMakerRole: string | null;
  decisionMakerId: string | null;
  objections: ObjectionSnapshot[];
  modelVersion: string | null;
  promptVersion: string | null;
  aiProvider: string | null;
}

/** Derives company-level real facts shared by every observation row for this company (the company-level row + every per-opportunity row). */
function deriveCompanyFacts(company: CompanyWithRelations): DerivedCompanyFacts {
  const stageTimestamps: StageTimestamps = { foundAt: company.createdAt.toISOString() };

  if (company.leadScore && QUALIFIED_BANDS.has(company.leadScore.band)) {
    stageTimestamps.qualifiedAt = company.leadScore.scoredAt.toISOString();
  }

  // Earliest real outbound send across every contact of this company.
  const sentDrafts = company.contacts.flatMap((c) => c.emailDrafts.filter((d) => d.sentAt !== null));
  sentDrafts.sort((a, b) => a.sentAt!.getTime() - b.sentAt!.getTime());
  const firstSent = sentDrafts[0] ?? null;
  const contactedAt = firstSent?.sentAt ?? null;
  const channel = firstSent?.channel ?? null;
  const campaignId = firstSent?.campaignId ?? null;
  if (contactedAt) stageTimestamps.contactedAt = contactedAt.toISOString();

  const replies = company.contacts.flatMap((c) => c.replies);
  replies.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const firstReply = replies[0] ?? null;
  const repliedAt = firstReply?.receivedAt ?? null;
  if (repliedAt) stageTimestamps.repliedAt = repliedAt.toISOString();

  const meetings = company.contacts.flatMap((c) => c.outreachMeetings);
  meetings.sort((a, b) => (a.scheduledAt?.getTime() ?? 0) - (b.scheduledAt?.getTime() ?? 0));
  const firstMeeting = meetings.find((m) => m.status === "CONFIRMED" || m.status === "COMPLETED") ?? meetings[0] ?? null;
  if (firstMeeting?.scheduledAt) stageTimestamps.meetingAt = firstMeeting.scheduledAt.toISOString();

  const proposals = [...company.proposals.filter((p) => p.dealId === null), ...company.deals.flatMap((d) => d.proposals)];
  proposals.sort((a, b) => (a.sentAt?.getTime() ?? a.createdAt.getTime()) - (b.sentAt?.getTime() ?? b.createdAt.getTime()));
  const firstProposal = proposals[0] ?? null;
  if (firstProposal) stageTimestamps.proposalAt = (firstProposal.sentAt ?? firstProposal.createdAt).toISOString();

  // At most one Deal is unambiguous (DIRECT_FK-equivalent); >1 deal for a
  // company is a real but ambiguous many-to-one association — dealId is
  // only set when there's exactly one deal, or the one Won/Lost deal is
  // clear, to avoid implying a false direct link (mirrors
  // RevenueAttribution's own DIRECT_FK vs COMPANY_ASSOCIATION distinction).
  const wonDeal = company.deals.find((d) => d.dealStage.name === "Won") ?? null;
  const lostDeal = company.deals.find((d) => d.lostReason !== null || d.dealStage.name === "Lost") ?? null;

  let revenue: number | null = null;
  let revenueAttributionId: string | null = null;
  if (company.revenueAttributions.length > 0) {
    revenue = company.revenueAttributions.reduce((sum, ra) => sum + ra.revenueAmount, 0);
    revenueAttributionId = company.revenueAttributions[0]!.id;
    const latest = [...company.revenueAttributions].sort((a, b) => b.computedAt.getTime() - a.computedAt.getTime())[0]!;
    stageTimestamps.revenueAt = latest.computedAt.toISOString();
  }

  if (wonDeal) stageTimestamps.wonAt = wonDeal.updatedAt.toISOString();
  if (lostDeal) stageTimestamps.lostAt = lostDeal.updatedAt.toISOString();

  let outcome: LearningOutcome = "FOUND";
  if (wonDeal) outcome = "WON";
  else if (lostDeal) outcome = "LOST";
  else if (firstProposal) outcome = "PROPOSAL";
  else if (firstMeeting) outcome = "MEETING";
  else if (repliedAt) outcome = "REPLIED";
  else if (contactedAt) {
    outcome = daysBetween(contactedAt, new Date()) > NO_RESPONSE_DAYS ? "NO_RESPONSE" : "CONTACTED";
  } else if (company.leadOpportunities.length > 0 && company.leadOpportunities.every((o) => o.status === "DISMISSED")) {
    outcome = "DISQUALIFIED";
  } else if ((company.leadScore && QUALIFIED_BANDS.has(company.leadScore.band)) || company.leadOpportunities.length > 0) {
    outcome = "QUALIFIED";
  }

  const primaryDecisionMaker = [...company.decisionMakers].sort((a, b) => b.confidence - a.confidence)[0] ?? null;

  // Objections: copied verbatim from every ConversationIntelligence row for
  // this company, never merged/collapsed — each entry keeps its own
  // CONFIRMED|INFERRED|UNKNOWN classification (§18). Also captures the most
  // recent row's provider/model/promptVersion as this observation's own.
  const objections: ObjectionSnapshot[] = [];
  let modelVersion: string | null = null;
  let promptVersion: string | null = null;
  let aiProvider: string | null = null;
  if (company.conversationIntelligence.length > 0) {
    const sorted = [...company.conversationIntelligence].sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
    for (const ci of sorted) {
      const rows = (ci.objections as unknown as ObjectionSnapshot[]) ?? [];
      objections.push(...rows);
    }
    const latest = sorted[0]!;
    modelVersion = latest.model ?? null;
    promptVersion = latest.promptVersion ?? null;
    aiProvider = latest.provider ?? null;
  }
  // Deal.lostReason is the one real, human-recorded loss reason — kept
  // distinct from the AI-inferred objections above, never merged into one list.
  if (lostDeal?.lostReason) {
    objections.push({ value: lostDeal.lostReason, classification: "CONFIRMED", description: "Deal.lostReason (human-recorded)" });
  }

  return {
    outcome,
    stageTimestamps,
    channel,
    contactedAt,
    repliedAt,
    revenue,
    dealId: company.deals.length === 1 ? company.deals[0]!.id : (wonDeal?.id ?? lostDeal?.id ?? null),
    proposalId: firstProposal?.id ?? null,
    meetingId: firstMeeting?.id ?? null,
    replyId: firstReply?.id ?? null,
    campaignId,
    revenueAttributionId,
    decisionMakerRole: primaryDecisionMaker?.role ?? null,
    decisionMakerId: primaryDecisionMaker?.id ?? null,
    objections,
    modelVersion,
    promptVersion,
    aiProvider,
  };
}

/**
 * Derives the intent score/band AS OF `asOf` from IntentScoreHistory —
 * never from the current/latest IntentScore row. This is the data-leakage
 * guard §36 requires: features must reflect only what was knowable at that
 * point in time, never a score computed after the outcome was already known.
 * Returns null when no history row exists yet at/before `asOf`.
 */
function intentAsOf<T extends { calculatedAt: Date; newScore: number; newBand: string }>(history: T[], asOf: Date | null): T | null {
  if (!asOf) return null;
  const eligible = history.filter((h) => h.calculatedAt.getTime() <= asOf.getTime());
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => b.calculatedAt.getTime() - a.calculatedAt.getTime())[0]!;
}

function computeSalesCycleDays(facts: DerivedCompanyFacts): number | null {
  const start = facts.contactedAt;
  const endIso = facts.stageTimestamps.wonAt ?? facts.stageTimestamps.lostAt ?? null;
  if (!start || !endIso) return null;
  return daysBetween(start, new Date(endIso));
}

export interface BuildObservationsResult {
  companiesProcessed: number;
  observationsUpserted: number;
}

/**
 * Idempotent, materializes LearningObservation rows from real source
 * records (§3). Never invents a stage — a company with no LeadOpportunity
 * gets exactly one company-level row (leadOpportunityId = the sentinel
 * above); a company with N real LeadOpportunity rows gets N per-opportunity
 * rows, each still carrying the company's own shared facts (outcome,
 * timestamps, objections, revenue).
 */
export async function buildObservationsForOrganization(organizationId: string, opts?: { since?: Date }): Promise<BuildObservationsResult> {
  const companies: CompanyWithRelations[] = await prisma.company.findMany({
    where: { organizationId, ...(opts?.since ? { updatedAt: { gte: opts.since } } : {}) },
    include: companyInclude,
  });

  let observationsUpserted = 0;

  for (const company of companies) {
    const facts = deriveCompanyFacts(company);
    const now = new Date();
    const predictionTimestamp = facts.contactedAt ?? company.createdAt;
    const actualOutcomeTimestamp = facts.stageTimestamps.wonAt || facts.stageTimestamps.lostAt ? now : null;
    const intentAtPrediction = intentAsOf(company.intentScoreHistory, predictionTimestamp);

    const baseFields = {
      organizationId,
      companyId: company.id,
      decisionMakerId: facts.decisionMakerId,
      dealId: facts.dealId,
      proposalId: facts.proposalId,
      meetingId: facts.meetingId,
      replyId: facts.replyId,
      campaignId: facts.campaignId,
      revenueAttributionId: facts.revenueAttributionId,
      channel: facts.channel,
      country: company.headquartersCountry,
      industry: company.industry,
      companySize: company.employeeCount,
      technologies: company.technologies,
      intentScore: intentAtPrediction?.newScore ?? null,
      intentBand: intentAtPrediction?.newBand ?? null,
      decisionMakerRole: facts.decisionMakerRole,
      objections: facts.objections as unknown as Prisma.InputJsonValue,
      leadSource: company.source,
      outcome: facts.outcome,
      revenue: facts.revenue,
      stageTimestamps: facts.stageTimestamps as unknown as Prisma.InputJsonValue,
      modelVersion: facts.modelVersion,
      promptVersion: facts.promptVersion,
      aiProvider: facts.aiProvider,
      predictionTimestamp,
      actualOutcomeTimestamp,
      datasetVersion: DATASET_VERSION,
      analysisVersion: ANALYSIS_VERSION,
      salesCycleDays: computeSalesCycleDays(facts),
    };

    if (company.leadOpportunities.length === 0) {
      await prisma.learningObservation.upsert({
        where: { organizationId_companyId_leadOpportunityId: { organizationId, companyId: company.id, leadOpportunityId: NO_OPPORTUNITY_SENTINEL } },
        create: { ...baseFields, leadOpportunityId: NO_OPPORTUNITY_SENTINEL, dealSize: null, messageAngle: null, service: null },
        update: { ...baseFields, dealSize: null, messageAngle: null, service: null },
      });
      observationsUpserted += 1;
      continue;
    }

    for (const opp of company.leadOpportunities) {
      const service = opp.recommendedService ?? company.deals[0]?.services?.[0] ?? null;
      const linkedDeal = company.deals.find((d) => d.id === facts.dealId) ?? null;
      const dealSize = linkedDeal?.value ?? opp.estimatedValue ?? null;
      await prisma.learningObservation.upsert({
        where: { organizationId_companyId_leadOpportunityId: { organizationId, companyId: company.id, leadOpportunityId: opp.id } },
        create: { ...baseFields, leadOpportunityId: opp.id, dealSize, messageAngle: bucketMessageAngle(opp.salesAngle), service },
        update: { ...baseFields, dealSize, messageAngle: bucketMessageAngle(opp.salesAngle), service },
      });
      observationsUpserted += 1;
    }
  }

  return { companiesProcessed: companies.length, observationsUpserted };
}
