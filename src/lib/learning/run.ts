import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { DATASET_VERSION, ANALYSIS_VERSION } from "./config";
import { buildObservationsForOrganization } from "./observations";
import { discoverPatterns } from "./patterns";
import { computeIntentValidation } from "./intent-validation";
import { computePriorityValidation } from "./priority-validation";
import { generateRecommendationsFromPatterns, generateRecommendationsFromValidation } from "./recommendations";
import { computeShadowScoresForOrganization } from "./shadow";
import { deriveHealthStatus } from "./health";

export interface LearningRunSummary {
  organizationId: string;
  companiesProcessed: number;
  observationsUpserted: number;
  patternsCreated: number;
  patternsUpdated: number;
  patternsRetired: number;
  recommendationsCreated: number;
  shadowScoresComputed: number;
  durationMs: number;
  error?: string;
}

/**
 * §49/§50 — the one real, incremental, idempotent learning-engine entry
 * point. Registered as a scheduled job (src/lib/scheduler/registry.ts) and
 * callable on-demand ("Run now") from the same Jobs control panel every
 * other job already uses. Every step is audit-logged (§58); nothing here
 * ever writes to a production scoring/pricing/compliance rule — only to the
 * Learning* tables.
 */
export async function runLearningEngine(organizationId: string): Promise<LearningRunSummary> {
  const startedAt = Date.now();
  await logAudit({ organizationId, action: "learning.run.started" });

  try {
    const state = await prisma.learningEngineState.findUnique({ where: { organizationId } });
    const since = state?.lastProcessedAt ?? undefined;

    const { companiesProcessed, observationsUpserted } = await buildObservationsForOrganization(organizationId, since ? { since } : undefined);

    const runRecord = await prisma.scheduledJobRun.findFirst({ where: { job: { key: "learning-engine-daily-run" } }, orderBy: { startedAt: "desc" }, select: { id: true } });
    const { patternsCreated, patternsUpdated, patternsRetired, discovered } = await discoverPatterns(organizationId, runRecord?.id ?? null);

    const intentValidation = await computeIntentValidation(organizationId);
    const priorityValidation = await computePriorityValidation(organizationId);

    const recFromPatterns = await generateRecommendationsFromPatterns(organizationId, discovered);
    const recFromValidation = await generateRecommendationsFromValidation(organizationId, intentValidation, priorityValidation);

    const { computed: shadowScoresComputed } = await computeShadowScoresForOrganization(organizationId);

    const [totalObservations, verifiedOutcomeCount, patternsSufficientData, patternsTotal, recommendationsPending] = await Promise.all([
      prisma.learningObservation.count({ where: { organizationId } }),
      prisma.learningObservation.count({ where: { organizationId, outcome: { in: ["WON", "LOST"] } } }),
      prisma.learningPattern.count({ where: { organizationId, status: { not: "RETIRED" }, sampleClassification: { in: ["OBSERVED", "STRONG_OBSERVATION"] } } }),
      prisma.learningPattern.count({ where: { organizationId, status: { not: "RETIRED" } } }),
      prisma.learningRecommendation.count({ where: { organizationId, status: { in: ["PROPOSED", "UNDER_REVIEW"] } } }),
    ]);
    const unknownOutcomeCount = totalObservations - verifiedOutcomeCount;

    const lastProcessedAt = new Date();
    const status = deriveHealthStatus({ lastProcessedAt, totalObservations, patternsSufficientData });

    await prisma.learningEngineState.upsert({
      where: { organizationId },
      create: {
        organizationId,
        lastProcessedAt,
        datasetVersion: DATASET_VERSION,
        analysisVersion: ANALYSIS_VERSION,
        status,
        totalObservations,
        verifiedOutcomeCount,
        unknownOutcomeCount,
        patternsDetected: patternsTotal,
        patternsSufficientData,
        patternsInsufficientData: patternsTotal - patternsSufficientData,
        recommendationsPending,
      },
      update: {
        lastProcessedAt,
        datasetVersion: DATASET_VERSION,
        analysisVersion: ANALYSIS_VERSION,
        status,
        totalObservations,
        verifiedOutcomeCount,
        unknownOutcomeCount,
        patternsDetected: patternsTotal,
        patternsSufficientData,
        patternsInsufficientData: patternsTotal - patternsSufficientData,
        recommendationsPending,
      },
    });

    const durationMs = Date.now() - startedAt;
    await logAudit({ organizationId, action: "learning.run.completed", metadata: { companiesProcessed, observationsUpserted, patternsCreated, patternsUpdated, patternsRetired, durationMs } });

    return {
      organizationId,
      companiesProcessed,
      observationsUpserted,
      patternsCreated,
      patternsUpdated,
      patternsRetired,
      recommendationsCreated: recFromPatterns + recFromValidation,
      shadowScoresComputed,
      durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.learningEngineState.upsert({
      where: { organizationId },
      create: { organizationId, status: "ERROR", datasetVersion: DATASET_VERSION, analysisVersion: ANALYSIS_VERSION },
      update: { status: "ERROR" },
    });
    await logAudit({ organizationId, action: "learning.run.failed", metadata: { error: message } });
    return {
      organizationId,
      companiesProcessed: 0,
      observationsUpserted: 0,
      patternsCreated: 0,
      patternsUpdated: 0,
      patternsRetired: 0,
      recommendationsCreated: 0,
      shadowScoresComputed: 0,
      durationMs: Date.now() - startedAt,
      error: message,
    };
  }
}
