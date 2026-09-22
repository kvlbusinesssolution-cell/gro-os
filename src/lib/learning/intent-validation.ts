import { prisma } from "@/lib/prisma";
import { LEARNING_CONFIG } from "./config";

/**
 * §24 — Intent Score Validation. Extends the exact "honest or nothing"
 * precedent PredictionCalibration (src/lib/ai/prediction-calibration.ts)
 * already established for BoardReview.winProbability, applied here to
 * IntentScore bands vs real LearningObservation outcomes. Never touches the
 * scoring formula in intent-scoring.ts.
 */
const BANDS = ["HIGH", "MEDIUM", "LOW", "NONE"] as const;

export interface IntentValidationBand {
  band: string;
  sampleSize: number;
  decidedCount: number;
  wonCount: number;
  repliedOrBetterCount: number;
  meetingOrBetterCount: number;
  /** null when decidedCount === 0 — never a fabricated 0%. */
  winRate: number | null;
  replyRate: number | null;
  meetingRate: number | null;
  revenue: number | null;
}

export interface IntentValidationResult {
  sampleSize: number;
  bands: IntentValidationBand[];
  /** Real false-positive/false-negative examples (§53) — every entry links back to a real companyId/observationId. */
  falsePositives: Array<{ observationId: string; companyId: string | null; intentScore: number | null; intentBand: string | null; outcome: string }>;
  falseNegatives: Array<{ observationId: string; companyId: string | null; intentScore: number | null; intentBand: string | null; outcome: string }>;
  calibrated: boolean | null;
  summary: string;
}

const REPLIED_OR_BETTER = new Set(["REPLIED", "MEETING", "PROPOSAL", "WON"]);
const MEETING_OR_BETTER = new Set(["MEETING", "PROPOSAL", "WON"]);

export async function computeIntentValidation(organizationId: string): Promise<IntentValidationResult | null> {
  const observations = await prisma.learningObservation.findMany({
    where: { organizationId, intentBand: { not: null } },
    select: { id: true, companyId: true, intentScore: true, intentBand: true, outcome: true, revenue: true },
  });
  if (observations.length === 0) return null;

  const bands: IntentValidationBand[] = BANDS.map((band) => {
    const inBand = observations.filter((o) => o.intentBand === band);
    const decided = inBand.filter((o) => o.outcome === "WON" || o.outcome === "LOST");
    const won = inBand.filter((o) => o.outcome === "WON");
    const replied = inBand.filter((o) => REPLIED_OR_BETTER.has(o.outcome));
    const meeting = inBand.filter((o) => MEETING_OR_BETTER.has(o.outcome));
    const revenues = inBand.map((o) => o.revenue).filter((v): v is number => v !== null);
    return {
      band,
      sampleSize: inBand.length,
      decidedCount: decided.length,
      wonCount: won.length,
      repliedOrBetterCount: replied.length,
      meetingOrBetterCount: meeting.length,
      winRate: decided.length > 0 ? won.length / decided.length : null,
      replyRate: inBand.length > 0 ? replied.length / inBand.length : null,
      meetingRate: inBand.length > 0 ? meeting.length / inBand.length : null,
      revenue: revenues.length > 0 ? revenues.reduce((a, b) => a + b, 0) : null,
    };
  });

  // §53 false positive/negative: predicted HIGH intent but LOST or
  // NO_RESPONSE; predicted LOW/NONE intent but WON. Real, individually
  // traceable examples — never a fabricated count.
  const falsePositives = observations
    .filter((o) => o.intentBand === "HIGH" && (o.outcome === "LOST" || o.outcome === "NO_RESPONSE"))
    .map((o) => ({ observationId: o.id, companyId: o.companyId, intentScore: o.intentScore, intentBand: o.intentBand, outcome: o.outcome }));
  const falseNegatives = observations
    .filter((o) => (o.intentBand === "LOW" || o.intentBand === "NONE") && o.outcome === "WON")
    .map((o) => ({ observationId: o.id, companyId: o.companyId, intentScore: o.intentScore, intentBand: o.intentBand, outcome: o.outcome }));

  const totalDecided = observations.filter((o) => o.outcome === "WON" || o.outcome === "LOST").length;
  const calibrated = totalDecided < LEARNING_CONFIG.MIN_SAMPLE_INSUFFICIENT ? null : bandsAreOrdered(bands);

  const summary =
    totalDecided < LEARNING_CONFIG.MIN_SAMPLE_INSUFFICIENT
      ? `Only ${totalDecided} decided (won/lost) observation(s) with a known intent band exist — INSUFFICIENT DATA to judge whether IntentScore is calibrated.`
      : calibrated
        ? `Across ${totalDecided} decided observations, higher intent bands show a higher observed win rate — consistent with (not proof of) IntentScore being calibrated. ${falsePositives.length} false positive(s) and ${falseNegatives.length} false negative(s) found.`
        : `Across ${totalDecided} decided observations, win rate does NOT increase monotonically with intent band — IntentScore appears mis-calibrated for this cohort, or the sample is still too noisy to tell. ${falsePositives.length} false positive(s) and ${falseNegatives.length} false negative(s) found.`;

  return { sampleSize: observations.length, bands, falsePositives, falseNegatives, calibrated, summary };
}

function bandsAreOrdered(bands: IntentValidationBand[]): boolean {
  const withData = bands.filter((b) => b.winRate !== null);
  if (withData.length < 2) return false;
  const order = ["HIGH", "MEDIUM", "LOW", "NONE"];
  const sorted = [...withData].sort((a, b) => order.indexOf(a.band) - order.indexOf(b.band));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.winRate! > sorted[i - 1]!.winRate!) return false;
  }
  return true;
}
