import type { ClassificationConfidence, RecruiterMessageClassification } from "./recruiter-message-classification";
import type { MatchStatus } from "./recruiter-message-matching";

/**
 * Phase 21 (§39) — deterministic mapping from a real classification +
 * match status + sensitivity flag to a next action. No AI call: the next
 * action is a pure function of evidence already established elsewhere,
 * never independently guessed.
 */

export type NextAction =
  | "NO_ACTION"
  | "CHECK_CALENDAR"
  | "USER_APPROVAL_REQUIRED"
  | "REPLY_REQUIRED"
  | "PROVIDE_INFORMATION"
  | "UPLOAD_DOCUMENT"
  | "SCHEDULE_INTERVIEW"
  | "REQUEST_ALTERNATIVE"
  | "FOLLOW_UP"
  | "REVIEW_OFFER"
  | "REVIEW_REJECTION"
  | "UNKNOWN";

export interface NextActionInput {
  classification: RecruiterMessageClassification;
  confidence: ClassificationConfidence;
  matchStatus: MatchStatus;
  isSensitive: boolean;
}

export function determineNextAction(input: NextActionInput): NextAction {
  // §4 — an unresolved application link always needs a human first, no
  // matter what the classification says.
  if (input.matchStatus === "AMBIGUOUS" || input.matchStatus === "UNMATCHED") return "USER_APPROVAL_REQUIRED";

  // §7/§13/§46 — LOW/UNKNOWN confidence and sensitive questions never
  // auto-trigger a downstream action, regardless of classification.
  if (input.isSensitive) return "USER_APPROVAL_REQUIRED";
  if (input.confidence === "LOW" || input.confidence === "UNKNOWN") return "USER_APPROVAL_REQUIRED";

  switch (input.classification) {
    case "INTERVIEW_REQUEST":
      return "CHECK_CALENDAR";
    case "AVAILABILITY_REQUEST":
      return "CHECK_CALENDAR";
    case "SCREENING":
      return "REPLY_REQUIRED";
    case "MORE_INFORMATION":
      return "PROVIDE_INFORMATION";
    case "DOCUMENT_REQUEST":
      return "UPLOAD_DOCUMENT";
    case "SALARY_DISCUSSION":
      return "REPLY_REQUIRED";
    case "OFFER":
      return "REVIEW_OFFER";
    case "REJECTED":
      return "REVIEW_REJECTION";
    case "FOLLOW_UP":
      return "FOLLOW_UP";
    case "GENERAL_RESPONSE":
      return "NO_ACTION";
    case "UNKNOWN":
    default:
      return "UNKNOWN";
  }
}
