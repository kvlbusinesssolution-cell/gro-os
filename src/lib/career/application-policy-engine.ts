/**
 * Phase 20 — §15/§22/§48 the real autonomy safety gate. Every one of the
 * conditions below is independently checked and recorded — never
 * collapsed into a single opaque yes/no (§48: "If ANY condition fails: DO
 * NOT SUBMIT. Move to the correct review/block state."). This function is
 * called before EVERY autonomous submission attempt, never cached from a
 * previous check (§23: "Before every application independently validate
 * the policy.").
 */

export interface PolicyCondition {
  name: string;
  passed: boolean;
  detail: string;
}

export type AutomationMode = "DISCOVERY_ONLY" | "AI_PREPARE" | "APPLY_WITH_APPROVAL" | "AUTO_APPLY_APPROVED" | "FULL_AUTONOMOUS";

export interface PolicyGateInput {
  automationMode: AutomationMode;
  duplicateStatus: "NO_DUPLICATE" | "DUPLICATE_CONFIRMED" | "POSSIBLE_DUPLICATE" | "UNKNOWN";
  eligibilityStatus: "ELIGIBLE" | "LIKELY_ELIGIBLE" | "REVIEW_REQUIRED" | "LIKELY_NOT_ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";
  minEligibilityForAutoApply: "ELIGIBLE" | "LIKELY_ELIGIBLE" | "REVIEW_REQUIRED" | "LIKELY_NOT_ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";
  suspicionStatus: "NOT_SUSPICIOUS" | "SUSPICIOUS" | "REVIEW_REQUIRED" | "UNKNOWN";
  companyExcluded: boolean;
  hasSelectedResume: boolean;
  hasRequiredDocuments: boolean;
  validationResult: "READY" | "BLOCKED" | "REVIEW_REQUIRED" | null;
  // A real, authorized submission channel — EMAIL with a real extracted
  // address, or (not implemented in this build — see final report) a
  // configured API/browser integration. USER_ACTION_REQUIRED means none
  // exists, so automation cannot legally/technically proceed regardless
  // of mode.
  submissionChannelAvailable: boolean;
  dailyApplicationsUsed: number;
  maxApplicationsPerDay: number;
  weeklyApplicationsUsed: number;
  maxApplicationsPerWeek: number;
}

export type PolicyDecision = "SUBMIT_ALLOWED" | "USER_APPROVAL_REQUIRED" | "REVIEW_REQUIRED" | "PLATFORM_RESTRICTED" | "APPLICATION_LIMIT_REACHED";

export interface PolicyGateResult {
  decision: PolicyDecision;
  conditions: PolicyCondition[];
}

const ELIGIBILITY_RANK: Record<string, number> = {
  ELIGIBLE: 5,
  LIKELY_ELIGIBLE: 4,
  REVIEW_REQUIRED: 3,
  LIKELY_NOT_ELIGIBLE: 2,
  NOT_ELIGIBLE: 1,
  UNKNOWN: 0,
};

export function evaluateAutonomySafetyGate(input: PolicyGateInput): PolicyGateResult {
  const conditions: PolicyCondition[] = [
    { name: "Job is not a confirmed duplicate", passed: input.duplicateStatus !== "DUPLICATE_CONFIRMED", detail: input.duplicateStatus },
    { name: "Explicit requirements satisfied", passed: input.eligibilityStatus !== "NOT_ELIGIBLE" && input.eligibilityStatus !== "LIKELY_NOT_ELIGIBLE", detail: input.eligibilityStatus },
    { name: "Eligibility meets the user's minimum bar for auto-apply", passed: ELIGIBILITY_RANK[input.eligibilityStatus] >= ELIGIBILITY_RANK[input.minEligibilityForAutoApply], detail: `${input.eligibilityStatus} vs. required ${input.minEligibilityForAutoApply}` },
    { name: "Required resume exists", passed: input.hasSelectedResume, detail: input.hasSelectedResume ? "Resume selected." : "No resume selected." },
    { name: "Required documents exist", passed: input.hasRequiredDocuments, detail: input.hasRequiredDocuments ? "Required documents present." : "Missing required documents." },
    { name: "Company is not excluded", passed: !input.companyExcluded, detail: input.companyExcluded ? "Company is on the excluded-companies list." : "Not excluded." },
    { name: "Job is not suspicious", passed: input.suspicionStatus !== "SUSPICIOUS" && input.suspicionStatus !== "REVIEW_REQUIRED", detail: input.suspicionStatus },
    { name: "Validation passed", passed: input.validationResult === "READY", detail: `Validation result: ${input.validationResult ?? "not run"}` },
    { name: "Application limit not reached (daily)", passed: input.dailyApplicationsUsed < input.maxApplicationsPerDay, detail: `${input.dailyApplicationsUsed}/${input.maxApplicationsPerDay}` },
    { name: "Application limit not reached (weekly)", passed: input.weeklyApplicationsUsed < input.maxApplicationsPerWeek, detail: `${input.weeklyApplicationsUsed}/${input.maxApplicationsPerWeek}` },
    { name: "A real, authorized submission channel exists", passed: input.submissionChannelAvailable, detail: input.submissionChannelAvailable ? "Available." : "No API/browser integration or extractable application email — platform automation is not authorized." },
  ];

  const limitFailed = !conditions[8].passed || !conditions[9].passed;
  const platformFailed = !conditions[10].passed;
  const otherFailed = conditions.some((c, i) => !c.passed && i !== 8 && i !== 9 && i !== 10);

  // §19-23 — the automation mode itself gates whether ANY of this even
  // matters: DISCOVERY_ONLY/AI_PREPARE never reach a submit decision here.
  if (input.automationMode === "DISCOVERY_ONLY" || input.automationMode === "AI_PREPARE") {
    return { decision: "USER_APPROVAL_REQUIRED", conditions };
  }

  if (limitFailed) return { decision: "APPLICATION_LIMIT_REACHED", conditions };
  if (platformFailed) return { decision: "PLATFORM_RESTRICTED", conditions };
  // §22: "If any condition fails: DO NOT SUBMIT. Move to the correct
  // review/block state." An application reaching this gate has already
  // passed prepare-time validation (BLOCKED applications never leave
  // PREPARING — see application-actions.ts) — a condition failing HERE
  // means something changed since prepare time (e.g. a concurrent
  // duplicate, a newly-excluded company). That is always surfaced for a
  // real human decision, never silently re-blocked with no path forward.
  if (otherFailed) return { decision: "USER_APPROVAL_REQUIRED", conditions };

  if (input.automationMode === "APPLY_WITH_APPROVAL") return { decision: "USER_APPROVAL_REQUIRED", conditions };

  // AUTO_APPLY_APPROVED / FULL_AUTONOMOUS — all 11 conditions passed.
  return { decision: "SUBMIT_ALLOWED", conditions };
}
