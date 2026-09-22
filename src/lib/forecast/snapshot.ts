import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { MODEL_VERSION, FEATURE_VERSION, LEARNING_VERSION } from "./config";
import type { PredictionWriteInput } from "./types";

/**
 * §27/§50 — never overwrite a previous prediction/forecast. Marks every
 * ACTIVE PredictionSnapshot for the same (org, entityType, entityId,
 * predictionType, forecastPeriod) as SUPERSEDED, then inserts a brand-new
 * ACTIVE row. Querying this same key ordered by predictionDate reproduces
 * the full forecast-evolution history (§27's "Sep 1 / Sep 8 / Sep 15
 * forecast" example) for free — no separate snapshot-history table needed.
 */
export async function writePredictionSnapshot(input: PredictionWriteInput) {
  await prisma.predictionSnapshot.updateMany({
    where: {
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      predictionType: input.predictionType,
      forecastPeriod: input.forecastPeriod ?? null,
      status: "ACTIVE",
    },
    data: { status: "SUPERSEDED" },
  });

  return prisma.predictionSnapshot.create({
    data: {
      organizationId: input.organizationId,
      predictionType: input.predictionType,
      entityType: input.entityType,
      entityId: input.entityId,
      predictionValue: input.predictionValue ?? null,
      predictionProbability: input.predictionProbability ?? null,
      confidence: input.confidence,
      confidenceFactors: input.confidenceFactors as unknown as Prisma.InputJsonValue,
      forecastPeriod: input.forecastPeriod ?? null,
      dataCutoffTimestamp: input.dataCutoffTimestamp,
      modelMethod: input.modelMethod,
      modelVersion: MODEL_VERSION,
      featureVersion: FEATURE_VERSION,
      learningVersion: LEARNING_VERSION,
      currency: input.currency ?? null,
      lowerBound: input.lowerBound ?? null,
      upperBound: input.upperBound ?? null,
      explanation: input.explanation ?? null,
      evidenceIds: input.evidenceIds ?? [],
      runId: input.runId ?? null,
    },
  });
}

/** The latest ACTIVE snapshot for one entity+type(+period) — what the dashboard/API reads. */
export function getActiveSnapshot(organizationId: string, entityType: "DEAL" | "ORGANIZATION", entityId: string, predictionType: Prisma.PredictionSnapshotWhereInput["predictionType"], forecastPeriod?: string | null) {
  return prisma.predictionSnapshot.findFirst({
    where: { organizationId, entityType, entityId, predictionType, forecastPeriod: forecastPeriod ?? null, status: "ACTIVE" },
    orderBy: { predictionDate: "desc" },
  });
}

/** Full snapshot history for one entity+type(+period), newest first — how a forecast evolved over time (§27). */
export function getSnapshotHistory(organizationId: string, entityType: "DEAL" | "ORGANIZATION", entityId: string, predictionType: Prisma.PredictionSnapshotWhereInput["predictionType"], forecastPeriod?: string | null) {
  return prisma.predictionSnapshot.findMany({
    where: { organizationId, entityType, entityId, predictionType, forecastPeriod: forecastPeriod ?? null },
    orderBy: { predictionDate: "desc" },
  });
}

/**
 * §28/§29 — records the real outcome against a snapshot WITHOUT altering
 * the original prediction fields. Computes absolute/percentage error (WAPE-
 * safe: percentageError is null, not Infinity/NaN, when actualValue is 0).
 */
export async function evaluatePredictionAgainstActual(snapshotId: string, actualValue: number | null, actualOutcome: string | null) {
  const snapshot = await prisma.predictionSnapshot.findUnique({ where: { id: snapshotId } });
  if (!snapshot) return null;

  let accuracy: Record<string, number | null> | null = null;
  if (actualValue !== null && snapshot.predictionValue !== null) {
    const absoluteError = Math.abs(snapshot.predictionValue - actualValue);
    const percentageError = actualValue !== 0 ? (absoluteError / Math.abs(actualValue)) * 100 : null;
    const withinRange = snapshot.lowerBound !== null && snapshot.upperBound !== null ? (actualValue >= snapshot.lowerBound && actualValue <= snapshot.upperBound ? 1 : 0) : null;
    accuracy = { absoluteError, percentageError, withinRange };
  }

  return prisma.predictionSnapshot.update({
    where: { id: snapshotId },
    data: {
      status: "EVALUATED",
      actualValue,
      actualOutcome,
      accuracy: accuracy as unknown as Prisma.InputJsonValue,
    },
  });
}
