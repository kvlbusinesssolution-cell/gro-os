import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { checkDuplicateApplication } from "./application-duplicate";

describe("checkDuplicateApplication — §5/§51 real, DB-backed duplicate detection", () => {
  let orgId: string;
  let profileId: string;
  let jobAId: string;
  let jobBId: string; // same company+title as A, different Job row — simulates an undetected Phase-19 source duplicate

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Duplicate Test Org", slug: `dup-test-org-${suffix}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { name: "Duplicate Test User", email: `dup-user-${suffix}@example.com` } });
    const profile = await prisma.careerProfile.create({ data: { userId: user.id, organizationId: orgId, name: "Dup Test Profile" } });
    profileId = profile.id;

    const jobA = await prisma.job.create({ data: { title: "Senior React Developer", sourceTitle: "Senior React Developer", company: "Acme Corp", description: "Real job." } });
    jobAId = jobA.id;
    const jobB = await prisma.job.create({ data: { title: "Senior React Developer", sourceTitle: "Senior React Developer", company: "Acme Corp", description: "Real job, different posting." } });
    jobBId = jobB.id;
  });

  afterAll(async () => {
    await prisma.jobApplication.deleteMany({ where: { careerProfileId: profileId } });
    await prisma.careerProfile.deleteMany({ where: { id: profileId } });
    await prisma.job.deleteMany({ where: { id: { in: [jobAId, jobBId] } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it("returns NO_DUPLICATE when no application exists yet for this job", async () => {
    const result = await checkDuplicateApplication(profileId, jobAId);
    expect(result.status).toBe("NO_DUPLICATE");
  });

  it("returns DUPLICATE_CONFIRMED once a real application already exists for the exact same job (backed by the real DB unique constraint)", async () => {
    const app = await prisma.jobApplication.create({ data: { organizationId: orgId, userId: (await prisma.careerProfile.findUniqueOrThrow({ where: { id: profileId } })).userId, careerProfileId: profileId, jobId: jobAId, automationModeAtCreation: "DISCOVERY_ONLY" } });

    const result = await checkDuplicateApplication(profileId, jobAId);
    expect(result.status).toBe("DUPLICATE_CONFIRMED");
    expect(result.existingApplicationId).toBe(app.id);
  });

  it("returns POSSIBLE_DUPLICATE for the same company+title under a genuinely different Job row — never silently merged, always flagged for review (§5)", async () => {
    const result = await checkDuplicateApplication(profileId, jobBId);
    expect(result.status).toBe("POSSIBLE_DUPLICATE");
  });

  it("the real DB unique constraint itself rejects a second insert for the same (careerProfileId, jobId) even if the pre-flight check were bypassed", async () => {
    const userId = (await prisma.careerProfile.findUniqueOrThrow({ where: { id: profileId } })).userId;
    await expect(
      prisma.jobApplication.create({ data: { organizationId: orgId, userId, careerProfileId: profileId, jobId: jobAId, automationModeAtCreation: "DISCOVERY_ONLY" } }),
    ).rejects.toThrow();
  });
});
