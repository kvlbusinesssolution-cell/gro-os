import { describe, expect, it } from "vitest";

import { detectSuspiciousJob, type SuspiciousJobInput } from "./suspicious-job-detection";

function baseInput(overrides: Partial<SuspiciousJobInput> = {}): SuspiciousJobInput {
  return {
    description: "We are hiring a Senior React Developer to join our remote engineering team.",
    company: "Acme Corp",
    companyDomain: "acme.com",
    canonicalUrl: "https://remotive.com/remote-jobs/123",
    ...overrides,
  };
}

describe("detectSuspiciousJob — §26 real, evidence-based screening", () => {
  it("returns NOT_SUSPICIOUS for a normal, clean posting", () => {
    const result = detectSuspiciousJob(baseInput());
    expect(result.status).toBe("NOT_SUSPICIOUS");
    expect(result.evidence).toHaveLength(0);
  });

  it("flags SUSPICIOUS on an explicit registration-fee request — a real, hard signal", () => {
    const result = detectSuspiciousJob(baseInput({ description: "To proceed, please pay a $50 registration fee before your first day." }));
    expect(result.status).toBe("SUSPICIOUS");
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("flags SUSPICIOUS when asked to wire money", () => {
    const result = detectSuspiciousJob(baseInput({ description: "Please send your first month's training fee via wire transfer." }));
    expect(result.status).toBe("SUSPICIOUS");
  });

  it("flags SUSPICIOUS when the posting directly asks for bank/SSN details", () => {
    const result = detectSuspiciousJob(baseInput({ description: "Please send us your bank account details to set up payroll before we begin." }));
    expect(result.status).toBe("SUSPICIOUS");
  });

  it("never accuses on a single, weak soft signal alone — UNKNOWN, not SUSPICIOUS", () => {
    const result = detectSuspiciousJob(baseInput({ description: "Join our team on Telegram for onboarding details after hire." }));
    expect(result.status).toBe("UNKNOWN");
  });

  it("escalates to REVIEW_REQUIRED only when TWO real soft signals combine", () => {
    const result = detectSuspiciousJob(
      baseInput({ description: "Join our team on Telegram. Urgent hiring, start immediately, no interview needed.", companyDomain: null, canonicalUrl: null }),
    );
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("missing company identity alone is only a weak (UNKNOWN) signal, not an accusation", () => {
    const result = detectSuspiciousJob(baseInput({ companyDomain: null, canonicalUrl: null }));
    expect(result.status).toBe("UNKNOWN");
  });
});
