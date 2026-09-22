import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { getSkillGapAnalysis } from "./skill-gap-analysis";

describe("getSkillGapAnalysis — §24 MARKET DEMAND vs USER SKILL GAP, real DB", () => {
  const suffix = Date.now();
  let orgId: string;
  let userId: string;
  let careerProfileId: string;
  let jobIds: string[] = [];

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Skill Gap Test Org", slug: `skill-gap-${suffix}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { name: "Skill Gap User", email: `skill-gap-${suffix}@example.com` } });
    userId = user.id;
    const profile = await prisma.careerProfile.create({
      data: { userId, organizationId: orgId, name: "Skill Gap Profile", skills: [{ name: "React" }] },
    });
    careerProfileId = profile.id;

    const jobs = await Promise.all([
      prisma.job.create({ data: { title: `Gap Job 1 ${suffix}`, sourceTitle: `Gap Job 1 ${suffix}`, company: "GapCo", description: "d", requirements: { required: ["react", "graphql"], preferred: ["docker"] } } }),
      prisma.job.create({ data: { title: `Gap Job 2 ${suffix}`, sourceTitle: `Gap Job 2 ${suffix}`, company: "GapCo2", description: "d", requirements: { required: ["react", "graphql"], preferred: [] } } }),
    ]);
    jobIds = jobs.map((j) => j.id);
    for (const job of jobs) {
      await prisma.jobMatch.create({ data: { careerProfileId, jobId: job.id, organizationId: orgId, overallScore: 70, dimensions: {} } });
    }
  });

  afterAll(async () => {
    await prisma.jobMatch.deleteMany({ where: { careerProfileId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it("marks a verified profile skill as PRESENT, never MISSING", async () => {
    const result = await getSkillGapAnalysis(orgId, careerProfileId);
    const react = result.gaps.find((g) => g.skill === "react");
    expect(react?.userEvidenceStatus).toBe("PRESENT");
  });

  it("marks a real required skill absent from the profile as MISSING, with real relevantJobCount from actual matched jobs", async () => {
    const result = await getSkillGapAnalysis(orgId, careerProfileId);
    const graphql = result.gaps.find((g) => g.skill === "graphql");
    expect(graphql?.userEvidenceStatus).toBe("MISSING");
    expect(graphql?.importance).toBe("REQUIRED");
    expect(graphql?.relevantJobCount).toBe(2);
  });

  it("classifies a preferred-only skill separately from required, never conflating the two (§7)", async () => {
    const result = await getSkillGapAnalysis(orgId, careerProfileId);
    const docker = result.gaps.find((g) => g.skill === "docker");
    expect(docker?.importance).toBe("PREFERRED");
  });

  it("returns NEEDS_VERIFICATION (never a false MISSING) when the profile has no skills evidence at all", async () => {
    const emptyProfile = await prisma.careerProfile.create({ data: { userId, organizationId: orgId, name: "Empty Skills Profile" } });
    await prisma.jobMatch.create({ data: { careerProfileId: emptyProfile.id, jobId: jobIds[0]!, organizationId: orgId, overallScore: 50, dimensions: {} } });

    const result = await getSkillGapAnalysis(orgId, emptyProfile.id);
    const react = result.gaps.find((g) => g.skill === "react");
    expect(react?.userEvidenceStatus).toBe("NEEDS_VERIFICATION");

    await prisma.jobMatch.deleteMany({ where: { careerProfileId: emptyProfile.id } });
    await prisma.careerProfile.delete({ where: { id: emptyProfile.id } });
  });

  it("§54 tenant isolation — returns empty for a profile that doesn't belong to the given organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Skill Gap Other Org", slug: `skill-gap-other-${suffix}` } });
    const result = await getSkillGapAnalysis(otherOrg.id, careerProfileId);
    expect(result.gaps).toEqual([]);
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });
});
