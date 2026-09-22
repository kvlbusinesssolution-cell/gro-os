import { prisma } from "@/lib/prisma";
import type { PredictionType } from "@/generated/prisma/client";
import { evaluatePredictionAgainstActual } from "./snapshot";

export interface AccuracyResult {
  sampleSize: number;
  mae: number | null;
  /** WAPE = Σ|error| ÷ Σ|actual| — used instead of MAPE, which blows up near zero actuals (§29). */
  wape: number | null;
  bias: number | null;
  withinRangeRate: number | null;
}

/**
 * §29 — real accuracy metrics from EVALUATED PredictionSnapshot rows only.
 * Deliberately does NOT compute MAPE (mean absolute PERCENTAGE error) —
 * this org's real revenue figures can be exactly 0 for a period, which
 * makes MAPE either undefined or absurdly large; WAPE (a ratio of sums,
 * not an average of ratios) stays well-defined at 0.
 */
export async function computeForecastAccuracy(organizationId: string, predictionType?: PredictionType): Promise<AccuracyResult> {
  const evaluated = await prisma.predictionSnapshot.findMany({
    where: { organizationId, status: "EVALUATED", ...(predictionType ? { predictionType } : {}), actualValue: { not: null }, predictionValue: { not: null } },
    select: { predictionValue: true, actualValue: true, accuracy: true },
  });

  if (evaluated.length === 0) return { sampleSize: 0, mae: null, wape: null, bias: null, withinRangeRate: null };

  const errors = evaluated.map((e) => Math.abs(e.predictionValue! - e.actualValue!));
  const signedErrors = evaluated.map((e) => e.predictionValue! - e.actualValue!);
  const actualSum = evaluated.reduce((sum, e) => sum + Math.abs(e.actualValue!), 0);
  const errorSum = errors.reduce((sum, e) => sum + e, 0);

  const withinRangeFlags = evaluated.map((e) => (e.accuracy as { withinRange?: number | null } | null)?.withinRange).filter((v): v is number => v !== null && v !== undefined);

  return {
    sampleSize: evaluated.length,
    mae: errorSum / evaluated.length,
    wape: actualSum > 0 ? errorSum / actualSum : null,
    bias: signedErrors.reduce((sum, e) => sum + e, 0) / evaluated.length,
    withinRangeRate: withinRangeFlags.length > 0 ? withinRangeFlags.reduce((s, v) => s + v, 0) / withinRangeFlags.length : null,
  };
}

/**
 * §28 — finds ACTIVE DEAL_PROBABILITY/EXPECTED_DEAL_VALUE snapshots whose
 * Deal has since reached a real terminal outcome and evaluates them against
 * that outcome. Never alters the original prediction fields (§28's "do not
 * alter the original prediction") — evaluatePredictionAgainstActual only
 * ever appends actualValue/actualOutcome/accuracy and flips status.
 */
export async function evaluateMaturedDealPredictions(organizationId: string): Promise<number> {
  const activeSnapshots = await prisma.predictionSnapshot.findMany({
    where: { organizationId, entityType: "DEAL", predictionType: { in: ["DEAL_PROBABILITY", "EXPECTED_DEAL_VALUE"] }, status: "ACTIVE" },
  });
  if (activeSnapshots.length === 0) return 0;

  const dealIds = [...new Set(activeSnapshots.map((s) => s.entityId))];
  const deals = await prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, value: true, dealStage: { select: { name: true } } } });
  const dealById = new Map(deals.map((d) => [d.id, d]));

  let evaluatedCount = 0;
  for (const snapshot of activeSnapshots) {
    const deal = dealById.get(snapshot.entityId);
    if (!deal || (deal.dealStage.name !== "Won" && deal.dealStage.name !== "Lost")) continue;
    const actualOutcome = deal.dealStage.name;
    const actualValue = snapshot.predictionType === "EXPECTED_DEAL_VALUE" ? (actualOutcome === "Won" ? deal.value : 0) : actualOutcome === "Won" ? 1 : 0;
    await evaluatePredictionAgainstActual(snapshot.id, actualValue, actualOutcome);
    evaluatedCount += 1;
  }
  return evaluatedCount;
}
