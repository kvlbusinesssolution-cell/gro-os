import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real integration test, but the PROVIDER's real network call is mocked
// here specifically — never the discovery/matching/dedup logic itself
// (all real, tested separately in job-matching.test.ts /
// job-deduplication.test.ts). This keeps the test suite fast, deterministic
// and network-independent, while still respecting Remotive's real rate-limit
// guidance by never hitting their live API from an automated test run.
vi.mock("./job-providers/registry", () => ({
  getJobProviderByName: vi.fn(() => ({
    name: "Remotive",
    getStatus: () => "ACTIVE",
    search: vi.fn(async () => ({ status: "ACTIVE", jobs: [] })),
  })),
}));

import { prisma } from "@/lib/prisma";
import { runJobDiscoveryForProfile } from "./job-discovery";

describe("runJobDiscoveryForProfile — real ownership + rate-limit cooldown", () => {
  let orgAId: string;
  let orgBId: string;
  let careerProfileId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const orgA = await prisma.organization.create({ data: { name: "Discovery Test Org A", slug: `discovery-org-a-${suffix}` } });
    orgAId = orgA.id;
    const orgB = await prisma.organization.create({ data: { name: "Discovery Test Org B", slug: `discovery-org-b-${suffix}` } });
    orgBId = orgB.id;

    const user = await prisma.user.create({ data: { name: "Discovery Test User", email: `discovery-user-${suffix}@example.com` } });
    const profile = await prisma.careerProfile.create({ data: { userId: user.id, organizationId: orgAId, name: "Discovery Test Profile" } });
    careerProfileId = profile.id;
  });

  afterAll(async () => {
    await prisma.jobDiscoveryRun.deleteMany({ where: { careerProfileId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  });

  it("rejects a real cross-org access attempt — never runs discovery for a profile outside the caller's org", async () => {
    const result = await runJobDiscoveryForProfile(careerProfileId, orgBId, "MANUAL");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Career profile not found.");
  });

  it("runs successfully for the real owning org and creates a real JobDiscoveryRun row", async () => {
    const result = await runJobDiscoveryForProfile(careerProfileId, orgAId, "MANUAL");
    expect(result.ok).toBe(true);
    expect(result.status).toBe("COMPLETED");

    const run = await prisma.jobDiscoveryRun.findUnique({ where: { id: result.runId } });
    expect(run).not.toBeNull();
    expect(run?.organizationId).toBe(orgAId);
  });

  it("enforces a real rate-limit cooldown — a second run within the window is rejected, never silently re-hitting the provider", async () => {
    const result = await runJobDiscoveryForProfile(careerProfileId, orgAId, "MANUAL");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("hours ago");
  });
});
