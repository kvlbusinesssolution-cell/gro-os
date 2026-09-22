import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { whatShouldIApplyToday, whatSkillsAreInDemand, whichCvPerformsBetter } from "./career-insights";

describe("career-insights — real DB", () => {
  const suffix = Date.now();
  let orgId: string;
  let userId: string;
  let careerProfileId: string;
  let jobIds: string[] = [];

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Career Insights Test Org", slug: `career-insights-${suffix}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { name: "Career Insights User", email: `career-insights-${suffix}@example.com` } });
    userId = user.id;
    const profile = await prisma.careerProfile.create({ data: { userId, organizationId: orgId, name: "Career Insights Profile" } });
    careerProfileId = profile.id;

    const jobA = await prisma.job.create({ data: { title: `Insights Job A ${suffix}`, sourceTitle: `Insights Job A ${suffix}`, company: "InsightsCo", description: "d" } });
    const jobB = await prisma.job.create({ data: { title: `Insights Job B ${suffix}`, sourceTitle: `Insights Job B ${suffix}`, company: "InsightsCo2", description: "d" } });
    jobIds = [jobA.id, jobB.id];

    // Job A: matched but NOT yet applied to — should appear in "apply today".
    await prisma.jobMatch.create({
      data: { careerProfileId, jobId: jobA.id, organizationId: orgId, overallScore: 88, status: "SHORTLISTED", dimensions: {}, explanation: { whyMatched: ["Real skill match"], whatIsMissing: [], whatIsRisky: [] } },
    });
    // Job B: matched AND already applied to — must be excluded (§19 duplicate check).
    const matchB = await prisma.jobMatch.create({ data: { careerProfileId, jobId: jobB.id, organizationId: orgId, overallScore: 92, status: "SHORTLISTED", dimensions: {} } });
    await prisma.jobApplication.create({
      data: { organizationId: orgId, userId, careerProfileId, jobId: jobB.id, jobMatchId: matchB.id, automationModeAtCreation: "AI_PREPARE", status: "SUBMITTED" },
    });
  });

  afterAll(async () => {
    await prisma.jobApplication.deleteMany({ where: { careerProfileId } });
    await prisma.jobMatch.deleteMany({ where: { careerProfileId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it("§19 never suggests a job that already has a real application (duplicate check)", async () => {
    const items = await whatShouldIApplyToday(orgId, careerProfileId);
    const jobIdsSuggested = items.map((i) => i.jobId);
    expect(jobIdsSuggested).not.toContain(jobIds[1]);
  });

  it("§19/§20 suggests the real un-applied match, with a real FACT (dimensions) and OBSERVATION (why) separated, and never auto-applies", async () => {
    const items = await whatShouldIApplyToday(orgId, careerProfileId);
    const jobA = items.find((i) => i.jobId === jobIds[0]);
    expect(jobA).toBeDefined();
    expect(jobA!.actualMatch.kind).toBe("ACTUAL");
    expect(jobA!.why?.kind).toBe("OBSERVATION");
    expect(jobA!.recommendation.kind).toBe("RECOMMENDATION");
    expect(jobA!.recommendation.action.toLowerCase()).not.toContain("applied successfully");
  });

  it("§72 whichCvPerformsBetter never returns an unsupported winner — only an OBSERVATION", async () => {
    const result = await whichCvPerformsBetter(orgId, careerProfileId);
    expect(result.kind).toBe("OBSERVATION");
  });

  it("§70 whatSkillsAreInDemand honestly returns INSUFFICIENT_DATA when no market snapshot has been persisted yet for a fresh check", async () => {
    // Uses the real JobMarketSnapshot table's actual current state — if no
    // snapshot has ever been persisted, this must say so, never invent one.
    const snapshotCount = await prisma.jobMarketSnapshot.count();
    const result = await whatSkillsAreInDemand();
    if (snapshotCount === 0) {
      expect(result.kind).toBe("INSUFFICIENT_DATA");
    } else {
      expect(["OBSERVATION", "INSUFFICIENT_DATA"]).toContain(result.kind);
    }
  });
});
