import { prisma } from "@/lib/prisma";
import type { DraftChannel } from "@/generated/prisma/client";
import { FORECAST_CONFIG } from "./config";

/**
 * Phase 29 — pre-deal likelihood predictions: reply likelihood, meeting
 * likelihood, opportunity likelihood. These are the 3 of Phase 29's 6
 * required business predictions genuinely missing from the existing Phase
 * 12 Predictive Revenue Engine (which starts at Deal-level — DEAL_PROBABILITY,
 * DEAL_RISK, PIPELINE_RISK, TIME_TO_CLOSE, all real and VERIFIED, not
 * rebuilt here). Retention risk (src/lib/clients/churn.ts) is also already
 * real and untouched.
 *
 * Deliberately NOT persisted to PredictionSnapshot. These are cohort-level
 * rate predictions (by channel / by industry), not single-entity
 * predictions naturally keyed to one Deal.id — PredictionSnapshot's real
 * (org, entityType, entityId, predictionType, forecastPeriod) supersede key
 * (src/lib/forecast/snapshot.ts) doesn't fit a channel/industry cohort
 * without an awkward reuse of one of those fields. Instead this follows the
 * exact same live-computed RateObservation pattern already proven on the
 * career side (src/lib/career/outcome-analytics.ts) — a PREDICTION here is
 * an honest reuse of a real historical OBSERVATION, forward-applied to a
 * comparable future case, computed fresh from real EmailDraft/Reply/
 * OutreachMeeting/LeadOpportunity rows on every read. Reuses
 * FORECAST_CONFIG's real sample threshold, not a new invented number.
 */

export type LikelihoodSampleClassification = "INSUFFICIENT_DATA" | "LOW_SAMPLE" | "OBSERVED" | "STRONG_OBSERVATION";
export type LikelihoodConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface LikelihoodPrediction {
  kind: "PREDICTION";
  label: string;
  numerator: number;
  denominator: number;
  likelihood: number | null;
  sampleSize: number;
  sampleClassification: LikelihoodSampleClassification;
  confidence: LikelihoodConfidence;
  insufficientData: boolean;
  timePeriodStart: Date | null;
  timePeriodEnd: Date | null;
  /** Always framed as a historical rate applied forward — never a claimed certainty. */
  statement: string;
}

const MIN_SAMPLE = FORECAST_CONFIG.MIN_CLOSED_DEALS_FOR_BASELINE; // 10 — reused, not reinvented

function classifySample(n: number): LikelihoodSampleClassification {
  if (n < MIN_SAMPLE) return "INSUFFICIENT_DATA";
  if (n < MIN_SAMPLE * 2) return "LOW_SAMPLE";
  if (n < MIN_SAMPLE * 3) return "OBSERVED";
  return "STRONG_OBSERVATION";
}

function classifyConfidence(classification: LikelihoodSampleClassification): LikelihoodConfidence {
  if (classification === "INSUFFICIENT_DATA" || classification === "LOW_SAMPLE") return "LOW";
  if (classification === "STRONG_OBSERVATION") return "HIGH";
  return "MEDIUM";
}

function periodBounds(dates: Date[]): { start: Date | null; end: Date | null } {
  if (dates.length === 0) return { start: null, end: null };
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  return { start: sorted[0]!, end: sorted[sorted.length - 1]! };
}

function buildLikelihood(label: string, numerator: number, denominator: number, dates: Date[]): LikelihoodPrediction {
  const sampleClassification = classifySample(denominator);
  const confidence = classifyConfidence(sampleClassification);
  const likelihood = denominator > 0 ? numerator / denominator : null;
  const { start, end } = periodBounds(dates);
  const insufficientData = sampleClassification === "INSUFFICIENT_DATA";

  const statement =
    denominator === 0
      ? `No real historical sample for "${label}" — INSUFFICIENT_DATA, no prediction made.`
      : insufficientData
        ? `Only ${denominator} comparable real historical case(s) exist for "${label}" (${MIN_SAMPLE} required) — INSUFFICIENT_DATA, no reliable likelihood can be predicted yet.`
        : `Based on ${denominator} comparable real historical case(s), "${label}" occurred ${numerator} time(s) (${Math.round((likelihood ?? 0) * 100)}%) — applied forward as a likelihood estimate, not a guarantee.`;

  return { kind: "PREDICTION", label, numerator, denominator, likelihood, sampleSize: denominator, sampleClassification, confidence, insufficientData, timePeriodStart: start, timePeriodEnd: end, statement };
}

const SENT_STATUSES = ["SENT", "DELIVERED", "READ"] as const;

/**
 * Reply likelihood for a given channel — real historical rate of a SENT
 * EmailDraft on that channel having a real Reply linked back to it
 * (Reply.emailDraftId, a direct, non-inferred relation).
 */
export async function computeReplyLikelihood(organizationId: string, channel: DraftChannel, asOf: Date = new Date()): Promise<LikelihoodPrediction> {
  const drafts = await prisma.emailDraft.findMany({
    where: { organizationId, channel, status: { in: [...SENT_STATUSES] }, createdAt: { lte: asOf } },
    select: { id: true, createdAt: true, replies: { select: { id: true }, take: 1 } },
  });
  const numerator = drafts.filter((d) => d.replies.length > 0).length;
  return buildLikelihood(`reply on ${channel}`, numerator, drafts.length, drafts.map((d) => d.createdAt));
}

/**
 * Meeting likelihood for a given channel — real historical rate of a SENT
 * EmailDraft on that channel leading to a real OutreachMeeting linked back
 * to it (OutreachMeeting.emailDraftId).
 */
export async function computeMeetingLikelihood(organizationId: string, channel: DraftChannel, asOf: Date = new Date()): Promise<LikelihoodPrediction> {
  const drafts = await prisma.emailDraft.findMany({
    where: { organizationId, channel, status: { in: [...SENT_STATUSES] }, createdAt: { lte: asOf } },
    select: { id: true, createdAt: true, outreachMeetings: { select: { id: true }, take: 1 } },
  });
  const numerator = drafts.filter((d) => d.outreachMeetings.length > 0).length;
  return buildLikelihood(`meeting from ${channel} outreach`, numerator, drafts.length, drafts.map((d) => d.createdAt));
}

/**
 * Opportunity likelihood for a given industry (or org-wide when industry is
 * null) — real historical rate of a company that had at least one real
 * Reply from one of its contacts going on to have a real LeadOpportunity
 * generated. Pre-deal: distinct from DEAL_PROBABILITY, which only applies
 * once a Deal already exists.
 */
export async function computeOpportunityLikelihood(organizationId: string, industry: string | null, asOf: Date = new Date()): Promise<LikelihoodPrediction> {
  const companies = await prisma.company.findMany({
    where: {
      organizationId,
      ...(industry ? { industry } : {}),
      createdAt: { lte: asOf },
      contacts: { some: { replies: { some: { receivedAt: { lte: asOf } } } } },
    },
    select: { id: true, createdAt: true, leadOpportunities: { select: { id: true }, take: 1 } },
  });
  const numerator = companies.filter((c) => c.leadOpportunities.length > 0).length;
  return buildLikelihood(industry ? `opportunity generation for "${industry}" companies with real reply engagement` : "opportunity generation for companies with real reply engagement", numerator, companies.length, companies.map((c) => c.createdAt));
}
