import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { predictApplicationResponseLikelihood, predictInterviewLikelihood, predictOfferLikelihood, predictMatchResponseLikelihood } from "./career-predictions";

/**
 * Real Postgres integration tests (same fixture convention as
 * outcome-analytics-db.test.ts) — every row created here is real, cleaned
 * up in afterAll.
 */
describe("career-predictions — real DB integration", () => {
  const suffix = Date.now();
  let orgId: string;
  let userId: string;
  let careerProfileId: string;
  let jobIds: string[] = [];
  let jobMatchId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Career Predictions Test Org", slug: `career-predictions-${suffix}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { name: "Career Predictions Test User", email: `career-predictions-user-${suffix}@example.com` } });
    userId = user.id;
    const profile = await prisma.careerProfile.create({ data: { userId, organizationId: orgId, name: "Career Predictions Test Profile" } });
    careerProfileId = profile.id;

    // 10 real applications to "Senior React Developer": 3 responded (INTERVIEW/OFFER/REJECTED), 2 of those interviewed, 1 offered.
    const jobs = await Promise.all(
      Array.from({ length: 10 }, (_, i) => prisma.job.create({ data: { title: `Senior React Developer`, sourceTitle: `Senior React Developer`, company: `Test Co ${suffix}-${i}`, description: "Real test job." } })),
    );
    jobIds = jobs.map((j) => j.id);
    const statuses = ["OFFER", "INTERVIEW", "REJECTED", "SUBMITTED", "SUBMITTED", "SUBMITTED", "SUBMITTED", "SUBMITTED", "SUBMITTED", "SUBMITTED"] as const;
    await Promise.all(
      jobs.map((job, i) => prisma.jobApplication.create({ data: { organizationId: orgId, userId, careerProfileId, jobId: job.id, automationModeAtCreation: "AI_PREPARE", status: statuses[i]! } })),
    );

    // A real JobMatch for a NEW, not-yet-applied job in the same role, to test match-to-response.
    const matchJob = await prisma.job.create({ data: { title: "Senior React Developer", sourceTitle: "Senior React Developer", company: `New Co ${suffix}`, description: "Real test job." } });
    jobIds.push(matchJob.id);
    const match = await prisma.jobMatch.create({ data: { careerProfileId, jobId: matchJob.id, organizationId: orgId, overallScore: 82, dimensions: {} } });
    jobMatchId = match.id;
  });

  afterAll(async () => {
    await prisma.jobMatch.deleteMany({ where: { careerProfileId } });
    await prisma.jobApplication.deleteMany({ where: { careerProfileId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("predicts a real application-response likelihood from real historical role-matched applications", async () => {
    const result = await predictApplicationResponseLikelihood(orgId, careerProfileId, "Senior React Developer");
    expect(result.kind).toBe("PREDICTION");
    expect(result.sampleSize).toBe(10);
    expect(result.numerator).toBe(3); // OFFER + INTERVIEW + REJECTED all count as "responded"
    expect(result.likelihood).toBeCloseTo(0.3, 5);
  });

  it("predicts a real interview likelihood, distinct from response likelihood", async () => {
    const result = await predictInterviewLikelihood(orgId, careerProfileId, "Senior React Developer");
    expect(result.numerator).toBe(2); // OFFER + INTERVIEW
    expect(result.likelihood).toBeCloseTo(0.2, 5);
  });

  it("predicts a real offer likelihood, the narrowest of the three", async () => {
    const result = await predictOfferLikelihood(orgId, careerProfileId, "Senior React Developer");
    expect(result.numerator).toBe(1);
    expect(result.likelihood).toBeCloseTo(0.1, 5);
  });

  it("falls back to the profile's overall rate (never a fabricated role-specific number) when no prior application exists for that exact role", async () => {
    const result = await predictApplicationResponseLikelihood(orgId, careerProfileId, "Totally Different Role Title");
    expect(result.sampleSize).toBe(10); // the overall pool, not zero
    expect(result.statement).toContain("no prior application");
  });

  it("blends a real match's Phase-19 fit score with the real historical role rate for match-to-response likelihood", async () => {
    const result = await predictMatchResponseLikelihood(orgId, jobMatchId);
    expect(result.fitScore).toBe(82);
    expect(result.numerator).toBe(3);
    expect(result.likelihood).toBeCloseTo(0.3, 5);
  });

  it("returns INSUFFICIENT_DATA (never a fabricated likelihood) for a profile with zero applications", async () => {
    const freshProfile = await prisma.careerProfile.create({ data: { userId, organizationId: orgId, name: "Fresh Profile" } });
    try {
      const result = await predictApplicationResponseLikelihood(orgId, freshProfile.id, "Any Role");
      expect(result.sampleSize).toBe(0);
      expect(result.likelihood).toBeNull();
      expect(result.insufficientData).toBe(true);
    } finally {
      await prisma.careerProfile.delete({ where: { id: freshProfile.id } });
    }
  });
});
