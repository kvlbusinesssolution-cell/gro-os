import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { computeJobMarketSnapshot, detectEmergingTechnologies, type DistributionEntry } from "./market-intelligence";

/**
 * §64 real market-intelligence test — controlled Job fixtures with a known
 * expected distribution, verified against the actual computed result.
 */
describe("computeJobMarketSnapshot — real DB, controlled fixture (§64)", () => {
  const suffix = Date.now();
  let jobIds: string[] = [];

  beforeAll(async () => {
    const jobs = await Promise.all([
      prisma.job.create({
        data: {
          title: `Snapshot Test React Dev ${suffix}`,
          sourceTitle: `Snapshot Test React Dev ${suffix}`,
          company: "SnapshotCo",
          description: "Real test description.",
          technologies: ["React", "TypeScript"],
          requirements: { required: ["react"], preferred: ["graphql"] },
          workMode: "REMOTE",
          country: "USA",
          careerLevel: "Senior",
          salaryMin: 90000,
          salaryMax: 110000,
          salaryCurrency: "USD",
          salaryPeriod: "YEAR",
          experienceMinYears: 5,
        },
      }),
      prisma.job.create({
        data: {
          title: `Snapshot Test React Dev 2 ${suffix}`,
          sourceTitle: `Snapshot Test React Dev 2 ${suffix}`,
          company: "SnapshotCo2",
          description: "Real test description.",
          technologies: ["React"],
          requirements: { required: ["react"], preferred: [] },
          workMode: "HYBRID",
          country: "USA",
          careerLevel: "Senior",
          salaryMin: 95000,
          salaryMax: 115000,
          salaryCurrency: "USD",
          salaryPeriod: "YEAR",
          experienceMinYears: 6,
        },
      }),
      prisma.job.create({
        data: {
          title: `Snapshot Test Python Dev ${suffix}`,
          sourceTitle: `Snapshot Test Python Dev ${suffix}`,
          company: "SnapshotCo3",
          description: "Real test description.",
          technologies: ["Python"],
          workMode: "ONSITE",
          country: "Germany",
        },
      }),
    ]);
    jobIds = jobs.map((j) => j.id);
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
  });

  it("computes a real skill distribution using structured requirements when present, technologies as fallback", async () => {
    const snapshot = await computeJobMarketSnapshot();
    const reactSkill = snapshot.skillDistribution.find((s) => s.key === "react");
    expect(reactSkill).toBeDefined();
    expect(reactSkill!.jobCount).toBeGreaterThanOrEqual(2);

    // Job 3 has no requirements Json, so its raw technology ("python") falls back into skillDistribution too.
    const pythonSkill = snapshot.skillDistribution.find((s) => s.key === "python");
    expect(pythonSkill).toBeDefined();
  });

  it("never invents a salary observation from fewer than the minimum real sample — a role with only 2 real salary points is excluded", async () => {
    const snapshot = await computeJobMarketSnapshot();
    // Only 2 of the 3 fixture jobs have salary data — below the module's
    // own MIN_SALARY_SAMPLE=3 threshold — so no salaryObservations entry
    // should exist purely from this fixture's "Senior" career level.
    const seniorSalary = snapshot.salaryObservations.find((s) => s.role === "Senior");
    expect(seniorSalary).toBeUndefined();
  });

  it("computes a real work-mode distribution with correct percentages", async () => {
    const snapshot = await computeJobMarketSnapshot();
    const total = snapshot.sampleSize;
    const remote = snapshot.workModeDistribution.find((w) => w.key === "REMOTE");
    expect(remote).toBeDefined();
    expect(remote!.percentage).toBeCloseTo(Math.round((remote!.jobCount / total) * 1000) / 10);
  });

  it("marks industry as AI_INFERENCE when present, never presenting it as a raw source fact (§33)", async () => {
    await prisma.job.update({ where: { id: jobIds[0]! }, data: { industry: "Software" } });
    const snapshot = await computeJobMarketSnapshot();
    const industryEntry = snapshot.industryDistribution.find((i) => i.key.includes("Software"));
    expect(industryEntry?.key).toContain("AI_INFERENCE");
  });
});

describe("detectEmergingTechnologies — §28 period-over-period, never a single-posting guess", () => {
  function dist(entries: [string, number][], total: number): DistributionEntry[] {
    return entries.map(([key, jobCount]) => ({ key, jobCount, percentage: Math.round((jobCount / total) * 1000) / 10 }));
  }

  it("never calls a technology emerging from a single job posting", () => {
    const periodA = { technologyDistribution: dist([], 10), sampleSize: 10 };
    const periodB = { technologyDistribution: dist([["rust", 1]], 10), sampleSize: 10 };
    const result = detectEmergingTechnologies(periodA, periodB);
    expect(result.find((r) => r.technology === "rust")).toBeUndefined();
  });

  it("real growth detection when a technology's real share increases with sufficient sample", () => {
    const periodA = { technologyDistribution: dist([["rust", 2]], 100), sampleSize: 100 };
    const periodB = { technologyDistribution: dist([["rust", 20]], 100), sampleSize: 100 };
    const result = detectEmergingTechnologies(periodA, periodB);
    const rust = result.find((r) => r.technology === "rust");
    expect(rust).toBeDefined();
    expect(rust!.growthPercentagePoints).toBeGreaterThan(0);
  });
});
