import type { LearningConfidence, PredictionType } from "@/generated/prisma/client";

export type { LearningConfidence, PredictionType };

export interface ConfidenceFactors {
  sampleSize: number;
  dataCompleteness: number;
  cohortSimilarity: number;
  calibrationQuality: number;
  forecastHorizonPenalty: number;
  weightedScore: number;
}

export type DealRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";

export interface DealRiskReason {
  reason: string;
  evidence: string;
}

export interface DealRiskAssessment {
  dealId: string;
  riskLevel: DealRiskLevel;
  reasons: DealRiskReason[];
  computedAt: string;
}

export interface CalibratedProbabilityResult {
  probability: number | null;
  method: string;
  confidence: LearningConfidence;
  confidenceFactors: ConfidenceFactors;
  evidenceIds: string[];
  dataCutoffTimestamp: Date;
  insufficientData: boolean;
}

export interface PredictionWriteInput {
  organizationId: string;
  predictionType: PredictionType;
  entityType: "DEAL" | "ORGANIZATION";
  entityId: string;
  predictionValue?: number | null;
  predictionProbability?: number | null;
  confidence: LearningConfidence;
  confidenceFactors: ConfidenceFactors | Record<string, never>;
  forecastPeriod?: string | null;
  dataCutoffTimestamp: Date;
  modelMethod: string;
  currency?: string | null;
  lowerBound?: number | null;
  upperBound?: number | null;
  explanation?: string | null;
  evidenceIds?: string[];
  runId?: string | null;
}
