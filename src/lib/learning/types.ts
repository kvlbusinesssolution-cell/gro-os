import type {
  LearningConfidence,
  LearningHealthStatus,
  LearningOutcome,
  LearningPatternStatus,
  LearningPatternType,
  LearningRecommendationCategory,
  LearningRecommendationStatus,
  LearningSampleClassification,
} from "@/generated/prisma/client";

/** A single stage timestamp entry stored in LearningObservation.stageTimestamps. Missing stages are simply absent keys — never inferred (§4). */
export interface StageTimestamps {
  foundAt?: string;
  qualifiedAt?: string;
  contactedAt?: string;
  repliedAt?: string;
  meetingAt?: string;
  proposalAt?: string;
  wonAt?: string;
  lostAt?: string;
  revenueAt?: string;
}

export interface IntentSignalSnapshot {
  signal: string;
  source: string;
  detail?: string;
  points?: number;
}

/** Mirrors ConversationIntelligence.objections' own element shape — copied verbatim, never re-derived. */
export interface ObjectionSnapshot {
  value?: string;
  type?: string;
  description?: string;
  sourceMessageId?: string;
  sourceQuote?: string;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  classification?: "CONFIRMED" | "INFERRED" | "UNKNOWN";
}

/** The real, computed factors behind a LearningPattern's confidence — never hidden (§10). */
export interface ConfidenceFactors {
  sampleSize: number;
  outcomeConsistency: number;
  timeStability: number;
  dataCompleteness: number;
  crossCohortStability: number;
  weightedScore: number;
}

export interface CohortCondition {
  dimension: string;
  value: string;
}

export interface CohortStats {
  sampleSize: number;
  positiveOutcomes: number;
  negativeOutcomes: number;
  conversionRate: number | null;
  revenue: number | null;
  avgDealSize: number | null;
  medianDealSize: number | null;
  avgSalesCycleDays: number | null;
  medianSalesCycleDays: number | null;
  observationIds: string[];
  timePeriodStart: Date;
  timePeriodEnd: Date;
}

export interface DiscoveredPattern {
  patternType: LearningPatternType;
  name: string;
  description: string;
  conditions: CohortCondition[];
  cohort: Record<string, string>;
  stats: CohortStats;
  sampleClassification: LearningSampleClassification;
  confidence: LearningConfidence;
  confidenceFactors: ConfidenceFactors;
}

export type { LearningOutcome, LearningConfidence, LearningSampleClassification, LearningPatternStatus, LearningPatternType, LearningRecommendationCategory, LearningRecommendationStatus, LearningHealthStatus };
