/**
 * Phase 20 (Autonomous AI Job Application Agent) — §6/§7 the real
 * application-level eligibility gate. Deliberately distinct from Phase 19's
 * JobMatch.eligibility (CareerJobEligibility): that one judges whether the
 * candidate's PROFILE matches the job's stated requirements; this one
 * additionally judges whether the APPLICATION has everything it genuinely
 * needs to be submitted — required documents present, sensitive answers
 * not silently defaulted, etc. Never upgrades a job-match gap into a false
 * "eligible".
 *
 * §7 — required vs. preferred: a job's `requirements.preferred` gap NEVER
 * produces LIKELY_NOT_ELIGIBLE/NOT_ELIGIBLE on its own — only an item in
 * `requirements.required` that's genuinely unmet can.
 */

import type { JobMatchResult } from "./job-matching";

export type ApplicationEligibilityStatus = "ELIGIBLE" | "LIKELY_ELIGIBLE" | "REVIEW_REQUIRED" | "LIKELY_NOT_ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";

export interface EligibilityCheck {
  requirement: string;
  status: "SATISFIED" | "UNSATISFIED" | "UNKNOWN";
  evidence: string;
}

export interface ApplicationEligibilityInput {
  matchResult: JobMatchResult;
  // Structured, source-extracted (Job.requirements) — never AI-invented
  // beyond what the source text actually states (§7, §13).
  jobRequirements: { required: string[]; preferred: string[] } | null;
  verifiedSkills: string[];
  hasResume: boolean;
  hasVerifiedWorkAuthorization: boolean | null; // null = not asked/unknown, never assumed
}

export interface ApplicationEligibilityResult {
  status: ApplicationEligibilityStatus;
  checks: EligibilityCheck[];
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function computeApplicationEligibility(input: ApplicationEligibilityInput): ApplicationEligibilityResult {
  const checks: EligibilityCheck[] = [];

  // §6 — required document existence is a hard, real check, never assumed.
  checks.push({
    requirement: "Resume on file",
    status: input.hasResume ? "SATISFIED" : "UNSATISFIED",
    evidence: input.hasResume ? "A processed CareerResume exists for this profile." : "No resume has been uploaded/processed for this profile.",
  });

  // §7 — only requirements.required items are hard gates; preferred items
  // never fail eligibility on their own (folded into the job-match
  // "whatShouldBeCustomized" signal instead, not here).
  const verified = new Set(input.verifiedSkills.map(normalize));
  const requiredItems = input.jobRequirements?.required ?? [];
  for (const req of requiredItems) {
    const satisfied = verified.has(normalize(req));
    checks.push({
      requirement: `Required: ${req}`,
      status: satisfied ? "SATISFIED" : "UNSATISFIED",
      evidence: satisfied ? `"${req}" is in your verified skills.` : `"${req}" is explicitly required by the job but not found in your verified skills.`,
    });
  }
  if (requiredItems.length === 0) {
    checks.push({ requirement: "Explicit required items", status: "UNKNOWN", evidence: "Job source did not state a structured required-items list." });
  }

  // §6/§13 — work authorization is a real hard gate ONLY when the job's own
  // dimensions flagged it as relevant; never inferred, never guessed.
  if (input.hasVerifiedWorkAuthorization === null) {
    checks.push({ requirement: "Work authorization", status: "UNKNOWN", evidence: "No verified work-authorization data on file — never assumed." });
  } else {
    checks.push({
      requirement: "Work authorization",
      status: input.hasVerifiedWorkAuthorization ? "SATISFIED" : "UNSATISFIED",
      evidence: input.hasVerifiedWorkAuthorization ? "User-verified work authorization on file." : "User-verified work authorization explicitly marked as NOT satisfied.",
    });
  }

  // Fold in the real Phase 19 job-match dimensions the spec explicitly
  // calls out (§6): experience, skills, location — never recomputed here,
  // only read from the already-deterministic JobMatch.
  const dims = input.matchResult.dimensions;
  if (dims.skill.status === "MISSING" || dims.location.status === "MISMATCH" || dims.technology.status === "CONFLICT" || dims.preference.status === "MISMATCH") {
    checks.push({ requirement: "Job-match hard gate", status: "UNSATISFIED", evidence: "One or more job-match dimensions (skill/location/technology/preference) is a hard MISSING/MISMATCH/CONFLICT." });
  }

  const unsatisfied = checks.filter((c) => c.status === "UNSATISFIED");
  const unknown = checks.filter((c) => c.status === "UNKNOWN");

  let status: ApplicationEligibilityStatus;
  if (unsatisfied.length > 0) {
    // A missing REQUIRED item, missing resume, or explicit work-auth
    // failure is never soft — real, hard blockers.
    status = unsatisfied.some((c) => c.requirement === "Resume on file" || c.requirement.startsWith("Required:") || c.requirement === "Work authorization")
      ? "NOT_ELIGIBLE"
      : "LIKELY_NOT_ELIGIBLE";
  } else if (unknown.length > 0) {
    status = "REVIEW_REQUIRED";
  } else if (input.matchResult.eligibility === "LIKELY_ELIGIBLE") {
    status = "ELIGIBLE";
  } else {
    status = "LIKELY_ELIGIBLE";
  }

  return { status, checks };
}
