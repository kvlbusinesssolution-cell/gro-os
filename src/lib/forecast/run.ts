import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { computeCalibratedProbability } from "./deal-probability";
import { computeDealRisk } from "./deal-risk";
import { predictTimeToClose } from "./time-to-close";
import { computePredictedPipeline } from "./pipeline";
import { computePipelineRisk } from "./pipeline-risk";
import { computeMonthlyForecast, computeQuarterlyForecast } from "./revenue-forecast";
import { runForecastCalibrationForOrg } from "./calibration";
import { evaluateMaturedDealPredictions } from "./accuracy";
import { writePredictionSnapshot } from "./snapshot";
import { TERMINAL_STAGE_NAMES } from "./config";

export interface ForecastRunSummary {
  organizationId: string;
  openDealsProcessed: number;
  orgSnapshotsWritten: number;
  maturedPredictionsEvaluated: number;
  calibrationPersisted: boolean;
  durationMs: number;
  error?: string;
}

/**
 * §49 — the one real, idempotent forecast-engine entry point. Registered
 * as a scheduled job and callable on-demand ("Run now") from the existing
 * Jobs control panel, same as Phase 11's runLearningEngine. Every write
 * goes through writePredictionSnapshot (supersede-not-overwrite, §27) and
 * every step is audit-logged (§59). Never touches Deal.value/probability/
 * status or any other actual CRM/financial record (§61).
 */
export async function runForecastEngine(organizationId: string): Promise<ForecastRunSummary> {
  const startedAt = Date.now();
  await logAudit({ organizationId, action: "forecast.run.started" });

  try {
    const asOf = new Date();
    let orgSnapshotsWritten = 0;

    // 1. Evaluate matured predictions FIRST — against the state as it
    // stood before this run's fresh predictions are written, so an
    // evaluation never accidentally reads this run's own new snapshot.
    const maturedPredictionsEvaluated = await evaluateMaturedDealPredictions(organizationId);

    // 2. Per-open-deal predictions.
    const openDeals = await prisma.deal.findMany({ where: { organizationId, dealStage: { name: { notIn: [...TERMINAL_STAGE_NAMES] } } }, select: { id: true, value: true } });
    for (const deal of openDeals) {
      const [probability, risk, timeToClose] = await Promise.all([computeCalibratedProbability(deal.id, asOf), computeDealRisk(deal.id, asOf), predictTimeToClose(deal.id, asOf)]);

      await writePredictionSnapshot({
        organizationId,
        predictionType: "DEAL_PROBABILITY",
        entityType: "DEAL",
        entityId: deal.id,
        predictionProbability: probability.probability,
        confidence: probability.confidence,
        confidenceFactors: probability.confidenceFactors,
        dataCutoffTimestamp: probability.dataCutoffTimestamp,
        modelMethod: probability.method,
        evidenceIds: probability.evidenceIds,
      });

      if (deal.value !== null && probability.probability !== null) {
        await writePredictionSnapshot({
          organizationId,
          predictionType: "EXPECTED_DEAL_VALUE",
          entityType: "DEAL",
          entityId: deal.id,
          predictionValue: deal.value * probability.probability,
          predictionProbability: probability.probability,
          confidence: probability.confidence,
          confidenceFactors: probability.confidenceFactors,
          dataCutoffTimestamp: probability.dataCutoffTimestamp,
          modelMethod: `Deal value (₹${deal.value.toLocaleString("en-IN")}) × calibrated probability. ${probability.method}`,
          currency: "INR",
        });
      }

      await writePredictionSnapshot({
        organizationId,
        predictionType: "DEAL_RISK",
        entityType: "DEAL",
        entityId: deal.id,
        confidence: risk.reasons.length > 0 ? "HIGH" : "MEDIUM",
        confidenceFactors: {},
        dataCutoffTimestamp: asOf,
        modelMethod: "Rule-based risk assessment (src/lib/forecast/deal-risk.ts) — every reason has real, cited evidence.",
        explanation: JSON.stringify({ riskLevel: risk.riskLevel, reasons: risk.reasons }),
      });

      if (!timeToClose.insufficientData) {
        await writePredictionSnapshot({
          organizationId,
          predictionType: "TIME_TO_CLOSE",
          entityType: "DEAL",
          entityId: deal.id,
          predictionValue: timeToClose.predictedDays,
          confidence: "MEDIUM",
          confidenceFactors: {},
          dataCutoffTimestamp: asOf,
          modelMethod: timeToClose.method,
        });
      }
      orgSnapshotsWritten += 3;
    }

    // 3. Org-level pipeline/weighted-pipeline snapshots.
    const pipeline = await computePredictedPipeline(organizationId, asOf);
    await writePredictionSnapshot({
      organizationId,
      predictionType: "PIPELINE_VALUE",
      entityType: "ORGANIZATION",
      entityId: organizationId,
      predictionValue: pipeline.openPipelineValue,
      confidence: "HIGH", // this is a real, unweighted SUM of actual open-deal values — not a prediction, always high confidence in its own arithmetic
      confidenceFactors: {},
      dataCutoffTimestamp: asOf,
      modelMethod: "Σ value of every real open (non-terminal-stage) Deal — an ACTUAL figure, not a prediction (§8).",
      currency: "INR",
      evidenceIds: pipeline.lines.map((l) => l.dealId),
    });
    await writePredictionSnapshot({
      organizationId,
      predictionType: "WEIGHTED_PIPELINE",
      entityType: "ORGANIZATION",
      entityId: organizationId,
      predictionValue: pipeline.weightedPipelineValue,
      confidence: pipeline.dealsInsufficientData > pipeline.dealsWithCalibratedProbability ? "LOW" : "MEDIUM",
      confidenceFactors: {},
      dataCutoffTimestamp: asOf,
      modelMethod: `Σ (each open deal's value × its calibrated probability). ${pipeline.dealsWithCalibratedProbability}/${pipeline.dealsWithCalibratedProbability + pipeline.dealsInsufficientData} deals have a calibrated probability; the rest have insufficient historical data and contribute 0.`,
      currency: "INR",
      evidenceIds: pipeline.lines.map((l) => l.dealId),
    });
    orgSnapshotsWritten += 2;

    // 4. Pipeline risk.
    const pipelineRisk = await computePipelineRisk(organizationId, asOf);
    await writePredictionSnapshot({
      organizationId,
      predictionType: "PIPELINE_RISK",
      entityType: "ORGANIZATION",
      entityId: organizationId,
      confidence: "MEDIUM",
      confidenceFactors: {},
      dataCutoffTimestamp: asOf,
      modelMethod: "Concentration + stalled-ratio + stage-balance analysis (src/lib/forecast/pipeline-risk.ts).",
      explanation: JSON.stringify({ riskLevel: pipelineRisk.riskLevel, reasons: pipelineRisk.reasons, concentration: pipelineRisk.concentration }),
      evidenceIds: pipelineRisk.topDealIds,
    });
    orgSnapshotsWritten += 1;

    // 5. Monthly (current + next) and quarterly (current + next) forecasts.
    for (const offset of [0, 1]) {
      const monthly = await computeMonthlyForecast(organizationId, offset, asOf);
      await writePredictionSnapshot({
        organizationId,
        predictionType: "MONTHLY_REVENUE_FORECAST",
        entityType: "ORGANIZATION",
        entityId: organizationId,
        predictionValue: monthly.forecastTotal,
        confidence: monthly.confidence,
        confidenceFactors: monthly.confidenceFactors,
        forecastPeriod: monthly.periodLabel,
        dataCutoffTimestamp: asOf,
        modelMethod: monthly.method,
        currency: "INR",
        lowerBound: monthly.lowerBound,
        upperBound: monthly.upperBound,
        evidenceIds: monthly.dealsIncluded,
      });
      orgSnapshotsWritten += 1;
    }
    for (const offset of [0, 1]) {
      const quarterly = await computeQuarterlyForecast(organizationId, offset, asOf);
      await writePredictionSnapshot({
        organizationId,
        predictionType: "QUARTERLY_REVENUE_FORECAST",
        entityType: "ORGANIZATION",
        entityId: organizationId,
        predictionValue: quarterly.forecastTotal,
        confidence: quarterly.confidence,
        confidenceFactors: quarterly.confidenceFactors,
        forecastPeriod: quarterly.periodLabel,
        dataCutoffTimestamp: asOf,
        modelMethod: quarterly.method,
        currency: "INR",
        lowerBound: quarterly.lowerBound,
        upperBound: quarterly.upperBound,
        evidenceIds: quarterly.dealsIncluded,
      });
      orgSnapshotsWritten += 1;
    }

    // 6. Calibration.
    const calibration = await runForecastCalibrationForOrg(organizationId);

    const durationMs = Date.now() - startedAt;
    await logAudit({ organizationId, action: "forecast.run.completed", metadata: { openDealsProcessed: openDeals.length, orgSnapshotsWritten, maturedPredictionsEvaluated, calibrationPersisted: calibration.persisted, durationMs } });

    return { organizationId, openDealsProcessed: openDeals.length, orgSnapshotsWritten, maturedPredictionsEvaluated, calibrationPersisted: calibration.persisted, durationMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logAudit({ organizationId, action: "forecast.run.failed", metadata: { error: message } });
    return { organizationId, openDealsProcessed: 0, orgSnapshotsWritten: 0, maturedPredictionsEvaluated: 0, calibrationPersisted: false, durationMs: Date.now() - startedAt, error: message };
  }
}
