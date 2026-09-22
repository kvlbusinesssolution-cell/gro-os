/**
 * Phase 11 — Closed-Loop Revenue Learning Engine.
 *
 * Configurable sample-size / stability thresholds (§9). These are the ONE
 * place that decides how many real observations a cohort needs before the
 * engine will call it anything more than INSUFFICIENT_DATA — every other
 * module imports from here rather than hardcoding a number. Overridable via
 * env for orgs with very different data volumes; the defaults below are
 * deliberately conservative given this org's real, currently-sparse dataset
 * (11 companies / 14 opportunities at the time this was written) — a
 * threshold tuned to make today's data "look better" would be exactly the
 * kind of manufactured significance §16/§55 forbid.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const LEARNING_CONFIG = {
  /** Below this sample size, a cohort is always INSUFFICIENT_DATA. */
  MIN_SAMPLE_INSUFFICIENT: envInt("LEARNING_MIN_SAMPLE_INSUFFICIENT", 10),
  /** At/above this, and with ≥1 repeated observation window, a cohort is at least OBSERVED. */
  MIN_SAMPLE_OBSERVED: envInt("LEARNING_MIN_SAMPLE_OBSERVED", 30),
  /** At/above this, observed stably across ≥3 time windows, a cohort can be STRONG_OBSERVATION. */
  MIN_SAMPLE_STRONG: envInt("LEARNING_MIN_SAMPLE_STRONG", 100),
  /** Minimum sample size to even persist a LearningPattern row at all (below this is pure noise, not worth storing). */
  MIN_SAMPLE_TO_PERSIST: envInt("LEARNING_MIN_SAMPLE_TO_PERSIST", 2),
  /** Number of sub-periods (roughly equal-sized time buckets) a pattern must be re-observed in to count as "stable". */
  STABILITY_WINDOWS_REQUIRED: envInt("LEARNING_STABILITY_WINDOWS_REQUIRED", 3),
  /** Confidence bucket cutoffs on the 0-1 weighted confidence score. */
  CONFIDENCE_HIGH_CUTOFF: 0.75,
  CONFIDENCE_MEDIUM_CUTOFF: 0.45,
  /** Minimum confidence + sample size for the engine to propose a LearningRecommendation at all. */
  MIN_SAMPLE_FOR_RECOMMENDATION: envInt("LEARNING_MIN_SAMPLE_FOR_RECOMMENDATION", 30),
} as const;

/** Confidence factor weights — documented, deterministic, never LLM-generated (§10). */
export const CONFIDENCE_WEIGHTS = {
  sampleSize: 0.3,
  outcomeConsistency: 0.25,
  timeStability: 0.2,
  dataCompleteness: 0.15,
  crossCohortStability: 0.1,
} as const;

export const DATASET_VERSION = "v1";
export const ANALYSIS_VERSION = "v1";
