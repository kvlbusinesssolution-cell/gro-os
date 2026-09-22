import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { getCareerOutcomeFunnel, getResumePerformance } from "./outcome-analytics";

/**
 * Real Postgres integration tests (§61) — every row created here is real,
 * explicitly marked TEST DATA via a unique suffix, and cleaned up in
 * afterAll. Covers: real outcome counting (§3/§4), tenant isolation (§54),
 * and the §62 small-sample CV-version test against genuinely persisted
 * JobApplication rows (not just the pure buildRateObservation unit tests
 * in outcome-analytics.test.ts).
 */
describe("outcome-analytics — real DB integration", () => {
  const suffix = Date.now();
  let orgId: string;
  let otherOrgId: string;
  let userId: string;
  let careerProfileId: string;
  let resumeAId: string;
  let resumeBId: string;
  let jobIds: string[] = [];

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Outcome Analytics Test Org", slug: `outcome-analytics-${suffix}` } });
    orgId = org.id;
    const otherOrg = await prisma.organization.create({ data: { name: "Outcome Analytics Other Org", slug: `outcome-analytics-other-${suffix}` } });
    otherOrgId = otherOrg.id;

    const user = await prisma.user.create({ data: { name: "Outcome Test User", email: `outcome-user-${suffix}@example.com` } });
    userId = user.id;

    const profile = await prisma.careerProfile.create({ data: { userId, organizationId: orgId, name: "Outcome Test Profile" } });
    careerProfileId = profile.id;

    const resumeA = await prisma.careerResume.create({
      data: { careerProfileId, version: 1, originalFilename: "a.pdf", mimeType: "application/pdf", sizeBytes: 100, checksum: `chk-a-${suffix}`, storageKey: `key-a-${suffix}` },
    });
    resumeAId = resumeA.id;
    const resumeB = await prisma.careerResume.create({
      data: { careerProfileId, version: 2, originalFilename: "b.pdf", mimeType: "application/pdf", sizeBytes: 100, checksum: `chk-b-${suffix}`, storageKey: `key-b-${suffix}` },
    });
    resumeBId = resumeB.id;

    // §62 — Resume A: 2 applications, 1 interview. Resume B: 5 applications, 2 interviews (kept small for test speed; classification math is unit-tested separately).
    const jobs = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        prisma.job.create({
          data: {
            title: `Test Role ${suffix}-${i}`,
            sourceTitle: `Test Role ${suffix}-${i}`,
            company: `Test Co ${suffix}-${i}`,
            description: "Real test job description.",
          },
        }),
      ),
    );
    jobIds = jobs.map((j) => j.id);

    const appsA = jobs.slice(0, 2);
    const appsB = jobs.slice(2, 7);

    for (const [i, job] of appsA.entries()) {
      await prisma.jobApplication.create({
        data: {
          organizationId: orgId,
          userId,
          careerProfileId,
          jobId: job.id,
          selectedResumeId: resumeAId,
          automationModeAtCreation: "AI_PREPARE",
          status: i === 0 ? "INTERVIEW" : "SUBMITTED",
        },
      });
    }
    for (const [i, job] of appsB.entries()) {
      await prisma.jobApplication.create({
        data: {
          organizationId: orgId,
          userId,
          careerProfileId,
          jobId: job.id,
          selectedResumeId: resumeBId,
          automationModeAtCreation: "AI_PREPARE",
          status: i < 2 ? "INTERVIEW" : "SUBMITTED",
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.jobApplication.deleteMany({ where: { careerProfileId } });
    await prisma.careerResume.deleteMany({ where: { careerProfileId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  });

  it("§3/§4 — real ACTUAL outcome funnel counts, never fabricated", async () => {
    const funnel = await getCareerOutcomeFunnel(orgId, careerProfileId);
    expect(funnel.kind).toBe("ACTUAL");
    expect(funnel.applications).toBe(7);
    expect(funnel.interviews).toBe(3); // 1 from A + 2 from B
    expect(funnel.acceptedJobs).toBe(0); // never inferred from an offer — §40
  });

  it("§54 tenant isolation — a different organization sees zero applications for this profile", async () => {
    const funnel = await getCareerOutcomeFunnel(otherOrgId, careerProfileId);
    expect(funnel.applications).toBe(0);
  });

  it("§62 small sample test — Resume A (2 apps) is INSUFFICIENT_DATA even though its raw interview rate (50%) looks higher than Resume B's", async () => {
    const perf = await getResumePerformance(orgId, careerProfileId);
    const a = perf.versions.find((v) => v.resumeId === resumeAId)!;
    const b = perf.versions.find((v) => v.resumeId === resumeBId)!;

    expect(a.applications).toBe(2);
    expect(a.interviewRate.sampleClassification).toBe("INSUFFICIENT_DATA");
    expect(a.interviewRate.rate).toBeCloseTo(0.5);

    expect(b.applications).toBe(5);
    expect(b.interviewRate.rate).toBeCloseTo(0.4);

    // The controls note must always accompany the comparison — never a bare "X is better".
    expect(perf.controlsNote.toLowerCase()).toContain("never a proven cause");
  });
});
