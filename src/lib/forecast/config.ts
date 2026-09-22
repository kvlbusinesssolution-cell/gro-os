/**
 * Phase 12 — Predictive Revenue Engine.
 *
 * Configurable thresholds — the ONE place that decides how much real
 * historical data is needed before this engine will compute anything
 * beyond "INSUFFICIENT_HISTORICAL_DATA". Mirrors Phase 11's
 * src/lib/learning/config.ts convention exactly. Defaults are deliberately
 * conservative given this org's real data volume at the time this was
 * written (22 closed deals, 0 open deals, 0 real DealStageHistory rows) —
 * tuning them up to make today's tiny dataset "look forecastable" would be
 * exactly the manufactured-confidence the spec forbids.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const FORECAST_CONFIG = {
  /** Minimum real CLOSED (Won+Lost) deals before an org-wide baseline win rate is trusted at all. */
  MIN_CLOSED_DEALS_FOR_BASELINE: envInt("FORECAST_MIN_CLOSED_DEALS", 10),
  /** Minimum real DealStageHistory transitions INTO a given stage before that stage's historical conversion is trusted. */
  MIN_STAGE_TRANSITIONS: envInt("FORECAST_MIN_STAGE_TRANSITIONS", 10),
  /** Minimum sample for a ForecastCalibration bucket to report a real verdict instead of INSUFFICIENT_DATA. */
  MIN_CALIBRATION_SAMPLE: envInt("FORECAST_MIN_CALIBRATION_SAMPLE", 10),
  /** Bound on how far a Phase-11 cohort pattern may nudge the baseline win rate (± this many percentage points). */
  MAX_COHORT_NUDGE: 0.15,
  /** Same convention as alerts/rules.ts's DEAL_STALLED_DAYS — reused, not redefined, for deal-risk scoring. */
  STALLED_DAYS: 14,
  /** Confidence bucket cutoffs, same shape as Phase 11's LEARNING_CONFIG. */
  CONFIDENCE_HIGH_CUTOFF: 0.75,
  CONFIDENCE_MEDIUM_CUTOFF: 0.45,
} as const;

export const MODEL_VERSION = "v1";
export const FEATURE_VERSION = "v1";
export const LEARNING_VERSION = "v1";

/** Same open/closed terminal-stage convention as revenue/forecast.ts and crm/_lib/forecast.ts — reused verbatim, not redefined. */
export const TERMINAL_STAGE_NAMES = ["Won", "Lost", "Archived"] as const;
