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

export interface DriftResult {
  hasEnoughHistory: boolean;
  previousVerdict: CalibrationResult["verdict"] | null;
  currentVerdict: CalibrationResult["verdict"] | null;
  previousAvgGap: number | null;
  currentAvgGap: number | null;
  /** Real difference between the two most recent runs' avg gap — null until 2 real runs exist. */
  gapDelta: number | null;
  driftDetected: boolean;
  summary: string;
}

function avgGapFromBands(bands: CalibrationBand[]): number | null {
  const withData = bands.filter((b) => b.sampleSize > 0 && b.actualWinRate !== null && b.avgPredictedProbability !== null);
  if (withData.length === 0) return null;
  const totalSample = withData.reduce((s, b) => s + b.sampleSize, 0);
  return withData.reduce((sum, b) => sum + (b.avgPredictedProbability! - b.actualWinRate!) * b.sampleSize, 0) / totalSample;
}

/**
 * Phase 29 — drift check. Reuses ForecastCalibration's real, already-
 * existing append-only history (runForecastCalibrationForOrg's own "never
 * upserted" convention, unchanged) rather than building new data
 * collection: compares the two most recent real calibration runs' avg gap.
 * A shift of more than 15 points (double FORECAST_CONFIG's own
 * WELL_CALIBRATED tolerance) between consecutive real runs is flagged as
 * real drift — never inferred from a single run.
 */
export async function computeForecastCalibrationDrift(organizationId: string): Promise<DriftResult> {
  const runs = await prisma.forecastCalibration.findMany({
    where: { organizationId, subject: "DEAL_PROBABILITY" },
    orderBy: { computedAt: "desc" },
    take: 2,
  });

  if (runs.length < 2) {
    return {
      hasEnoughHistory: false,
      previousVerdict: null,
      currentVerdict: (runs[0]?.verdict as CalibrationResult["verdict"]) ?? null,
      previousAvgGap: null,
      currentAvgGap: null,
      gapDelta: null,
      driftDetected: false,
      summary: `Only ${runs.length} real calibration run(s) exist — at least 2 are required to compare drift over time. INSUFFICIENT_DATA.`,
    };
  }

  const [current, previous] = runs;
  const currentAvgGap = avgGapFromBands(current!.bandsJson as unknown as CalibrationBand[]);
  const previousAvgGap = avgGapFromBands(previous!.bandsJson as unknown as CalibrationBand[]);
  const gapDelta = currentAvgGap !== null && previousAvgGap !== null ? currentAvgGap - previousAvgGap : null;
  const driftDetected = gapDelta !== null && Math.abs(gapDelta) > 0.15;

  return {
    hasEnoughHistory: true,
    previousVerdict: previous!.verdict as CalibrationResult["verdict"],
    currentVerdict: current!.verdict as CalibrationResult["verdict"],
    previousAvgGap,
    currentAvgGap,
    gapDelta,
    driftDetected,
    summary:
      gapDelta === null
        ? "Real calibration history exists for 2 runs, but at least one has no populated band to compute a gap from — INSUFFICIENT_DATA for a drift verdict."
        : driftDetected
          ? `Calibration gap shifted by ${gapDelta >= 0 ? "+" : ""}${Math.round(gapDelta * 100)} points between the last 2 real runs (${previous!.verdict} → ${current!.verdict}) — real drift detected, model may need review.`
          : `Calibration gap shifted by only ${gapDelta >= 0 ? "+" : ""}${Math.round(gapDelta * 100)} points between the last 2 real runs — no meaningful drift.`,
  };
}
