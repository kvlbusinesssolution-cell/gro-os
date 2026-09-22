import { prisma } from "@/lib/prisma";
import { LEARNING_CONFIG } from "./config";

/**
 * §23/§53 — Lead Priority Learning / false-positive & false-negative
 * detection. Reads LeadOpportunity.priority as it stands TODAY (there is no
 * timestamped priority-at-prediction-time history in this schema beyond the
 * single-step-back `previousOpportunityScore` — a real, documented
 * limitation, not a fabricated snapshot) against the real, decided
 * LearningObservation outcome. Never touches opportunity-priority.ts's
 * scoring formula.
 */
const HIGH_PRIORITY = new Set(["HOT", "HIGH"]);
const LOW_PRIORITY = new Set(["LOW", "NURTURE"]);

export interface PriorityValidationRow {
  observationId: string;
  companyId: string | null;
  leadOpportunityId: string | null;
  priority: string | null;
  opportunityScore: number | null;
  outcome: string;
}

export interface PriorityValidationResult {
  sampleSize: number;
  decidedCount: number;
  highPriorityWinRate: number | null;
  lowPriorityWinRate: number | null;
  falsePositives: PriorityValidationRow[];
  falseNegatives: PriorityValidationRow[];
  summary: string;
  limitation: string;
}

export async function computePriorityValidation(organizationId: string): Promise<PriorityValidationResult | null> {
  const observations = await prisma.learningObservation.findMany({
    where: { organizationId, leadOpportunityId: { not: "" } },
    select: { id: true, companyId: true, leadOpportunityId: true, outcome: true },
  });
  if (observations.length === 0) return null;

  const opportunityIds = observations.map((o) => o.leadOpportunityId).filter((v): v is string => !!v);
  const opportunities = await prisma.leadOpportunity.findMany({
    where: { id: { in: opportunityIds } },
    select: { id: true, priority: true, opportunityScore: true },
  });
  const byOppId = new Map(opportunities.map((o) => [o.id, o]));

  const rows: PriorityValidationRow[] = observations.map((o) => {
    const opp = o.leadOpportunityId ? byOppId.get(o.leadOpportunityId) : null;
    return { observationId: o.id, companyId: o.companyId, leadOpportunityId: o.leadOpportunityId, priority: opp?.priority ?? null, opportunityScore: opp?.opportunityScore ?? null, outcome: o.outcome };
  });

  const decided = rows.filter((r) => r.outcome === "WON" || r.outcome === "LOST");
  const highDecided = decided.filter((r) => r.priority && HIGH_PRIORITY.has(r.priority));
  const lowDecided = decided.filter((r) => r.priority && LOW_PRIORITY.has(r.priority));

  const falsePositives = rows.filter((r) => r.priority && HIGH_PRIORITY.has(r.priority) && (r.outcome === "LOST" || r.outcome === "NO_RESPONSE"));
  const falseNegatives = rows.filter((r) => r.priority && LOW_PRIORITY.has(r.priority) && r.outcome === "WON");

  const summary =
    decided.length < LEARNING_CONFIG.MIN_SAMPLE_INSUFFICIENT
      ? `Only ${decided.length} decided (won/lost) opportunity outcome(s) exist — INSUFFICIENT DATA to judge whether priority scoring is calibrated.`
      : `Across ${decided.length} decided opportunities, ${falsePositives.length} were scored HOT/HIGH but LOST or went NO_RESPONSE, and ${falseNegatives.length} were scored LOW/NURTURE but WON.`;

  return {
    sampleSize: rows.length,
    decidedCount: decided.length,
    highPriorityWinRate: highDecided.length > 0 ? highDecided.filter((r) => r.outcome === "WON").length / highDecided.length : null,
    lowPriorityWinRate: lowDecided.length > 0 ? lowDecided.filter((r) => r.outcome === "WON").length / lowDecided.length : null,
    falsePositives,
    falseNegatives,
    summary,
    limitation: "Priority reflects LeadOpportunity's current value, not a timestamped snapshot from before the outcome was known — this schema has no such history beyond the one-step-back previousOpportunityScore field.",
  };
}
