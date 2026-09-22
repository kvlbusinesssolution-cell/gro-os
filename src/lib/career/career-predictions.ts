/**
 * Phase 29 — career-side outcome-likelihood predictions: match-to-response,
 * application-response, interview, offer likelihood. The 4 of Phase 29's
 * required career predictions genuinely missing from Phase 22's
 * outcome-analytics.ts, which computes real REAR-FACING rate OBSERVATIONs
 * for closed historical cohorts (e.g. "resume version A had a 20% response
 * rate historically") but never forward-projects one onto a specific new
 * case. `JobMatch.overallScore` (Phase 19) is a separate, deterministic
 * FIT score — never itself a real outcome-probability. This module blends
 * the two: a real historical rate for the comparable cohort, forward-applied
 * as a PREDICTION, always honoring the exact same INSUFFICIENT_DATA
 * sample-gating already proven in outcome-analytics.ts (classifySampleSize/
 * classifyConfidence, reused directly — not reinvented thresholds).
 */

import { prisma } from "@/lib/prisma";
import { classifySampleSize, classifyConfidence, type SampleClassification, type Confidence } from "./outcome-analytics";

export interface CareerPrediction {
  kind: "PREDICTION";
  label: string;
  numerator: number;
  denominator: number;
  likelihood: number | null;
  sampleSize: number;
  sampleClassification: SampleClassification;
  confidence: Confidence;
  insufficientData: boolean;
  /** Present only for match-to-response — the real Phase-19 fit score this prediction was blended with. */
  fitScore: number | null;
  statement: string;
}

function buildPrediction(label: string, numerator: number, denominator: number, fitScore: number | null = null): CareerPrediction {
  const sampleClassification = classifySampleSize(denominator);
  const confidence = classifyConfidence(denominator, sampleClassification);
  const likelihood = denominator > 0 ? numerator / denominator : null;
  const insufficientData = sampleClassification === "INSUFFICIENT_DATA";

  const statement =
    denominator === 0
      ? `No real historical sample for "${label}" — INSUFFICIENT_DATA, no prediction made.`
      : insufficientData
        ? `Only ${denominator} comparable real historical case(s) exist for "${label}" — too small to predict reliably. INSUFFICIENT_DATA.`
        : `Based on ${denominator} comparable real historical case(s), "${label}" occurred ${Math.round((likelihood ?? 0) * 100)}% of the time — applied forward as a likelihood, never a guarantee.${fitScore !== null ? ` Blended with this job's real ${fitScore}/100 fit score.` : ""}`;

  return { kind: "PREDICTION", label, numerator, denominator, likelihood, sampleSize: denominator, sampleClassification, confidence, insufficientData, fitScore, statement };
}

const RESPONDED_STATUSES = ["INTERVIEW", "OFFER", "REJECTED", "CLOSED"] as const;
const INTERVIEWED_OR_BEYOND = ["INTERVIEW", "OFFER"] as const;

/**
 * Real historical application-response rate for the given role title,
 * forward-applied to a new/pending application for a comparable role. Falls
 * back to the profile's overall (all-roles) historical rate when no exact
 * role-title match exists — never fabricates a role-specific number from
 * zero role-specific data.
 */
export async function predictApplicationResponseLikelihood(organizationId: string, careerProfileId: string, roleTitle: string): Promise<CareerPrediction> {
  const exact = await prisma.jobApplication.findMany({
    where: { organizationId, careerProfileId, job: { title: roleTitle } },
    select: { status: true, communications: { select: { matchStatus: true } } },
  });
  const pool = exact.length > 0 ? exact : await prisma.jobApplication.findMany({ where: { organizationId, careerProfileId }, select: { status: true, communications: { select: { matchStatus: true } } } });
  const responded = pool.filter((a) => a.communications.some((c) => c.matchStatus === "MATCHED") || (RESPONDED_STATUSES as readonly string[]).includes(a.status)).length;
  const label = exact.length > 0 ? `response for role "${roleTitle}"` : `response across all applied roles (no prior application to "${roleTitle}" specifically)`;
  return buildPrediction(label, responded, pool.length);
}

/** Same pattern as predictApplicationResponseLikelihood, for interview conversion. */
export async function predictInterviewLikelihood(organizationId: string, careerProfileId: string, roleTitle: string): Promise<CareerPrediction> {
  const exact = await prisma.jobApplication.findMany({ where: { organizationId, careerProfileId, job: { title: roleTitle } }, select: { status: true } });
  const pool = exact.length > 0 ? exact : await prisma.jobApplication.findMany({ where: { organizationId, careerProfileId }, select: { status: true } });
  const interviewed = pool.filter((a) => (INTERVIEWED_OR_BEYOND as readonly string[]).includes(a.status)).length;
  const label = exact.length > 0 ? `interview for role "${roleTitle}"` : `interview across all applied roles (no prior application to "${roleTitle}" specifically)`;
  return buildPrediction(label, interviewed, pool.length);
}

/** Same pattern, for offer conversion. */
export async function predictOfferLikelihood(organizationId: string, careerProfileId: string, roleTitle: string): Promise<CareerPrediction> {
  const exact = await prisma.jobApplication.findMany({ where: { organizationId, careerProfileId, job: { title: roleTitle } }, select: { status: true } });
  const pool = exact.length > 0 ? exact : await prisma.jobApplication.findMany({ where: { organizationId, careerProfileId }, select: { status: true } });
  const offered = pool.filter((a) => a.status === "OFFER").length;
  const label = exact.length > 0 ? `offer for role "${roleTitle}"` : `offer across all applied roles (no prior application to "${roleTitle}" specifically)`;
  return buildPrediction(label, offered, pool.length);
}

/**
 * Match-to-response likelihood — the one prediction that genuinely blends
 * two real, distinct signals: JobMatch.overallScore (Phase 19's
 * deterministic fit score for THIS specific match) and the real historical
 * response rate for comparable past applications to the same role title.
 * The fit score never substitutes for real historical data — it's surfaced
 * alongside the rate, not multiplied into it, since there's no real
 * evidence yet correlating this profile's specific fit-score bands with its
 * own response outcomes (that correlation would itself need real sample
 * size to claim — not asserted here without it).
 */
export async function predictMatchResponseLikelihood(organizationId: string, jobMatchId: string): Promise<CareerPrediction> {
  const match = await prisma.jobMatch.findUniqueOrThrow({
    where: { id: jobMatchId },
    select: { overallScore: true, careerProfileId: true, job: { select: { title: true } } },
  });
  const base = await predictApplicationResponseLikelihood(organizationId, match.careerProfileId, match.job.title);
  return { ...base, label: `response likelihood for this match ("${match.job.title}")`, fitScore: match.overallScore };
}
