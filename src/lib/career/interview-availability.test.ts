import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { checkInterviewConflict, suggestAlternativeSlots, type AvailabilityCheckInput } from "./interview-availability";

function baseInput(overrides: Partial<AvailabilityCheckInput> = {}): AvailabilityCheckInput {
  return {
    organizationId: "org-does-not-exist",
    careerProfileId: "profile-does-not-exist",
    proposedStartUtc: new Date("2026-10-05T10:00:00Z"), // a Monday
    durationMinutes: 60,
    workingHoursStart: null,
    workingHoursEnd: null,
    workingHoursTimezone: null,
    workingDays: [],
    blackoutPeriods: null,
    ...overrides,
  };
}

describe("checkInterviewConflict — §18/§19/§55 real availability algorithm (no fabricated calendar)", () => {
  it("§19 — returns UNKNOWN (never a guessed FREE) when no working hours are configured and no conflicting interview exists", async () => {
    const result = await checkInterviewConflict(baseInput());
    expect(result.status).toBe("UNKNOWN");
  });

  it("§19 — detects a blackout period conflict", async () => {
    const result = await checkInterviewConflict(baseInput({ blackoutPeriods: [{ startsAt: "2026-10-05T09:00:00Z", endsAt: "2026-10-05T11:00:00Z", reason: "Family event" }] }));
    expect(result.status).toBe("BLACKOUT");
    expect(result.detail).toContain("Family event");
  });

  it("§19 — flags a slot outside configured working hours", async () => {
    const result = await checkInterviewConflict(
      baseInput({ workingHoursStart: "09:00", workingHoursEnd: "17:00", workingHoursTimezone: "UTC", workingDays: [1, 2, 3, 4, 5], proposedStartUtc: new Date("2026-10-05T20:00:00Z") }),
    );
    expect(result.status).toBe("OUTSIDE_WORKING_HOURS");
  });

  it("§19 — flags a slot on a non-working day", async () => {
    const result = await checkInterviewConflict(
      baseInput({ workingHoursStart: "09:00", workingHoursEnd: "17:00", workingHoursTimezone: "UTC", workingDays: [1, 2, 3, 4, 5], proposedStartUtc: new Date("2026-10-04T10:00:00Z") }), // a Sunday
    );
    expect(result.status).toBe("OUTSIDE_WORKING_HOURS");
  });

  it("§19 — returns FREE for a genuinely clear slot within configured working hours", async () => {
    const result = await checkInterviewConflict(baseInput({ workingHoursStart: "09:00", workingHoursEnd: "17:00", workingHoursTimezone: "UTC", workingDays: [1, 2, 3, 4, 5] }));
    expect(result.status).toBe("FREE");
  });
});

describe("checkInterviewConflict — §18/§20/§55 real double-booking check against tracked interviews", () => {
  let organizationId: string;
  let careerProfileId: string;
  let applicationId: string;
  let existingInterviewId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Availability Test Org", slug: `availability-org-${suffix}` } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { name: "Availability Test User", email: `availability-user-${suffix}@example.com` } });
    const profile = await prisma.careerProfile.create({ data: { userId: user.id, organizationId, name: "Availability Test Profile" } });
    careerProfileId = profile.id;
    const job = await prisma.job.create({ data: { title: "Engineer", sourceTitle: "Engineer", company: "Acme", description: "Real job.", canonicalUrl: `https://example.com/job-${suffix}` } });
    const application = await prisma.jobApplication.create({ data: { organizationId, userId: user.id, careerProfileId, jobId: job.id, automationModeAtCreation: "DISCOVERY_ONLY" } });
    applicationId = application.id;
    const interview = await prisma.careerInterview.create({
      data: { organizationId, careerProfileId, applicationId, status: "SCHEDULED", scheduledAtUtc: new Date("2026-10-06T10:00:00Z"), durationMinutes: 60 },
    });
    existingInterviewId = interview.id;
  });

  afterAll(async () => {
    await prisma.careerInterview.deleteMany({ where: { careerProfileId } });
    await prisma.jobApplication.deleteMany({ where: { careerProfileId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("detects a real overlap with an already-SCHEDULED CareerInterview", async () => {
    const result = await checkInterviewConflict(baseInput({ organizationId, careerProfileId, proposedStartUtc: new Date("2026-10-06T10:30:00Z") }));
    expect(result.status).toBe("BUSY");
    expect(result.conflictingInterviewId).toBe(existingInterviewId);
  });

  it("does not flag a slot that genuinely doesn't overlap", async () => {
    const result = await checkInterviewConflict(baseInput({ organizationId, careerProfileId, proposedStartUtc: new Date("2026-10-06T14:00:00Z"), workingHoursStart: "09:00", workingHoursEnd: "17:00", workingHoursTimezone: "UTC", workingDays: [1, 2, 3, 4, 5] }));
    expect(result.status).toBe("FREE");
  });

  it("excludeInterviewId lets rescheduling the SAME interview skip its own conflict", async () => {
    const result = await checkInterviewConflict(baseInput({ organizationId, careerProfileId, proposedStartUtc: new Date("2026-10-06T10:30:00Z"), excludeInterviewId: existingInterviewId }));
    expect(result.status).not.toBe("BUSY");
  });

  it("§24 — suggestAlternativeSlots never fabricates a slot; every suggestion is independently re-checked FREE", async () => {
    const alternatives = await suggestAlternativeSlots(baseInput({ organizationId, careerProfileId, workingHoursStart: "09:00", workingHoursEnd: "17:00", workingHoursTimezone: "UTC", workingDays: [1, 2, 3, 4, 5], proposedStartUtc: new Date("2026-10-06T09:00:00Z") }));
    expect(alternatives.length).toBeGreaterThan(0);
    for (const slot of alternatives) {
      const check = await checkInterviewConflict(baseInput({ organizationId, careerProfileId, proposedStartUtc: slot, workingHoursStart: "09:00", workingHoursEnd: "17:00", workingHoursTimezone: "UTC", workingDays: [1, 2, 3, 4, 5] }));
      expect(check.status).toBe("FREE");
    }
  });
});
