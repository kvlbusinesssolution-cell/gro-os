import { prisma } from "@/lib/prisma";

import { buildOpportunityBrief, type OpportunityBrief } from "./opportunity-brief";
import { matchDecisionMakerForOpportunity, type DecisionMakerMatch } from "./decision-maker-matching";

/**
 * Phase 2 (Buying Intent Intelligence Engine) §13-15 — "Recommended Action".
 * A pure READ-TIME composer, deliberately zero new scoring/matching logic:
 * reuses the EXISTING best-opportunity selection (same ordering
 * personalization.ts already uses), the EXISTING `buildOpportunityBrief`
 * (recommended service + why + sales angle + next step, all real,
 * already-persisted AI output from opportunity-engine.ts), and the EXISTING
 * `matchDecisionMakerForOpportunity` (role-relevance scoring). This function
 * does not call an AI provider and does not create anything — it only
 * assembles what already exists, or honestly reports there's nothing to
 * recommend yet.
 */
export interface RecommendedAction {
  hasRecommendation: boolean;
  opportunityId: string | null;
  brief: OpportunityBrief | null;
  decisionMaker: DecisionMakerMatch | null;
  // KVL's only real, built outreach send channel today (email — see Phase 0
  // audit: WhatsApp/LinkedIn-send/AI-voice don't exist yet) — never
  // presented as a choice among channels that don't actually work.
  recommendedChannel: "EMAIL";
  summary: string;
}

export async function getIntentRecommendedAction(companyId: string): Promise<RecommendedAction> {
  const opportunity = await prisma.leadOpportunity.findFirst({
    where: { companyId, status: { not: "DISMISSED" } },
    orderBy: [{ priority: "asc" }, { opportunityScore: "desc" }, { createdAt: "desc" }],
  });

  if (!opportunity) {
    return {
      hasRecommendation: false,
      opportunityId: null,
      brief: null,
      decisionMaker: null,
      recommendedChannel: "EMAIL",
      summary: "No qualified opportunity has been detected for this company yet — nothing to recommend.",
    };
  }

  const [brief, decisionMakers] = await Promise.all([
    buildOpportunityBrief(opportunity.id),
    prisma.decisionMaker.findMany({ where: { companyId } }),
  ]);

  const decisionMaker = matchDecisionMakerForOpportunity(opportunity.recommendedService, decisionMakers);

  const summaryParts = [
    decisionMaker ? `Contact ${decisionMaker.decisionMaker.name} (${decisionMaker.decisionMaker.role.replaceAll("_", " ").toLowerCase()})` : "No verified decision-maker identified yet",
    brief?.recommendedService ? `about ${brief.recommendedService.label}` : null,
    "via Email",
  ].filter(Boolean);

  return {
    hasRecommendation: true,
    opportunityId: opportunity.id,
    brief,
    decisionMaker,
    recommendedChannel: "EMAIL",
    summary: summaryParts.join(" ") + ".",
  };
}
