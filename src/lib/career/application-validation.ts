/**
 * Phase 20 — §14 the real, aggregate validation engine. Runs AFTER
 * eligibility/duplicate/resume-selection/customization/cover-letter/
 * answers/suspicion have each already been computed — this module never
 * recomputes them, only checks their real, already-recorded results.
 * An application may not enter SUBMITTING until this returns READY.
 */

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ValidationEngineInput {
  duplicateStatus: "NO_DUPLICATE" | "DUPLICATE_CONFIRMED" | "POSSIBLE_DUPLICATE" | "UNKNOWN";
  eligibilityStatus: "ELIGIBLE" | "LIKELY_ELIGIBLE" | "REVIEW_REQUIRED" | "LIKELY_NOT_ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";
  suspicionStatus: "NOT_SUSPICIOUS" | "SUSPICIOUS" | "REVIEW_REQUIRED" | "UNKNOWN";
  selectedResumeId: string | null;
  hasCustomizedResume: boolean;
  customizedResumeBlocked: boolean; // true if fabrication check blocked it (§10)
  hasCoverLetter: boolean;
  unresolvedSensitiveAnswers: number; // count of ApplicationAnswer rows with isSensitive && status !== VERIFIED
  reviewRequiredAnswers: number;
}

export type ValidationResult = "READY" | "BLOCKED" | "REVIEW_REQUIRED";

export interface ValidationEngineResult {
  result: ValidationResult;
  checks: ValidationCheck[];
}

export function runValidationEngine(input: ValidationEngineInput): ValidationEngineResult {
  const checks: ValidationCheck[] = [];

  checks.push({ name: "Not a duplicate application", passed: input.duplicateStatus !== "DUPLICATE_CONFIRMED", detail: `Duplicate status: ${input.duplicateStatus}` });
  checks.push({ name: "Not confirmed suspicious", passed: input.suspicionStatus !== "SUSPICIOUS", detail: `Suspicion status: ${input.suspicionStatus}` });
  checks.push({ name: "Eligibility not disqualifying", passed: input.eligibilityStatus !== "NOT_ELIGIBLE", detail: `Eligibility status: ${input.eligibilityStatus}` });
  checks.push({ name: "Resume selected", passed: input.selectedResumeId !== null, detail: input.selectedResumeId ? "A resume version is selected." : "No resume selected." });
  checks.push({
    name: "Customized resume not blocked",
    passed: !input.customizedResumeBlocked,
    detail: input.customizedResumeBlocked ? "Fabrication check blocked the customized resume — a corrected version is required." : "No unsupported claims detected (or resume was not customized).",
  });
  checks.push({ name: "No unresolved sensitive questions", passed: input.unresolvedSensitiveAnswers === 0, detail: `${input.unresolvedSensitiveAnswers} sensitive question(s) awaiting user input.` });

  const hardFailures = checks.filter((c) => !c.passed);
  if (hardFailures.length > 0) {
    return { result: "BLOCKED", checks };
  }

  const softReview = input.duplicateStatus === "POSSIBLE_DUPLICATE" || input.duplicateStatus === "UNKNOWN"
    || input.eligibilityStatus === "REVIEW_REQUIRED" || input.eligibilityStatus === "UNKNOWN"
    || input.suspicionStatus === "REVIEW_REQUIRED" || input.suspicionStatus === "UNKNOWN"
    || input.reviewRequiredAnswers > 0
    || !input.hasCoverLetter;

  checks.push({ name: "No open review items", passed: !softReview, detail: softReview ? "One or more soft signals require human review before submission." : "No open review items." });

  return { result: softReview ? "REVIEW_REQUIRED" : "READY", checks };
}
