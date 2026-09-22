import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { FORECAST_CONFIG } from "./config";

/**
 * §30 — Deal Probability Calibration. Same bucketed-band, hard-minimum-
 * sample, "honest or nothing" pattern as src/lib/ai/prediction-calibration.ts
 * (Phase 3), applied to Phase 12's own calibrated Deal probability instead
 * of BoardReview.winProbability. Compares EVALUATED PredictionSnapshot
 * (DEAL_PROBABILITY) rows against their real recorded outcome.
 */
const BANDS = [
  { label: "0-20%", min: 0, max: 0.2 },
  { label: "20-40%", min: 0.2, max: 0.4 },
  { label: "40-60%", min: 0.4, max: 0.6 },
  { label: "60-80%", min: 0.6, max: 0.8 },
  { label: "80-100%", min: 0.8, max: 1 },
] as const;

export interface CalibrationBand {
  label: string;
  min: number;
  max: number;
  sampleSize: number;
  wonCount: number;
  actualWinRate: number | null;
  avgPredictedProbability: number | null;
}

export interface CalibrationResult {
  sampleSize: number;
  bands: CalibrationBand[];
  verdict: "OVERCONFIDENT" | "UNDERCONFIDENT" | "WELL_CALIBRATED" | "INSUFFICIENT_DATA";
  summary: string;
}

function buildSummary(sampleSize: number, bands: CalibrationBand[], verdict: CalibrationResult["verdict"]): string {
  if (verdict === "INSUFFICIENT_DATA") {
    return `${sampleSize} evaluated deal-probability prediction(s) reviewed — fewer than ${FORECAST_CONFIG.MIN_CALIBRATION_SAMPLE} required for a reliable calibration verdict.`;
  }
  const withData = bands.filter((b) => b.sampleSize > 0);
  const gaps = withData.filter((b) => b.actualWinRate !== null && b.avgPredictedProbability !== null).map((b) => b.avgPredictedProbability! - b.actualWinRate!);
  const avgGap = gaps.length > 0 ? gaps.reduce((a, c) => a + c, 0) / gaps.length : 0;
  return `Based on ${sampleSize} real evaluated deal-probability prediction(s), the model has been ${verdict.replace("_", " ").toLowerCase()} (avg gap: ${avgGap >= 0 ? "+" : ""}${Math.round(avgGap * 100)} points vs actual outcomes).`;
}

/** Pure computation — no persistence. Returns null below the minimum sample (same convention as computePredictionCalibration). */
export async function computeDealProbabilityCalibration(organizationId: string): Promise<CalibrationResult | null> {
  const evaluated = await prisma.predictionSnapshot.findMany({
    where: { organizationId, predictionType: "DEAL_PROBABILITY", status: "EVALUATED", predictionProbability: { not: null } },
    select: { predictionProbability: true, actualOutcome: true },
  });
  if (evaluated.length === 0) return null;

  const terminal = evaluated.filter((e) => e.actualOutcome === "WON" || e.actualOutcome === "LOST").map((e) => ({ probability: e.predictionProbability!, won: e.actualOutcome === "WON" }));
  if (terminal.length < FORECAST_CONFIG.MIN_CALIBRATION_SAMPLE) {
    return { sampleSize: terminal.length, bands: [], verdict: "INSUFFICIENT_DATA", summary: buildSummary(terminal.length, [], "INSUFFICIENT_DATA") };
  }

  const bands: CalibrationBand[] = BANDS.map((b) => {
    const inBand = terminal.filter((t) => t.probability >= b.min && (b.max === 1 ? t.probability <= b.max : t.probability < b.max));
    const wonCount = inBand.filter((t) => t.won).length;
    return {
      label: b.label,
      min: b.min,
      max: b.max,
      sampleSize: inBand.length,
      wonCount,
      actualWinRate: inBand.length > 0 ? wonCount / inBand.length : null,
      avgPredictedProbability: inBand.length > 0 ? inBand.reduce((s, t) => s + t.probability, 0) / inBand.length : null,
    };
  });

  const withData = bands.filter((b) => b.sampleSize >= 3 && b.actualWinRate !== null && b.avgPredictedProbability !== null);
  // Same "any real, sufficiently-sampled band(s)" convention as Phase 3's
  // computePredictionCalibration (src/lib/ai/prediction-calibration.ts) —
  // a verdict from one well-populated band (e.g. every real prediction
  // happens to land in 60-80%) is just as legitimate as one from several;
  // requiring 2+ populated bands was an unnecessary, undocumented
  // deviation from that precedent (caught by accuracy.test.ts).
  let verdict: CalibrationResult["verdict"] = "INSUFFICIENT_DATA";
  if (withData.length >= 1) {
    // Weighted by each band's own sample size so one small band can't sway
    // the verdict as much as a large one.
    const totalSample = withData.reduce((sum, b) => sum + b.sampleSize, 0);
    const avgGap = withData.reduce((sum, b) => sum + (b.avgPredictedProbability! - b.actualWinRate!) * b.sampleSize, 0) / totalSample;
    verdict = Math.abs(avgGap) < 0.1 ? "WELL_CALIBRATED" : avgGap > 0 ? "OVERCONFIDENT" : "UNDERCONFIDENT";
  }

  return { sampleSize: terminal.length, bands, verdict, summary: buildSummary(terminal.length, bands, verdict) };
}

/** Nightly per-org entry point — appends a new row (real history, one row per computation run, never upserted). */
export async function runForecastCalibrationForOrg(organizationId: string): Promise<{ persisted: boolean; sampleSize?: number }> {
  const result = await computeDealProbabilityCalibration(organizationId);
  if (!result) return { persisted: false };

  await prisma.forecastCalibration.create({
    data: { organizationId, subject: "DEAL_PROBABILITY", sampleSize: result.sampleSize, bandsJson: result.bands as unknown as Prisma.InputJsonValue, verdict: result.verdict, summary: result.summary },
  });
  return { persisted: true, sampleSize: result.sampleSize };
}

export function getLatestForecastCalibration(organizationId: string) {
  return prisma.forecastCalibration.findFirst({ where: { organizationId, subject: "DEAL_PROBABILITY" }, orderBy: { computedAt: "desc" } });
}
