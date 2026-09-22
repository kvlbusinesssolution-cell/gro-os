import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { generateCvVersionRecommendation, proposeCareerRecommendation } from "./career-recommendations";
import { LEARNING_CONFIG } from "@/lib/learning/config";

/**
 * §18/§48/§62 — the CV-version recommendation engine must never propose a
 * change from small samples, and every proposal must land as PROPOSED,
 * requiring real human approval (never auto-applied).
 */
describe("career-recommendations — real DB, §48 learning safety", () => {
  const suffix = Date.now();
  let orgId: string;
  let userId: string;
  let careerProfileId: string;
  const jobIds: string[] = [];

  const MIN = LEARNING_CONFIG.MIN_SAMPLE_FOR_RECOMMENDATION;

  async function seedApplications(resumeId: string, count: number, interviewCount: number) {
    for (let i = 0; i < count; i++) {
      const job = await prisma.job.create({
        data: { title: `Rec Test Job ${suffix}-${resumeId}-${i}`, sourceTitle: `Rec Test Job ${suffix}-${resumeId}-${i}`, company: `RecCo-${i}`, description: "d" },
      });
      jobIds.push(job.id);
      await prisma.jobApplication.create({
        data: {
          organizationId: orgId,
          userId,
          careerProfileId,
          jobId: job.id,
          selectedResumeId: resumeId,
          automationModeAtCreation: "AI_PREPARE",
          status: i < interviewCount ? "INTERVIEW" : "SUBMITTED",
        },
      });
    }
  }

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Career Rec Test Org", slug: `career-rec-${suffix}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { name: "Career Rec User", email: `career-rec-${suffix}@example.com` } });
    userId = user.id;
    const profile = await prisma.careerProfile.create({ data: { userId, organizationId: orgId, name: "Career Rec Profile" } });
    careerProfileId = profile.id;
  });

  afterAll(async () => {
    await prisma.learningRecommendation.deleteMany({ where: { careerProfileId } });
    await prisma.jobApplication.deleteMany({ where: { careerProfileId } });
    await prisma.careerResume.deleteMany({ where: { careerProfileId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it("§62 never proposes a recommendation when one version's sample is below MIN_SAMPLE_FOR_RECOMMENDATION, even if its raw rate looks better", async () => {
    const resumeSmall = await prisma.careerResume.create({
      data: { careerProfileId, version: 1, originalFilename: "small.pdf", mimeType: "application/pdf", sizeBytes: 10, checksum: `small-${suffix}`, storageKey: `small-${suffix}` },
    });
    const resumeLarge = await prisma.careerResume.create({
      data: { careerProfileId, version: 2, originalFilename: "large.pdf", mimeType: "application/pdf", sizeBytes: 10, checksum: `large-${suffix}`, storageKey: `large-${suffix}` },
    });

    await seedApplications(resumeSmall.id, 2, 1); // tiny sample, 50% interview rate
    await seedApplications(resumeLarge.id, MIN, Math.floor(MIN * 0.2)); // real, large enough sample, lower rate

    const rec = await generateCvVersionRecommendation(orgId, careerProfileId);
    expect(rec).toBeNull();
  });

  it("proposes a real, evidence-backed recommendation once BOTH versions clear the sample threshold", async () => {
    const resumeA = await prisma.careerResume.create({
      data: { careerProfileId, version: 3, originalFilename: "a.pdf", mimeType: "application/pdf", sizeBytes: 10, checksum: `recA-${suffix}`, storageKey: `recA-${suffix}` },
    });
    const resumeB = await prisma.careerResume.create({
      data: { careerProfileId, version: 4, originalFilename: "b.pdf", mimeType: "application/pdf", sizeBytes: 10, checksum: `recB-${suffix}`, storageKey: `recB-${suffix}` },
    });

    await seedApplications(resumeA.id, MIN, Math.floor(MIN * 0.5)); // higher interview rate
    await seedApplications(resumeB.id, MIN, Math.floor(MIN * 0.1)); // lower interview rate

    const rec = await generateCvVersionRecommendation(orgId, careerProfileId);
    expect(rec).not.toBeNull();
    expect(rec!.category).toBe("CV_VERSION");
    expect(rec!.reasoning.toLowerCase()).toContain("not a proven cause");

    const proposed = await proposeCareerRecommendation(orgId, careerProfileId, rec!, []);
    expect(proposed).not.toBeNull();

    const row = await prisma.learningRecommendation.findUnique({ where: { id: proposed!.id } });
    expect(row?.status).toBe("PROPOSED");
    expect(row?.approvalRequired).toBe(true);
    expect(row?.careerProfileId).toBe(careerProfileId);
  });

  it("never proposes a second PROPOSED recommendation of the same category while one is already pending (§18 no spam)", async () => {
    const existing = await prisma.learningRecommendation.findFirst({ where: { organizationId: orgId, careerProfileId, category: "CV_VERSION", status: "PROPOSED" } });
    expect(existing).not.toBeNull();

    const rec = await generateCvVersionRecommendation(orgId, careerProfileId);
    expect(rec).not.toBeNull();
    const proposed = await proposeCareerRecommendation(orgId, careerProfileId, rec!, []);
    expect(proposed).toBeNull();
  });
});
