import { prisma } from "@/lib/prisma";
import { getActiveSnapshot } from "./snapshot";
import { computePredictedPipeline } from "./pipeline";
import { computePipelineRisk } from "./pipeline-risk";
import { computeMonthlyForecast, computeQuarterlyForecast } from "./revenue-forecast";
import { computeForecastAccuracy } from "./accuracy";
import { getLatestForecastCalibration } from "./calibration";
import { TERMINAL_STAGE_NAMES } from "./config";

/** §36/§39 dashboard + Revenue Command Center overview — every number traceable back to a real PredictionSnapshot or live computation. */
export async function getForecastOverview(organizationId: string) {
  const [pipelineSnapshot, weightedSnapshot, pipelineRiskSnapshot, monthly, quarterly, calibration, highRiskDealsCount, stalledCount] = await Promise.all([
    getActiveSnapshot(organizationId, "ORGANIZATION", organizationId, "PIPELINE_VALUE"),
    getActiveSnapshot(organizationId, "ORGANIZATION", organizationId, "WEIGHTED_PIPELINE"),
    getActiveSnapshot(organizationId, "ORGANIZATION", organizationId, "PIPELINE_RISK"),
    computeMonthlyForecast(organizationId, 0),
    computeQuarterlyForecast(organizationId, 0),
    getLatestForecastCalibration(organizationId),
    prisma.predictionSnapshot.count({ where: { organizationId, entityType: "DEAL", predictionType: "DEAL_RISK", status: "ACTIVE", explanation: { contains: '"riskLevel":"CRITICAL"' } } }),
    prisma.deal.count({ where: { organizationId, dealStage: { name: { notIn: [...TERMINAL_STAGE_NAMES] } }, expectedCloseDate: { lt: new Date(Date.now() - 14 * 86_400_000) } } }),
  ]);

  return { pipelineSnapshot, weightedSnapshot, pipelineRiskSnapshot, monthly, quarterly, calibration, highRiskDealsCount, stalledCount };
}

/** §40 forecast drill-down — every open deal with its calibrated probability/expected value/risk. */
export async function listPipelineDeals(organizationId: string) {
  const pipeline = await computePredictedPipeline(organizationId);
  const dealIds = pipeline.lines.map((l) => l.dealId);
  const [companies, riskSnapshots] = await Promise.all([
    prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, company: { select: { id: true, name: true } }, dealStage: { select: { name: true } }, expectedCloseDate: true } }),
    prisma.predictionSnapshot.findMany({ where: { organizationId, entityType: "DEAL", entityId: { in: dealIds }, predictionType: "DEAL_RISK", status: "ACTIVE" } }),
  ]);
  const companyByDealId = new Map(companies.map((d) => [d.id, d]));
  const riskByDealId = new Map(riskSnapshots.map((s) => [s.entityId, s]));

  return pipeline.lines.map((line) => ({
    ...line,
    company: companyByDealId.get(line.dealId)?.company ?? null,
    stageName: companyByDealId.get(line.dealId)?.dealStage.name ?? null,
    expectedCloseDate: companyByDealId.get(line.dealId)?.expectedCloseDate ?? null,
    risk: riskByDealId.get(line.dealId)?.explanation ? JSON.parse(riskByDealId.get(line.dealId)!.explanation!) : null,
  }));
}

export async function getForecastPipelineRisk(organizationId: string) {
  return computePipelineRisk(organizationId);
}

export async function getForecastAccuracyOverview(organizationId: string) {
  const [dealValueAccuracy, dealProbabilityAccuracy, monthlyForecastAccuracy] = await Promise.all([
    computeForecastAccuracy(organizationId, "EXPECTED_DEAL_VALUE"),
    computeForecastAccuracy(organizationId, "DEAL_PROBABILITY"),
    computeForecastAccuracy(organizationId, "MONTHLY_REVENUE_FORECAST"),
  ]);
  return { dealValueAccuracy, dealProbabilityAccuracy, monthlyForecastAccuracy };
}

export function listForecastSnapshots(organizationId: string, entityType: "DEAL" | "ORGANIZATION", entityId: string) {
  return prisma.predictionSnapshot.findMany({ where: { organizationId, entityType, entityId }, orderBy: { predictionDate: "desc" }, take: 50 });
}

export function getPredictionSnapshotById(organizationId: string, id: string) {
  return prisma.predictionSnapshot.findFirst({ where: { id, organizationId } });
}
