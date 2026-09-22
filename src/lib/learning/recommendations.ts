import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { LEARNING_CONFIG } from "./config";
import type { DiscoveredPattern } from "./types";
import type { IntentValidationResult } from "./intent-validation";
import type { PriorityValidationResult } from "./priority-validation";

/**
 * §31-33 — the governed recommendation queue. The engine only ever writes
 * status PROPOSED here; approving/rejecting/implementing is always a human
 * action (§32) via approveRecommendation/rejectRecommendation below, which
 * never touch any production scoring/pricing/compliance rule themselves —
 * they only change this row's own status and are audit-logged (§58).
 */

function patternRecommendation(p: DiscoveredPattern): { title: string; currentRule: string; suggestedChange: string; reasoning: string; expectedImpact: string; risk: string; affectedSystem: string } | null {
  if (p.confidence === "LOW" || p.stats.sampleSize < LEARNING_CONFIG.MIN_SAMPLE_FOR_RECOMMENDATION) return null;
  if (p.patternType === "WINNING_PATTERN") {
    return {
      title: `Consider prioritizing ${p.name}`,
      currentRule: "Priority Queue treats this cohort no differently from any other.",
      suggestedChange: `Consider raising priority weighting for opportunities matching ${p.name}.`,
      reasoning: p.description,
      expectedImpact: `${Math.round((p.stats.conversionRate ?? 0) * 100)}% observed conversion vs org baseline, over ${p.stats.sampleSize} observations.`,
      risk: "Based on historical correlation only — causality not established; the underlying driver may be a confound (e.g. lead source quality, not this cohort itself).",
      affectedSystem: "Priority Queue (src/lib/business-development/opportunity-priority.ts)",
    };
  }
  if (p.patternType === "MESSAGE_ANGLE" && (p.stats.conversionRate ?? 0) > 0) {
    return {
      title: `Consider testing the "${p.name.replace("messageAngle: ", "")}" message angle more broadly`,
      currentRule: "Outreach message angle is chosen per-opportunity without this historical signal.",
      suggestedChange: `Consider weighting this message angle higher for similar opportunities.`,
      reasoning: p.description,
      expectedImpact: `${Math.round((p.stats.conversionRate ?? 0) * 100)}% observed conversion over ${p.stats.sampleSize} observations.`,
      risk: "Small underlying sample; message-angle bucketing is a best-effort keyword match, not a controlled vocabulary.",
      affectedSystem: "Outreach message generation (src/app/dashboard/outreach)",
    };
  }
  if (p.patternType === "SERVICE" && (p.stats.conversionRate ?? 0) < 0.15) {
    return {
      title: `Review service matching for ${p.name}`,
      currentRule: "Service recommendation logic does not weight this cohort's historically low observed conversion.",
      suggestedChange: `Consider reviewing why "${p.name.replace("service: ", "")}" recommendations convert below baseline in this cohort.`,
      reasoning: p.description,
      expectedImpact: `Currently ${Math.round((p.stats.conversionRate ?? 0) * 100)}% observed conversion vs org baseline over ${p.stats.sampleSize} observations.`,
      risk: "Low conversion may reflect market fit, pricing, or timing rather than a service-matching defect.",
      affectedSystem: "Service matching (LeadOpportunity.recommendedService)",
    };
  }
  return null;
}

export async function generateRecommendationsFromPatterns(organizationId: string, patterns: DiscoveredPattern[]): Promise<number> {
  let created = 0;
  for (const p of patterns) {
    const rec = patternRecommendation(p);
    if (!rec) continue;
    const existing = await prisma.learningRecommendation.findFirst({ where: { organizationId, title: rec.title, status: { in: ["PROPOSED", "UNDER_REVIEW"] } } });
    if (existing) continue;
    await prisma.learningRecommendation.create({
      data: {
        organizationId,
        category: p.patternType === "SERVICE" ? "SERVICE_MATCHING" : p.patternType === "MESSAGE_ANGLE" ? "OUTREACH" : "PRIORITY",
        title: rec.title,
        currentRule: rec.currentRule,
        suggestedChange: rec.suggestedChange,
        reasoning: rec.reasoning,
        evidencePatternIds: [],
        sampleSize: p.stats.sampleSize,
        confidence: p.confidence,
        expectedImpact: rec.expectedImpact,
        risk: rec.risk,
        affectedSystem: rec.affectedSystem,
        status: "PROPOSED",
      },
    });
    await logAudit({ organizationId, action: "learning.recommendation.created", metadata: { title: rec.title } });
    created += 1;
  }
  return created;
}

export async function generateRecommendationsFromValidation(organizationId: string, intent: IntentValidationResult | null, priority: PriorityValidationResult | null): Promise<number> {
  let created = 0;
  if (intent && intent.calibrated === false) {
    const title = "Review IntentScore calibration — win rate does not increase with intent band";
    const existing = await prisma.learningRecommendation.findFirst({ where: { organizationId, title, status: { in: ["PROPOSED", "UNDER_REVIEW"] } } });
    if (!existing) {
      await prisma.learningRecommendation.create({
        data: {
          organizationId,
          category: "INTENT",
          title,
          currentRule: "IntentScore's HIGH/MEDIUM/LOW/NONE bands are assumed to correlate with win rate.",
          suggestedChange: "Review intent-scoring.ts's signal weighting for this org's cohort — observed win rate does not increase monotonically with intent band.",
          reasoning: intent.summary,
          evidencePatternIds: [],
          sampleSize: intent.sampleSize,
          confidence: "MEDIUM",
          expectedImpact: `${intent.falsePositives.length} false positive(s), ${intent.falseNegatives.length} false negative(s) found.`,
          risk: "Small sample noise cannot be ruled out — verify with a larger sample before changing the scoring formula.",
          affectedSystem: "Intent scoring (src/lib/business-development/intent-scoring.ts)",
          status: "PROPOSED",
        },
      });
      await logAudit({ organizationId, action: "learning.recommendation.created", metadata: { title } });
      created += 1;
    }
  }
  if (priority && priority.falsePositives.length + priority.falseNegatives.length >= LEARNING_CONFIG.MIN_SAMPLE_INSUFFICIENT) {
    const title = "Review Priority Queue false positive/negative rate";
    const existing = await prisma.learningRecommendation.findFirst({ where: { organizationId, title, status: { in: ["PROPOSED", "UNDER_REVIEW"] } } });
    if (!existing) {
      await prisma.learningRecommendation.create({
        data: {
          organizationId,
          category: "PRIORITY",
          title,
          currentRule: "HOT/HIGH priority is assumed to correlate with a higher win rate than LOW/NURTURE.",
          suggestedChange: "Review opportunity-priority.ts's weighting — a meaningful number of HOT/HIGH opportunities are being lost while LOW/NURTURE opportunities are being won.",
          reasoning: priority.summary,
          evidencePatternIds: [],
          sampleSize: priority.decidedCount,
          confidence: "MEDIUM",
          expectedImpact: `${priority.falsePositives.length} false positive(s), ${priority.falseNegatives.length} false negative(s) found.`,
          risk: priority.limitation,
          affectedSystem: "Priority Queue (src/lib/business-development/opportunity-priority.ts)",
          status: "PROPOSED",
        },
      });
      await logAudit({ organizationId, action: "learning.recommendation.created", metadata: { title } });
      created += 1;
    }
  }
  return created;
}

export async function approveRecommendation(organizationId: string, recommendationId: string, reviewedByUserId: string): Promise<void> {
  const rec = await prisma.learningRecommendation.findFirst({ where: { id: recommendationId, organizationId } });
  if (!rec) throw new Error("Recommendation not found.");
  await prisma.learningRecommendation.update({
    where: { id: recommendationId },
    data: { status: "APPROVED", reviewedByUserId, reviewedAt: new Date(), approvedAt: new Date() },
  });
  await logAudit({ organizationId, userId: reviewedByUserId, action: "learning.recommendation.approved", metadata: { recommendationId, title: rec.title } });
}

export async function rejectRecommendation(organizationId: string, recommendationId: string, reviewedByUserId: string, reason?: string): Promise<void> {
  const rec = await prisma.learningRecommendation.findFirst({ where: { id: recommendationId, organizationId } });
  if (!rec) throw new Error("Recommendation not found.");
  await prisma.learningRecommendation.update({
    where: { id: recommendationId },
    data: { status: "REJECTED", reviewedByUserId, reviewedAt: new Date(), rejectionReason: reason ?? null },
  });
  await logAudit({ organizationId, userId: reviewedByUserId, action: "learning.recommendation.rejected", metadata: { recommendationId, title: rec.title, reason } });
}
