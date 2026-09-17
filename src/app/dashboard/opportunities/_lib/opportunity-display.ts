import type { DecisionMakerRole, OpportunityPriority, OpportunityStatus } from "@/generated/prisma/client";
import type { QualityCheckResult } from "@/lib/outreach/personalization-quality";

/**
 * Pure display-mapping helpers for the AI Opportunities dashboard
 * (/dashboard/opportunities). Kept free of Prisma calls / React so they can
 * be unit-tested in isolation (see opportunity-display.test.ts) — mirrors
 * discovery-buckets.ts's split between pure classification logic and the
 * page that queries Postgres.
 */

export const STATUS_OPTIONS: OpportunityStatus[] = ["NEW", "REVIEWED", "ADDED_TO_CRM", "DISMISSED"];

export const STATUS_LABEL: Record<OpportunityStatus, string> = {
  NEW: "New",
  REVIEWED: "Reviewed",
  ADDED_TO_CRM: "Added to CRM",
  DISMISSED: "Dismissed",
};

export const STATUS_BADGE_CLASSNAME: Record<OpportunityStatus, string> = {
  NEW: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  REVIEWED: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  ADDED_TO_CRM: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  DISMISSED: "border-border bg-muted text-muted-foreground",
};

export const CONFIDENCE_THRESHOLD_OPTIONS = [
  { value: "0", label: "Any confidence" },
  { value: "50", label: "50%+" },
  { value: "70", label: "70%+" },
  { value: "90", label: "90%+" },
] as const;

/**
 * Confidence badge color band. `confidenceScore` is stored 0-100 (see
 * opportunity-engine.ts's `z.number().min(0).max(100)`), so thresholds are
 * on that same scale — not a 0-1 fraction.
 */
export function confidenceBadgeClassName(score: number): string {
  if (score >= 80) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (score >= 50) return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400";
}

/**
 * Phase 4: display mapping for `LeadOpportunity.priority` (AI Priority
 * Queue, /dashboard/priority-queue) — mirrors the `STATUS_LABEL`/
 * `STATUS_BADGE_CLASSNAME` pattern above. `PRIORITY_OPTIONS` is declared in
 * the same order as the `OpportunityPriority` enum in schema.prisma (HOT →
 * DISQUALIFIED), which is also that enum's native Postgres declaration
 * order — the priority-queue page's default `orderBy: { priority: "asc" }`
 * relies on this same ordering to put HOT first without any client-side
 * sort.
 */
export const PRIORITY_OPTIONS: OpportunityPriority[] = ["HOT", "HIGH", "MEDIUM", "NURTURE", "LOW", "DISQUALIFIED"];

export const PRIORITY_LABEL: Record<OpportunityPriority, string> = {
  HOT: "Hot",
  HIGH: "High",
  MEDIUM: "Medium",
  NURTURE: "Nurture",
  LOW: "Low",
  DISQUALIFIED: "Disqualified",
};

/**
 * Priority badge color band — HOT reads as most urgent (red), cooling
 * through orange/amber/sky/slate down to DISQUALIFIED which is muted/gray
 * (matches the DISMISSED treatment in `STATUS_BADGE_CLASSNAME` above).
 */
export const PRIORITY_BADGE_CLASSNAME: Record<OpportunityPriority, string> = {
  HOT: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  HIGH: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  MEDIUM: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  NURTURE: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  LOW: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400",
  DISQUALIFIED: "border-border bg-muted text-muted-foreground",
};

/**
 * Human-readable label for each `DecisionMakerRole` (Phase 3's Target
 * Contact section on the opportunity detail page). Mirrors the
 * `SOURCE_LABEL` lookup pattern in company-evidence-panel.tsx — a plain
 * `Record` over the enum rather than a runtime string transform, so it stays
 * a compile-time-checked exhaustive map (TS errors if a new enum member is
 * added here without a label).
 */
export const DECISION_MAKER_ROLE_LABEL: Record<DecisionMakerRole, string> = {
  FOUNDER: "Founder",
  CO_FOUNDER: "Co-Founder",
  CEO: "CEO",
  DIRECTOR: "Director",
  CTO: "CTO",
  COO: "COO",
  MARKETING_HEAD: "Marketing Head",
  SALES_HEAD: "Sales Head",
  BUSINESS_DEVELOPMENT_HEAD: "Business Development Head",
  IT_HEAD: "IT Head",
  PRODUCT_HEAD: "Product Head",
};

/**
 * "Recommended next action" for the AI Priority Queue
 * (/dashboard/priority-queue) — deliberately grounded in real, already-
 * stored fields, never a fabricated suggestion:
 *   1. `nextStep` (Phase 2's AI Opportunity Brief field, `salesAngle`'s
 *      companion — see opportunity-brief.ts) wins whenever it's actually
 *      been populated — it's the most specific, AI-authored next step
 *      already on file for this exact opportunity.
 *   2. Otherwise falls back to a generic-but-honest action derived purely
 *      from `status` (Phase 2) and, when present, the matched KVL service's
 *      own catalog label (Phase 2's `recommendedService`) — never invents a
 *      service or action that isn't backed by a real field.
 */
export function recommendedNextAction(opportunity: {
  status: OpportunityStatus;
  nextStep: string | null;
  recommendedServiceLabel: string | null;
}): string {
  const nextStep = opportunity.nextStep?.trim();
  if (nextStep) return nextStep;

  if (opportunity.status === "DISMISSED") return "No action — dismissed";
  if (opportunity.status === "ADDED_TO_CRM") return "Already in CRM — follow up there";

  if (opportunity.status === "NEW") {
    return opportunity.recommendedServiceLabel
      ? `Review and pitch ${opportunity.recommendedServiceLabel}`
      : "Review and triage";
  }

  // REVIEWED
  return opportunity.recommendedServiceLabel ? `Pitch ${opportunity.recommendedServiceLabel}` : "Move to CRM or dismiss";
}

/**
 * Phase 5: human-readable label for each field checked by
 * `checkDraftPersonalizationQuality` (personalization-quality.ts) — powers
 * the "Personalization Quality" pre-send checklist panel on the opportunity
 * detail page. Kept as an exhaustive `Record` over that function's
 * `checkedFields` shape, same convention as `DECISION_MAKER_ROLE_LABEL`
 * above — a new field there fails this file's typecheck until a label is
 * added here.
 */
export const PERSONALIZATION_CHECK_LABEL: Record<keyof QualityCheckResult["checkedFields"], string> = {
  companyName: "Mentions the company's real name",
  personName: "Mentions the contact's real first name",
  companyFacts: "References a real researched company fact",
  opportunity: "Grounded in a real, open LeadOpportunity",
  service: "Mentions the recommended KVL service",
  evidence: "Company has real evidence on file",
};

export interface PersonalizationCheckRow {
  key: keyof QualityCheckResult["checkedFields"];
  label: string;
  passed: boolean;
}

/**
 * Pure formatter: turns `checkDraftPersonalizationQuality`'s boolean
 * `checkedFields` map into an ordered, labeled list a reviewer can scan as a
 * checklist — order follows `PERSONALIZATION_CHECK_LABEL`'s declaration
 * order (not object-key iteration order of whatever's passed in), so the
 * panel's row order is stable regardless of how `checkedFields` was built.
 */
export function personalizationCheckRows(checkedFields: QualityCheckResult["checkedFields"]): PersonalizationCheckRow[] {
  return (Object.keys(PERSONALIZATION_CHECK_LABEL) as Array<keyof typeof PERSONALIZATION_CHECK_LABEL>).map((key) => ({
    key,
    label: PERSONALIZATION_CHECK_LABEL[key],
    passed: checkedFields[key],
  }));
}
