import { prisma } from "@/lib/prisma";
import type { Deal } from "@/generated/prisma/client";
import { FORECAST_CONFIG } from "./config";
import type { CalibratedProbabilityResult, ConfidenceFactors, LearningConfidence } from "./types";
import { TERMINAL_STAGE_NAMES } from "./config";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function confidenceBucket(weightedScore: number, sufficientSample: boolean): LearningConfidence {
  if (!sufficientSample) return "LOW";
  if (weightedScore >= FORECAST_CONFIG.CONFIDENCE_HIGH_CUTOFF) return "HIGH";
  if (weightedScore >= FORECAST_CONFIG.CONFIDENCE_MEDIUM_CUTOFF) return "MEDIUM";
  return "LOW";
}

/**
 * §17 baseline model: org-wide historical win rate among real CLOSED
 * (Won/Lost) deals — the simplest reliable method, computed before any
 * more sophisticated signal is layered on (§16/§17). Never blindly assumes
 * fixed per-stage percentages (§6).
 */
export async function getOrgWinRateBaseline(organizationId: string, asOf: Date): Promise<{ winRate: number | null; sampleSize: number; wonCount: number; lostCount: number; sufficient: boolean }> {
  const deals = await prisma.deal.findMany({
    where: { organizationId, createdAt: { lte: asOf }, dealStage: { name: { in: ["Won", "Lost"] } } },
    select: { dealStage: { select: { name: true } } },
  });
  const wonCount = deals.filter((d) => d.dealStage.name === "Won").length;
  const lostCount = deals.filter((d) => d.dealStage.name === "Lost").length;
  const sampleSize = wonCount + lostCount;
  return {
    winRate: sampleSize > 0 ? wonCount / sampleSize : null,
    sampleSize,
    wonCount,
    lostCount,
    sufficient: sampleSize >= FORECAST_CONFIG.MIN_CLOSED_DEALS_FOR_BASELINE,
  };
}

/**
 * §6 stage-based signal — real historical conversion from deals that were
 * EVER transitioned into the same current stage as this open deal
 * (DealStageHistory, Phase 12's own new log). Returns null (never a
 * fabricated rate) until MIN_STAGE_TRANSITIONS real transitions into that
 * stage exist AND have since reached a real closed outcome.
 */
async function getStageConversionSignal(organizationId: string, currentStageName: string, asOf: Date): Promise<{ conversionRate: number | null; sampleSize: number }> {
  const transitions = await prisma.dealStageHistory.findMany({
    where: { organizationId, toStageName: currentStageName, changedAt: { lte: asOf } },
    select: { dealId: true },
  });
  const dealIds = [...new Set(transitions.map((t) => t.dealId))];
  if (dealIds.length < FORECAST_CONFIG.MIN_STAGE_TRANSITIONS) return { conversionRate: null, sampleSize: dealIds.length };

  const closedDeals = await prisma.deal.findMany({
    where: { id: { in: dealIds }, dealStage: { name: { in: ["Won", "Lost"] } } },
    select: { dealStage: { select: { name: true } } },
  });
  const won = closedDeals.filter((d) => d.dealStage.name === "Won").length;
  if (closedDeals.length < FORECAST_CONFIG.MIN_STAGE_TRANSITIONS) return { conversionRate: null, sampleSize: closedDeals.length };
  return { conversionRate: won / closedDeals.length, sampleSize: closedDeals.length };
}

/**
 * §33 — reads (never duplicates) Phase 11's LearningPattern as an OPTIONAL
 * cohort adjustment. Only ever applied when a real, sufficiently-sampled
 * (OBSERVED+) WINNING_PATTERN/LOSING_PATTERN matches this deal's company
 * cohort, and the nudge is bounded (config.MAX_COHORT_NUDGE) — a single
 * pattern can never swing the baseline wildly.
 */
async function getCohortAdjustment(organizationId: string, deal: Deal & { company: { industry: string | null; headquartersCountry: string | null } | null }): Promise<{ adjustment: number; patternId: string | null }> {
  if (!deal.company) return { adjustment: 0, patternId: null };
  const cohortValues = [deal.company.industry, deal.company.headquartersCountry].filter((v): v is string => !!v);
  if (cohortValues.length === 0) return { adjustment: 0, patternId: null };

  const candidates = await prisma.learningPattern.findMany({
    where: {
      organizationId,
      status: { in: ["EMERGING", "ACTIVE"] },
      sampleClassification: { in: ["OBSERVED", "STRONG_OBSERVATION"] },
      patternType: { in: ["WINNING_PATTERN", "LOSING_PATTERN"] },
      conversionRate: { not: null },
    },
    orderBy: { sampleSize: "desc" },
    take: 20,
  });
  const pattern = candidates.find((p) => {
    const conditions = p.conditions as unknown as Array<{ dimension: string; value: string }>;
    return conditions.every((c) => (c.dimension === "industry" || c.dimension === "country") && cohortValues.includes(c.value));
  });
  if (!pattern || pattern.conversionRate === null) return { adjustment: 0, patternId: null };

  // Nudge, not a replacement — bounded so cohort evidence can inform, never
  // dominate, the baseline (§6's "avoid a rigid rule not supported by data"
  // applies just as much to over-trusting one pattern as it does to
  // under-trusting real conversion data).
  const raw = pattern.conversionRate - 0.5; // signed pull away from neutral
  const bounded = Math.max(-FORECAST_CONFIG.MAX_COHORT_NUDGE, Math.min(FORECAST_CONFIG.MAX_COHORT_NUDGE, raw));
  return { adjustment: bounded, patternId: pattern.id };
}

/**
 * The real, documented Phase 12 deal-probability model (§5/§6/§17):
 * baseline org-wide historical win rate + a bounded, evidence-gated cohort
 * adjustment (Phase 11) + a stage-conversion signal (own new
 * DealStageHistory log, honestly insufficient until it accumulates real
 * transitions). NEVER touches Deal.probability — this is a separate,
 * calibrated number stored on PredictionSnapshot.
 */
export async function computeCalibratedProbability(dealId: string, asOf: Date = new Date()): Promise<CalibratedProbabilityResult> {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: { company: { select: { industry: true, headquartersCountry: true } }, dealStage: true },
  });

  const baseline = await getOrgWinRateBaseline(deal.organizationId, asOf);
  const stageSignal = await getStageConversionSignal(deal.organizationId, deal.dealStage.name, asOf);
  const cohort = await getCohortAdjustment(deal.organizationId, deal);

  const evidenceIds: string[] = [];
  if (cohort.patternId) evidenceIds.push(cohort.patternId);

  if (!baseline.sufficient) {
    return {
      probability: null,
      method: `INSUFFICIENT_HISTORICAL_DATA — only ${baseline.sampleSize} closed (Won+Lost) deal(s) exist org-wide; ${FORECAST_CONFIG.MIN_CLOSED_DEALS_FOR_BASELINE} required for a baseline win rate.`,
      confidence: "LOW",
      confidenceFactors: zeroFactors(),
      evidenceIds,
      dataCutoffTimestamp: asOf,
      insufficientData: true,
    };
  }

  // Stage-conversion signal, when real, is blended 50/50 with the org
  // baseline (both are real historical rates at that point — neither
  // automatically outranks the other); when insufficient, baseline alone
  // is used — never fabricated.
  let probability = baseline.winRate!;
  let method = `Org-wide historical win rate (${baseline.wonCount}/${baseline.sampleSize} closed deals = ${Math.round(baseline.winRate! * 100)}%)`;
  if (stageSignal.conversionRate !== null) {
    probability = (probability + stageSignal.conversionRate) / 2;
    method += ` blended 50/50 with real stage-conversion history for "${deal.dealStage.name}" (${stageSignal.sampleSize} tracked transitions, ${Math.round(stageSignal.conversionRate * 100)}%)`;
  } else {
    method += `; stage-conversion signal for "${deal.dealStage.name}" is INSUFFICIENT_HISTORICAL_DATA (${stageSignal.sampleSize}/${FORECAST_CONFIG.MIN_STAGE_TRANSITIONS} tracked transitions — DealStageHistory only started logging when Phase 12 shipped)`;
  }
  if (cohort.adjustment !== 0) {
    probability += cohort.adjustment;
    method += `; adjusted ${cohort.adjustment >= 0 ? "+" : ""}${Math.round(cohort.adjustment * 100)}pp from a matching Phase 11 cohort pattern`;
  }
  probability = clamp01(probability);

  const dataCompleteness = deal.company ? 1 : 0.5;
  const cohortSimilarity = cohort.patternId ? 1 : 0.5;
  const sampleSizeFactor = Math.min(1, baseline.sampleSize / (FORECAST_CONFIG.MIN_CLOSED_DEALS_FOR_BASELINE * 3));
  const calibrationQuality = await getCalibrationQualityFactor(deal.organizationId);

  const weightedScore = 0.35 * sampleSizeFactor + 0.2 * dataCompleteness + 0.2 * cohortSimilarity + 0.25 * calibrationQuality;
  const confidenceFactors: ConfidenceFactors = { sampleSize: sampleSizeFactor, dataCompleteness, cohortSimilarity, calibrationQuality, forecastHorizonPenalty: 0, weightedScore };

  return {
    probability,
    method,
    confidence: confidenceBucket(weightedScore, baseline.sufficient),
    confidenceFactors,
    evidenceIds,
    dataCutoffTimestamp: asOf,
    insufficientData: false,
  };
}

function zeroFactors(): ConfidenceFactors {
  return { sampleSize: 0, dataCompleteness: 0, cohortSimilarity: 0, calibrationQuality: 0, forecastHorizonPenalty: 0, weightedScore: 0 };
}

async function getCalibrationQualityFactor(organizationId: string): Promise<number> {
  const latest = await prisma.forecastCalibration.findFirst({ where: { organizationId, subject: "DEAL_PROBABILITY" }, orderBy: { computedAt: "desc" } });
  if (!latest) return 0.5; // neutral — no calibration history yet, neither penalized nor rewarded
  if (latest.verdict === "WELL_CALIBRATED") return 1;
  if (latest.verdict === "INSUFFICIENT_DATA") return 0.5;
  return 0.3; // OVERCONFIDENT or UNDERCONFIDENT — real evidence the model needs review
}

export { TERMINAL_STAGE_NAMES };
