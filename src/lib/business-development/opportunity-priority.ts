import { prisma } from "@/lib/prisma";
import type { OpportunityPriority, Prisma } from "@/generated/prisma/client";

import { computeIntentScore } from "@/lib/business-development/intent-scoring";

/**
 * Opportunity Score & Priority — Phase 4, factor #3 of 3 ("How relevant and
 * actionable is the detected KVL opportunity?"). Deliberately SEPARATE from
 * LeadScore (#1, relevance/fit) and IntentScore (#2, buying-intent
 * evidence). Deterministic, no AI call — a weighted blend of five 0-100
 * sub-scores, three of which REUSE existing, already-computed data rather
 * than recomputing it:
 *   - businessRelevance reuses LeadScore.overallScore (src/lib/lead-scoring.ts)
 *   - intent reuses/derives IntentScore.score (computeIntentScore, above)
 *   - serviceMatch reuses LeadOpportunity.serviceMatchScore (Phase 2)
 * Only problemSeverity and evidenceQuality are newly derived here, both
 * from fields that already exist on the opportunity/company.
 */

export interface OpportunityScoreBreakdown {
  problemSeverity: number;
  serviceMatch: number;
  evidenceQuality: number;
  intent: number;
  businessRelevance: number;
  total: number;
}

export interface OpportunityPriorityComputation {
  opportunityScore: number;
  breakdown: OpportunityScoreBreakdown;
  priority: OpportunityPriority;
  priorityReasoning: string;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

// ----- Configurable weights (sum to 1.0) -----
// Documented rationale: problemSeverity and serviceMatch are weighted
// heaviest (0.25 each) because they most directly answer "is this a real,
// well-matched opportunity." intent (0.20) matters — timing — but is
// deliberately weighted below the two "is this real/relevant" factors so a
// company with strong intent but a weak/poorly-matched opportunity doesn't
// outrank a strong, well-evidenced match. evidenceQuality and
// businessRelevance (0.15 each) are supporting factors: they raise/lower
// confidence in the other three rather than driving priority on their own.
export const WEIGHTS = {
  problemSeverity: 0.25,
  serviceMatch: 0.25,
  evidenceQuality: 0.15,
  intent: 0.2,
  businessRelevance: 0.15,
} as const;

// ----- problemSeverity mapping (estimatedImpact -> 0-100) -----
const IMPACT_SEVERITY: Record<string, number> = { low: 30, medium: 65, high: 100 };
const DEFAULT_PROBLEM_SEVERITY = 30; // unrecognized/legacy value: treat as "low" rather than inflating

// ----- evidenceQuality bucketing (real CompanyEvidence row count -> 0-100) -----
// Documented rationale: rewards opportunities grounded in more real,
// stored evidence (not just AI confidence) — a company with 6+ evidence
// rows has been genuinely investigated; 0 facts means the opportunity
// rests entirely on the AI-authored `evidence` text field with nothing
// independently verifiable backing it yet, so it scores low but not zero
// (the opportunity may still be legitimate, just unconfirmed).
function evidenceQualityFor(evidenceCount: number): number {
  if (evidenceCount >= 6) return 95;
  if (evidenceCount >= 3) return 75;
  if (evidenceCount >= 1) return 50;
  return 20;
}

const DEFAULT_SERVICE_MATCH = 50; // pre-Phase-2 rows with no serviceMatchScore yet
const DEFAULT_BUSINESS_RELEVANCE = 50; // no LeadScore computed yet

// ----- Priority thresholds (configurable, sum-independent of weights) -----
export const PRIORITY_THRESHOLDS = { HOT: 80, HIGH: 65, MEDIUM: 45, NURTURE: 25, LOW: 0 } as const;

function priorityForScore(total: number): Exclude<OpportunityPriority, "DISQUALIFIED"> {
  if (total >= PRIORITY_THRESHOLDS.HOT) return "HOT";
  if (total >= PRIORITY_THRESHOLDS.HIGH) return "HIGH";
  if (total >= PRIORITY_THRESHOLDS.MEDIUM) return "MEDIUM";
  if (total >= PRIORITY_THRESHOLDS.NURTURE) return "NURTURE";
  return "LOW";
}

function dominantFactors(breakdown: OpportunityScoreBreakdown): string[] {
  const labeled: Array<{ label: string; value: number }> = [
    { label: `strong problem severity (${breakdown.problemSeverity})`, value: breakdown.problemSeverity },
    { label: `strong service match (${breakdown.serviceMatch})`, value: breakdown.serviceMatch },
    { label: `strong evidence quality (${breakdown.evidenceQuality})`, value: breakdown.evidenceQuality },
    { label: `recent hiring/expansion signals (intent ${breakdown.intent})`, value: breakdown.intent },
    { label: `strong business relevance (${breakdown.businessRelevance})`, value: breakdown.businessRelevance },
  ];
  return labeled
    .filter((f) => f.value >= 70)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((f) => f.label);
}

function weakestFactor(breakdown: OpportunityScoreBreakdown): string {
  const labeled: Array<{ label: string; value: number }> = [
    { label: `problem severity is moderate (${breakdown.problemSeverity})`, value: breakdown.problemSeverity },
    { label: `service match is moderate (${breakdown.serviceMatch})`, value: breakdown.serviceMatch },
    { label: `evidence quality is thin (${breakdown.evidenceQuality})`, value: breakdown.evidenceQuality },
    { label: `intent signals are weak (${breakdown.intent})`, value: breakdown.intent },
    { label: `business relevance is moderate (${breakdown.businessRelevance})`, value: breakdown.businessRelevance },
  ];
  return labeled.sort((a, b) => a.value - b.value)[0].label;
}

export async function computeOpportunityScore(opportunityId: string): Promise<OpportunityPriorityComputation | null> {
  const opportunity = await prisma.leadOpportunity.findUnique({
    where: { id: opportunityId },
    include: { company: true },
  });
  if (!opportunity) return null;

  const companyId = opportunity.companyId;

  const [leadScore, evidenceCount] = await Promise.all([
    prisma.leadScore.findUnique({ where: { companyId } }),
    prisma.companyEvidence.count({ where: { companyId } }),
  ]);

  // IntentScore: read the existing row if present, else compute it now
  // (computeIntentScore is idempotent/upsert-based, so calling it here is
  // safe even if it was already run — it just reflects current data).
  const existingIntentScore = await prisma.intentScore.findUnique({ where: { companyId } });
  const intentComputation = existingIntentScore ?? (await computeIntentScore(companyId));

  const problemSeverity = IMPACT_SEVERITY[opportunity.estimatedImpact] ?? DEFAULT_PROBLEM_SEVERITY;
  const serviceMatch = opportunity.serviceMatchScore ?? DEFAULT_SERVICE_MATCH;
  const evidenceQuality = evidenceQualityFor(evidenceCount);
  const intent = intentComputation?.score ?? 0;
  const businessRelevance = leadScore?.overallScore ?? DEFAULT_BUSINESS_RELEVANCE;

  const total = clamp(
    WEIGHTS.problemSeverity * problemSeverity +
      WEIGHTS.serviceMatch * serviceMatch +
      WEIGHTS.evidenceQuality * evidenceQuality +
      WEIGHTS.intent * intent +
      WEIGHTS.businessRelevance * businessRelevance,
  );

  const breakdown: OpportunityScoreBreakdown = { problemSeverity, serviceMatch, evidenceQuality, intent, businessRelevance, total };

  // DISQUALIFIED override: a DISMISSED opportunity is always DISQUALIFIED
  // regardless of score — the sales team has already decided it's not
  // being pursued, so priority must reflect that decision, not the math.
  const priority: OpportunityPriority = opportunity.status === "DISMISSED" ? "DISQUALIFIED" : priorityForScore(total);

  let priorityReasoning: string;
  if (priority === "DISQUALIFIED") {
    priorityReasoning = `DISQUALIFIED — this opportunity's status is DISMISSED, which always overrides the computed score (${total}) regardless of its underlying factors.`;
  } else {
    const strengths = dominantFactors(breakdown);
    const weakest = weakestFactor(breakdown);
    priorityReasoning =
      strengths.length > 0
        ? `${priority} priority (score ${total}) — ${strengths.join(" and ")}, though ${weakest}.`
        : `${priority} priority (score ${total}) — no single factor is particularly strong; ${weakest}.`;
  }

  await prisma.leadOpportunity.update({
    where: { id: opportunityId },
    data: {
      opportunityScore: total,
      opportunityScoreBreakdown: breakdown as unknown as Prisma.InputJsonValue,
      priority,
      priorityReasoning,
    },
  });

  return { opportunityScore: total, breakdown, priority, priorityReasoning };
}
