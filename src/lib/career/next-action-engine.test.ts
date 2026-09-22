import { describe, expect, it } from "vitest";

import { determineNextAction } from "./next-action-engine";

function input(overrides: Partial<Parameters<typeof determineNextAction>[0]> = {}) {
  return { classification: "GENERAL_RESPONSE" as const, confidence: "HIGH" as const, matchStatus: "MATCHED" as const, isSensitive: false, ...overrides };
}

describe("determineNextAction — §39 real, deterministic mapping", () => {
  it("maps INTERVIEW_REQUEST to CHECK_CALENDAR", () => {
    expect(determineNextAction(input({ classification: "INTERVIEW_REQUEST" }))).toBe("CHECK_CALENDAR");
  });

  it("maps OFFER to REVIEW_OFFER", () => {
    expect(determineNextAction(input({ classification: "OFFER" }))).toBe("REVIEW_OFFER");
  });

  it("maps REJECTED to REVIEW_REJECTION", () => {
    expect(determineNextAction(input({ classification: "REJECTED" }))).toBe("REVIEW_REJECTION");
  });

  it("maps DOCUMENT_REQUEST to UPLOAD_DOCUMENT", () => {
    expect(determineNextAction(input({ classification: "DOCUMENT_REQUEST" }))).toBe("UPLOAD_DOCUMENT");
  });

  it("§13/§46 — a sensitive question ALWAYS routes to USER_APPROVAL_REQUIRED, even for a high-confidence, matched INTERVIEW_REQUEST", () => {
    expect(determineNextAction(input({ classification: "INTERVIEW_REQUEST", isSensitive: true }))).toBe("USER_APPROVAL_REQUIRED");
  });

  it("§7 — LOW confidence never auto-triggers a downstream action, regardless of classification", () => {
    expect(determineNextAction(input({ classification: "OFFER", confidence: "LOW" }))).toBe("USER_APPROVAL_REQUIRED");
  });

  it("§7 — UNKNOWN confidence never auto-triggers a downstream action", () => {
    expect(determineNextAction(input({ classification: "INTERVIEW_REQUEST", confidence: "UNKNOWN" }))).toBe("USER_APPROVAL_REQUIRED");
  });

  it("§4 — AMBIGUOUS match status always requires review, regardless of classification/confidence", () => {
    expect(determineNextAction(input({ classification: "OFFER", matchStatus: "AMBIGUOUS" }))).toBe("USER_APPROVAL_REQUIRED");
  });

  it("§4 — UNMATCHED status always requires review", () => {
    expect(determineNextAction(input({ matchStatus: "UNMATCHED" }))).toBe("USER_APPROVAL_REQUIRED");
  });

  it("maps UNKNOWN classification to UNKNOWN next action", () => {
    expect(determineNextAction(input({ classification: "UNKNOWN" }))).toBe("UNKNOWN");
  });

  it("maps GENERAL_RESPONSE to NO_ACTION", () => {
    expect(determineNextAction(input({ classification: "GENERAL_RESPONSE" }))).toBe("NO_ACTION");
  });
});
