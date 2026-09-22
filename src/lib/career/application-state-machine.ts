/**
 * Phase 20 — §49 the real, deterministic application state machine. Every
 * status transition anywhere in this codebase MUST go through
 * `assertValidTransition` — never a raw `prisma.jobApplication.update({
 * data: { status } })` with a client-supplied value (§3: "Do not allow
 * arbitrary status changes from the client").
 */

import type { ApplicationStatus } from "@/generated/prisma/client";

const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  DISCOVERED: ["MATCHED", "CLOSED"],
  MATCHED: ["SHORTLISTED", "CLOSED"],
  SHORTLISTED: ["PREPARING", "CLOSED", "WITHDRAWN"],
  PREPARING: ["READY_FOR_REVIEW", "FAILED", "WITHDRAWN"],
  READY_FOR_REVIEW: ["USER_APPROVAL_REQUIRED", "PLATFORM_RESTRICTED", "SUBMITTING", "WITHDRAWN"],
  USER_APPROVAL_REQUIRED: ["SUBMITTING", "PLATFORM_RESTRICTED", "WITHDRAWN", "REJECTED"],
  PLATFORM_RESTRICTED: ["USER_APPROVAL_REQUIRED", "SUBMITTING", "WITHDRAWN", "CLOSED"],
  SUBMITTING: ["SUBMITTED", "SUBMITTED_UNCONFIRMED", "FAILED", "FAILED_REQUIRES_REVIEW"],
  SUBMITTED: ["CONFIRMED", "SUBMITTED_UNCONFIRMED", "REJECTED", "WITHDRAWN"],
  SUBMITTED_UNCONFIRMED: ["CONFIRMED", "FAILED_REQUIRES_REVIEW", "SUBMITTED"],
  FAILED_REQUIRES_REVIEW: ["SUBMITTING", "FAILED", "WITHDRAWN"],
  CONFIRMED: ["INTERVIEW", "REJECTED", "WITHDRAWN", "CLOSED"],
  FAILED: ["PREPARING", "CLOSED"],
  REJECTED: ["CLOSED"],
  WITHDRAWN: ["CLOSED"],
  INTERVIEW: ["OFFER", "REJECTED", "CLOSED"],
  OFFER: ["CLOSED", "REJECTED"],
  CLOSED: [],
};

export function isValidTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid application status transition: ${from} -> ${to}`);
  }
}
