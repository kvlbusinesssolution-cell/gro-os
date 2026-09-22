import { prisma } from "@/lib/prisma";
import { getSalesForecast } from "@/app/dashboard/crm/_lib/forecast";
import { computeCalibratedProbability } from "./deal-probability";
import { TERMINAL_STAGE_NAMES } from "./config";

export interface WeightedDealLine {
  dealId: string;
  dealName: string;
  value: number | null;
  calibratedProbability: number | null;
  expectedValue: number | null;
  manualProbability: number | null;
}

export interface PredictedPipeline {
  /** §8 — real, unweighted open pipeline. Reuses getSalesForecast's own definition verbatim, never redefined. */
  openPipelineValue: number;
  openDealsCount: number;
  /** §9 — weighted by the NEW calibrated probability (never the manual Deal.probability). */
  weightedPipelineValue: number;
  dealsWithCalibratedProbability: number;
  dealsInsufficientData: number;
  lines: WeightedDealLine[];
}

/**
 * §8/§9 — calls getSalesForecast (src/app/dashboard/crm/_lib/forecast.ts)
 * for the real open-pipeline value/count rather than re-summing Deal rows,
 * then computes the calibrated weighted pipeline per open deal.
 */
export async function computePredictedPipeline(organizationId: string, asOf: Date = new Date()): Promise<PredictedPipeline> {
  const [salesForecast, openDeals] = await Promise.all([
    getSalesForecast(organizationId),
    prisma.deal.findMany({
      where: { organizationId, dealStage: { name: { notIn: [...TERMINAL_STAGE_NAMES] } } },
      select: { id: true, name: true, value: true, probability: true },
    }),
  ]);

  const lines: WeightedDealLine[] = [];
  let weightedPipelineValue = 0;
  let dealsWithCalibratedProbability = 0;
  let dealsInsufficientData = 0;

  for (const deal of openDeals) {
    const result = await computeCalibratedProbability(deal.id, asOf);
    const expectedValue = result.probability !== null && deal.value !== null ? deal.value * result.probability : null;
    if (result.insufficientData) dealsInsufficientData += 1;
    else dealsWithCalibratedProbability += 1;
    if (expectedValue !== null) weightedPipelineValue += expectedValue;
    lines.push({ dealId: deal.id, dealName: deal.name, value: deal.value, calibratedProbability: result.probability, expectedValue, manualProbability: deal.probability });
  }

  return {
    openPipelineValue: salesForecast.openPipelineValue,
    openDealsCount: salesForecast.openDealsCount,
    weightedPipelineValue,
    dealsWithCalibratedProbability,
    dealsInsufficientData,
    lines,
  };
}
