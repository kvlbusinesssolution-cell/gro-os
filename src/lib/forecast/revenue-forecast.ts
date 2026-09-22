import { prisma } from "@/lib/prisma";
import { getMRR } from "@/lib/revenue/subscriptions";
import { computeCalibratedProbability } from "./deal-probability";
import { TERMINAL_STAGE_NAMES, FORECAST_CONFIG } from "./config";
import type { ConfidenceFactors, LearningConfidence } from "./types";

export interface PeriodForecast {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  /** §12 — real revenue already recognized this period (paid invoices). Never mixed with the forecast total without labeling. */
  actualRevenue: number;
  /** Open-pipeline deals with a real expectedCloseDate inside this period. */
  expectedClosuresCount: number;
  /** Σ (deal value × calibrated probability) for those deals. */
  expectedFutureRevenue: number;
  recurringContribution: number;
  /** actualRevenue + expectedFutureRevenue + recurringContribution. */
  forecastTotal: number;
  lowerBound: number | null;
  upperBound: number | null;
  rangeAvailable: boolean;
  confidence: LearningConfidence;
  confidenceFactors: ConfidenceFactors;
  method: string;
  dealsIncluded: string[];
  dataSufficient: boolean;
}

function monthRange(offsetMonths: number): { start: Date; end: Date; label: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths + 1, 1));
  const label = start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

function quarterRange(offsetQuarters: number): { start: Date; end: Date; label: string } {
  const now = new Date();
  const currentQuarter = Math.floor(now.getUTCMonth() / 3);
  const targetQuarterIndex = currentQuarter + offsetQuarters;
  const year = now.getUTCFullYear() + Math.floor(targetQuarterIndex / 4);
  const quarter = ((targetQuarterIndex % 4) + 4) % 4;
  const start = new Date(Date.UTC(year, quarter * 3, 1));
  const end = new Date(Date.UTC(year, quarter * 3 + 3, 1));
  return { start, end, label: `Q${quarter + 1} ${year}` };
}

/**
 * §11/§12/§25/§26 — one real period (calendar month or quarter), never
 * blending historical actual revenue with future expected revenue without
 * labeling each separately. `recurringContribution` reuses getMRR
 * (src/lib/revenue/subscriptions.ts), same as revenue/forecast.ts — no
 * second MRR calculation.
 */
async function computePeriodForecast(organizationId: string, start: Date, end: Date, label: string, asOf: Date): Promise<PeriodForecast> {
  const [paidInvoices, openDealsInPeriod, mrr] = await Promise.all([
    prisma.invoice.findMany({ where: { organizationId, amountPaid: { gt: 0 }, paidAt: { gte: start, lt: end } }, select: { amountPaid: true } }),
    prisma.deal.findMany({
      where: { organizationId, expectedCloseDate: { gte: start, lt: end }, dealStage: { name: { notIn: [...TERMINAL_STAGE_NAMES] } } },
      select: { id: true, value: true },
    }),
    getMRR(organizationId),
  ]);

  const actualRevenue = paidInvoices.reduce((sum, i) => sum + i.amountPaid, 0);

  let expectedFutureRevenue = 0;
  const dealsIncluded: string[] = [];
  const probabilities: number[] = [];
  let insufficientCount = 0;
  for (const deal of openDealsInPeriod) {
    const result = await computeCalibratedProbability(deal.id, asOf);
    if (result.insufficientData || result.probability === null) {
      insufficientCount += 1;
      continue;
    }
    dealsIncluded.push(deal.id);
    probabilities.push(result.probability);
    if (deal.value !== null) expectedFutureRevenue += deal.value * result.probability;
  }

  const monthsInPeriod = (end.getTime() - start.getTime()) / (30 * 86_400_000);
  const recurringContribution = mrr * monthsInPeriod;
  const forecastTotal = actualRevenue + expectedFutureRevenue + recurringContribution;

  const dataSufficient = openDealsInPeriod.length > 0 || mrr > 0 || actualRevenue > 0;

  // §13 — range only when there's a real spread to compute it from
  // (multiple real probabilities); a single deal or zero deals has no
  // meaningful variance to report.
  let lowerBound: number | null = null;
  let upperBound: number | null = null;
  let rangeAvailable = false;
  if (probabilities.length >= 3) {
    const spread = Math.max(...probabilities) - Math.min(...probabilities);
    lowerBound = actualRevenue + expectedFutureRevenue * (1 - spread / 2) + recurringContribution;
    upperBound = actualRevenue + expectedFutureRevenue * (1 + spread / 2) + recurringContribution;
    rangeAvailable = true;
  }

  const sampleSizeFactor = Math.min(1, openDealsInPeriod.length / 5);
  const dataCompleteness = openDealsInPeriod.length > 0 ? dealsIncluded.length / openDealsInPeriod.length : 0.5;
  const weightedScore = 0.4 * sampleSizeFactor + 0.3 * dataCompleteness + 0.3 * (mrr > 0 ? 1 : 0.5);
  const confidenceFactors: ConfidenceFactors = { sampleSize: sampleSizeFactor, dataCompleteness, cohortSimilarity: 0.5, calibrationQuality: 0.5, forecastHorizonPenalty: 0, weightedScore };
  const confidence: LearningConfidence = !dataSufficient ? "LOW" : weightedScore >= FORECAST_CONFIG.CONFIDENCE_HIGH_CUTOFF ? "HIGH" : weightedScore >= FORECAST_CONFIG.CONFIDENCE_MEDIUM_CUTOFF ? "MEDIUM" : "LOW";

  return {
    periodLabel: label,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    actualRevenue,
    expectedClosuresCount: openDealsInPeriod.length,
    expectedFutureRevenue,
    recurringContribution,
    forecastTotal,
    lowerBound,
    upperBound,
    rangeAvailable,
    confidence,
    confidenceFactors,
    method: `Actual = real paid invoices in ${label}. Expected future revenue = Σ (open deal value × calibrated probability) for the ${openDealsInPeriod.length} open deal(s) with a real expectedCloseDate in this period (${insufficientCount} excluded for insufficient historical data). Recurring = current MRR × ${monthsInPeriod.toFixed(2)} month(s), same flat no-churn-discount convention as src/lib/revenue/forecast.ts.`,
    dealsIncluded,
    dataSufficient,
  };
}

export async function computeMonthlyForecast(organizationId: string, monthOffset = 0, asOf: Date = new Date()): Promise<PeriodForecast> {
  const { start, end, label } = monthRange(monthOffset);
  return computePeriodForecast(organizationId, start, end, label, asOf);
}

export async function computeQuarterlyForecast(organizationId: string, quarterOffset = 0, asOf: Date = new Date()): Promise<PeriodForecast> {
  const { start, end, label } = quarterRange(quarterOffset);
  return computePeriodForecast(organizationId, start, end, label, asOf);
}
