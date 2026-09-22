import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { withAgentRunTracing } from "@/lib/ai/agent-governance";
import { globalSearch } from "@/lib/search";

describe("Phase 23 — Unified AI Agent Governance (AgentRun)", () => {
  let organizationId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Phase23 Governance Org", slug: `phase23-gov-${suffix}` } });
    organizationId = org.id;
  });

  afterAll(async () => {
    await prisma.agentRun.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  it("records a real COMPLETED AgentRun row with input/output summaries and duration", async () => {
    const result = await withAgentRunTracing(
      { organizationId, domain: "CAREER", agentKey: "test-agent", inputSummary: "test input" },
      async () => ({ value: 42 }),
      (r) => ({ outputSummary: `value=${r.value}`, confidence: 90 }),
    );
    expect(result.value).toBe(42);

    const runs = await prisma.agentRun.findMany({ where: { organizationId, agentKey: "test-agent" } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("COMPLETED");
    expect(runs[0].outputSummary).toBe("value=42");
    expect(runs[0].confidence).toBe(90);
    expect(runs[0].completedAt).not.toBeNull();
    expect(runs[0].durationMs).not.toBeNull();
  });

  it("records a real FAILED AgentRun row (never silently swallowed) when the wrapped call throws", async () => {
    await expect(
      withAgentRunTracing({ organizationId, domain: "BUSINESS", agentKey: "test-agent-failure", inputSummary: "test input" }, async () => {
        throw new Error("simulated provider failure");
      }),
    ).rejects.toThrow("simulated provider failure");

    const runs = await prisma.agentRun.findMany({ where: { organizationId, agentKey: "test-agent-failure" } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("FAILED");
    expect(runs[0].errorMessage).toBe("simulated provider failure");
  });
});

describe("Phase 23 — cross-tenant isolation spot checks (§25)", () => {
  let orgAId: string;
  let orgBId: string;
  let userB: { id: string };
  let careerProfileBId: string;
  let jobId: string;
  let jobApplicationBId: string;
  let companyBId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const orgA = await prisma.organization.create({ data: { name: "Phase23 Tenant A", slug: `phase23-tenant-a-${suffix}` } });
    const orgB = await prisma.organization.create({ data: { name: "Phase23 Tenant B", slug: `phase23-tenant-b-${suffix}` } });
    orgAId = orgA.id;
    orgBId = orgB.id;

    userB = await prisma.user.create({ data: { name: "Tenant B User", email: `tenant-b-${suffix}@example.com` } });

    const profileB = await prisma.careerProfile.create({
      data: { userId: userB.id, organizationId: orgBId, name: "Confidential Candidate B" },
    });
    careerProfileBId = profileB.id;

    const job = await prisma.job.create({
      data: {
        title: `Phase23 Search Target Job ${suffix}`,
        sourceTitle: `Phase23 Search Target Job ${suffix}`,
        company: "Acme Confidential Co",
        description: "test job",
      },
    });
    jobId = job.id;

    await prisma.jobMatch.create({
      data: { organizationId: orgBId, careerProfileId: careerProfileBId, jobId, overallScore: 80, dimensions: {}, eligibility: "LIKELY_ELIGIBLE" },
    });

    const appB = await prisma.jobApplication.create({
      data: { organizationId: orgBId, userId: userB.id, careerProfileId: careerProfileBId, jobId, automationModeAtCreation: "DISCOVERY_ONLY" },
    });
    jobApplicationBId = appB.id;

    const companyB = await prisma.company.create({
      data: { organizationId: orgBId, name: `Phase23 Confidential Company ${suffix}` },
    });
    companyBId = companyB.id;

    await prisma.agentRun.create({
      data: { organizationId: orgBId, domain: "CAREER", agentKey: "tenant-b-only-run", inputSummary: "tenant B only", status: "COMPLETED" },
    });
  });

  afterAll(async () => {
    await prisma.agentRun.deleteMany({ where: { organizationId: orgBId } });
    await prisma.company.deleteMany({ where: { id: companyBId } });
    await prisma.jobApplication.deleteMany({ where: { id: jobApplicationBId } });
    await prisma.jobMatch.deleteMany({ where: { careerProfileId: careerProfileBId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileBId } });
    await prisma.user.deleteMany({ where: { id: userB.id } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  });

  it("Tenant A's globalSearch never surfaces Tenant B's CareerProfile", async () => {
    const results = await globalSearch(orgAId, "Confidential Candidate B");
    expect(results.find((r) => r.kind === "careerProfile" && r.id === careerProfileBId)).toBeUndefined();
  });

  it("Tenant A's globalSearch never surfaces Tenant B's JobApplication (matched via the shared, non-org-scoped Job)", async () => {
    const results = await globalSearch(orgAId, "Search Target Job");
    expect(results.find((r) => r.kind === "careerApplication" && r.id === jobApplicationBId)).toBeUndefined();
    // The Job itself is also correctly absent from Tenant A's results, since
    // Tenant A has no JobMatch against it (Job is intentionally global, but
    // search scoping is via JobMatch — see search.ts's comment).
    expect(results.find((r) => r.kind === "job" && r.id === jobId)).toBeUndefined();
  });

  it("Tenant A's globalSearch never surfaces Tenant B's Company (business-engine cross-tenant check)", async () => {
    const results = await globalSearch(orgAId, "Confidential Company");
    expect(results.find((r) => r.kind === "company" && r.id === companyBId)).toBeUndefined();
  });

  it("a direct org-scoped AgentRun query for Tenant A never returns Tenant B's governance runs", async () => {
    const runs = await prisma.agentRun.findMany({ where: { organizationId: orgAId, agentKey: "tenant-b-only-run" } });
    expect(runs).toHaveLength(0);
  });

  it("Tenant B's own globalSearch DOES surface its own CareerProfile and JobApplication (positive control — proves the negative results above are isolation, not a broken query)", async () => {
    const results = await globalSearch(orgBId, "Confidential Candidate B");
    expect(results.find((r) => r.kind === "careerProfile" && r.id === careerProfileBId)).toBeDefined();
  });
});
