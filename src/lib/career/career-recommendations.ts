/**
 * Phase 22 (Career Learning + Job Market Intelligence) — §18/§46/§48 career
 * RECOMMENDATION generation. Writes to the existing, reused
 * LearningRecommendation model (see its schema.prisma doc comment) — always
 * status PROPOSED, always approvalRequired=true, NEVER auto-applies a
 * change to CareerProfile. Only proposes a recommendation when the
 * underlying observation clears LEARNING_CONFIG.MIN_SAMPLE_FOR_RECOMMENDATION
 * (§16, §48, §49) — no recommendation from "one successful application, one
 * rejection, one interview".
 */

import { prisma } from "@/lib/prisma";
import { LEARNING_CONFIG } from "@/lib/learning/config";
import { getResumePerformance } from "./outcome-analytics";

export interface GeneratedRecommendation {
  category: "CV_VERSION" | "SKILL_DEVELOPMENT" | "JOB_PRIORITIZATION" | "APPLICATION_TIMING" | "SOURCE_MONITORING";
  title: string;
  currentRule: string;
  suggestedChange: string;
  reasoning: string;
  sampleSize: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
}

/**
 * §6/§48 — CV version recommendations only ever fire when BOTH versions
 * individually clear MIN_SAMPLE_FOR_RECOMMENDATION — comparing a
 * 2-application version against a 50-application version (the spec's own
 * §62 small-sample test) must never produce "use Version B", since Version
 * A's tiny sample makes any comparison meaningless either way.
 */
export async function generateCvVersionRecommendation(organizationId: string, careerProfileId: string): Promise<GeneratedRecommendation | null> {
  const perf = await getResumePerformance(organizationId, careerProfileId);
  const eligible = perf.versions.filter((v) => v.applications >= LEARNING_CONFIG.MIN_SAMPLE_FOR_RECOMMENDATION);
  if (eligible.length < 2) return null;

  const best = [...eligible].sort((a, b) => (b.interviewRate.rate ?? 0) - (a.interviewRate.rate ?? 0))[0]!;
  const rest = eligible.filter((v) => v.resumeId !== best.resumeId);
  const worstOfRest = rest.sort((a, b) => (a.interviewRate.rate ?? 0) - (b.interviewRate.rate ?? 0))[0];
  if (!worstOfRest || (best.interviewRate.rate ?? 0) <= (worstOfRest.interviewRate.rate ?? 0)) return null;

  return {
    category: "CV_VERSION",
    title: `Resume v${best.resumeVersion} shows a higher observed interview rate`,
    currentRule: "No resume version is currently prioritized for new applications.",
    suggestedChange: `Consider using resume v${best.resumeVersion} for similar future roles.`,
    reasoning: `Within the observed sample, resume v${best.resumeVersion} (${best.applications} applications) had a ${Math.round((best.interviewRate.rate ?? 0) * 100)}% interview rate, versus v${worstOfRest.resumeVersion} (${worstOfRest.applications} applications) at ${Math.round((worstOfRest.interviewRate.rate ?? 0) * 100)}%. This is an observed association within this data, not a proven cause — other factors (job type, seniority, timing) were not controlled for.`,
    sampleSize: best.applications + worstOfRest.applications,
    confidence: best.interviewRate.confidence,
  };
}

/** §18 — persists a generated recommendation exactly as PROPOSED; never writes APPROVED/IMPLEMENTED itself (§32/§48). */
export async function proposeCareerRecommendation(organizationId: string, careerProfileId: string, rec: GeneratedRecommendation, evidenceApplicationIds: string[]): Promise<{ id: string } | null> {
  // Idempotency: don't create a near-duplicate PROPOSED recommendation of
  // the same category for the same profile if one is already pending
  // review — the engine proposes, it doesn't spam.
  const existing = await prisma.learningRecommendation.findFirst({
    where: { organizationId, careerProfileId, category: rec.category, status: "PROPOSED" },
  });
  if (existing) return null;

  const row = await prisma.learningRecommendation.create({
    data: {
      organizationId,
      careerProfileId,
      category: rec.category,
      title: rec.title,
      currentRule: rec.currentRule,
      suggestedChange: rec.suggestedChange,
      reasoning: rec.reasoning,
      evidencePatternIds: evidenceApplicationIds,
      sampleSize: rec.sampleSize,
      confidence: rec.confidence,
      expectedImpact: "May improve observed interview rate for future applications of a similar type — not guaranteed (§17 correlation, not causation).",
      risk: "Based on an uncontrolled observational comparison; other factors (job type, seniority, timing, company) were not held constant.",
      affectedSystem: "career-resume-selection",
      approvalRequired: true,
    },
  });
  return { id: row.id };
}
