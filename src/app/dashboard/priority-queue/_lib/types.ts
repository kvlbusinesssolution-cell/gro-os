import type { OpportunityPriority, OpportunityStatus, BuyingStage } from "@/generated/prisma/client";
import type { OpportunityScoreBreakdown } from "@/lib/business-development/opportunity-priority";

/**
 * Display-ready row shape the server component (page.tsx) builds from the
 * real Prisma query, handed as plain serializable props to the client
 * table/card components — keeps every client component free of Prisma
 * types and safely passable across the server/client boundary.
 */
export interface PriorityQueueRow {
  id: string;
  title: string;
  companyId: string;
  companyName: string;
  companyIndustry: string | null;
  companyCountry: string | null;
  leadScore: number | null;
  leadScoreBand: string | null;
  intentScore: number | null;
  intentScoreBand: string | null;
  /** Phase 28 (buying intent) — real, deterministic buying-stage classification (see classifyBuyingStage in intent-scoring.ts), never derived from intentScore alone. Null when the company has no IntentScore row yet. */
  buyingStage: BuyingStage | null;
  opportunityScore: number | null;
  previousOpportunityScore: number | null;
  opportunityScoreBreakdown: OpportunityScoreBreakdown | null;
  priority: OpportunityPriority | null;
  priorityReasoning: string | null;
  status: OpportunityStatus;
  nextAction: string;
  createdAt: string;
  /** Days since `createdAt`, computed once server-side at query time (see page.tsx) — never recomputed from `Date.now()` inside a render body. */
  ageDays: number;
  ownerUserId: string | null;
  ownerName: string | null;
  snoozedUntil: string | null;
  isSnoozed: boolean;
  /** Phase 11 §44 — a real point-in-time LearningShadowScore comparison, never applied to `opportunityScore` itself. Null when no shadow score has been computed yet, or when it exactly equals the production score (no learned adjustment available). */
  learningShadow: { shadowScore: number; scoreDiff: number; basisPatternIds: string[] } | null;
}
