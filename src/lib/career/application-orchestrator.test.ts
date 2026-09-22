import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Deterministic, offline test run — same rationale as job-discovery.test.ts
// mocking the real Remotive provider call: this exercises the REAL
// prepare pipeline's graceful-degradation path when AI is unavailable
// (customization/cover-letter genuinely skipped, never faked), which is
// itself real, spec-relevant behavior worth covering.
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return { ...actual, isAIConnected: () => false };
});

const { sendQueuedDraftCoreMock } = vi.hoisted(() => ({ sendQueuedDraftCoreMock: vi.fn() }));
vi.mock("@/app/dashboard/outreach/_lib/approval-actions", () => ({ sendQueuedDraftCore: sendQueuedDraftCoreMock }));

import { prisma } from "@/lib/prisma";
import { prepareApplicationCore, submitApplicationCore } from "./application-orchestrator";

describe("application orchestrator — real end-to-end pipeline + tenant isolation", () => {
  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;
  let profileId: string;
  let jobId: string;
  let jobMatchId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const orgA = await prisma.organization.create({ data: { name: "Orchestrator Test Org A", slug: `orch-org-a-${suffix}` } });
    orgAId = orgA.id;
    const orgB = await prisma.organization.create({ data: { name: "Orchestrator Test Org B", slug: `orch-org-b-${suffix}` } });
    orgBId = orgB.id;

    const userA = await prisma.user.create({ data: { name: "Orchestrator Test User A", email: `orch-user-a-${suffix}@example.com` } });
    userAId = userA.id;
    const userB = await prisma.user.create({ data: { name: "Orchestrator Test User B", email: `orch-user-b-${suffix}@example.com` } });
    userBId = userB.id;

    const profile = await prisma.careerProfile.create({
      data: { userId: userAId, organizationId: orgAId, name: "Orchestrator Test Profile", skills: [{ name: "React" }], yearsOfExperience: 5, currentRole: "Frontend Engineer" },
    });
    profileId = profile.id;

    await prisma.careerResume.create({
      data: { careerProfileId: profileId, version: 1, originalFilename: "resume.txt", mimeType: "text/plain", sizeBytes: 10, checksum: "abc", storageKey: "k1", status: "PROCESSED" },
    });

    const job = await prisma.job.create({
      data: { title: "Senior React Developer", sourceTitle: "Senior React Developer", company: "Acme Corp", description: "We need a Senior React Developer.", technologies: ["React"] },
    });
    jobId = job.id;

    const jobMatch = await prisma.jobMatch.create({
      data: {
        careerProfileId: profileId,
        jobId,
        organizationId: orgAId,
        overallScore: 85,
        dimensions: { skill: { status: "MATCHED", evidence: [] }, experience: { status: "MATCHED", evidence: [] }, role: { status: "MATCHED", evidence: [] }, industry: { status: "UNKNOWN", evidence: [] }, location: { status: "MATCHED", evidence: [] }, salary: { status: "UNKNOWN", evidence: [] }, technology: { status: "MATCHED", evidence: [] }, careerLevel: { status: "UNKNOWN", evidence: [] }, preference: { status: "UNKNOWN", evidence: [] } },
        eligibility: "LIKELY_ELIGIBLE",
        status: "MATCHED",
      },
    });
    jobMatchId = jobMatch.id;
  });

  afterAll(async () => {
    await prisma.applicationAnswer.deleteMany({ where: { application: { careerProfileId: profileId } } });
    await prisma.applicationDocument.deleteMany({ where: { application: { careerProfileId: profileId } } });
    await prisma.jobApplication.deleteMany({ where: { careerProfileId: profileId } });
    await prisma.jobMatch.deleteMany({ where: { careerProfileId: profileId } });
    await prisma.careerResume.deleteMany({ where: { careerProfileId: profileId } });
    await prisma.careerProfile.deleteMany({ where: { id: profileId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  });

  it("rejects a real cross-org access attempt — never prepares an application for a job match outside the caller's org (§4)", async () => {
    const result = await prepareApplicationCore(profileId, jobMatchId, orgBId, userAId);
    expect(result.ok).toBe(false);
  });

  it("rejects a real cross-user access attempt within the same org (§4)", async () => {
    await prisma.membership.create({ data: { userId: userBId, organizationId: orgAId, role: "OWNER", status: "ACTIVE" } });
    const result = await prepareApplicationCore(profileId, jobMatchId, orgAId, userBId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Career profile not found.");
  });

  it("runs the real full pipeline for the genuine owner, reaching a real terminal prepare state with a real audit trail", async () => {
    const result = await prepareApplicationCore(profileId, jobMatchId, orgAId, userAId);
    expect(result.ok).toBe(true);
    expect(result.applicationId).toBeTruthy();
    // Real status reaches READY_FOR_REVIEW even though — because AI is
    // unavailable in this test, so no cover letter was generated — the
    // internal validationResult is honestly REVIEW_REQUIRED, not READY;
    // only a BLOCKED validation result prevents reaching this state.
    expect(result.status).toBe("READY_FOR_REVIEW");
    const app = await prisma.jobApplication.findUniqueOrThrow({ where: { id: result.applicationId } });
    expect(app.validationResult).toBe("REVIEW_REQUIRED");

    const application = await prisma.jobApplication.findUniqueOrThrow({ where: { id: result.applicationId } });
    expect(application.eligibilityStatus).not.toBe("UNKNOWN");
    expect(application.selectedResumeId).toBeTruthy();
    expect(application.duplicateStatus).toBe("NO_DUPLICATE");

    // Phase 31 — real match-to-response prediction, surfaced alongside
    // the real Phase-19 fit score, honestly INSUFFICIENT_DATA since this
    // profile has zero prior real applications to blend a rate from.
    const matchPrediction = application.matchPrediction as { kind: string; fitScore: number | null; insufficientData: boolean; denominator: number } | null;
    expect(matchPrediction).not.toBeNull();
    expect(matchPrediction?.kind).toBe("PREDICTION");
    expect(matchPrediction?.fitScore).toBe(85);
    expect(matchPrediction?.insufficientData).toBe(true);
    expect(matchPrediction?.denominator).toBe(0);

    const answers = await prisma.applicationAnswer.findMany({ where: { applicationId: result.applicationId } });
    expect(answers.length).toBeGreaterThan(0);

    const auditRows = await prisma.auditLog.findMany({ where: { organizationId: orgAId, action: { startsWith: "career:application:" }, metadata: { path: ["applicationId"], equals: result.applicationId } } });
    expect(auditRows.length).toBeGreaterThan(0);
  });

  it("running prepare a second time for the same job honestly reports DUPLICATE, never a second application row (§5/§51)", async () => {
    const result = await prepareApplicationCore(profileId, jobMatchId, orgAId, userAId);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("DUPLICATE");

    const count = await prisma.jobApplication.count({ where: { careerProfileId: profileId, jobId } });
    expect(count).toBe(1);
  });

  it("submitApplicationCore requires USER approval under the real DISCOVERY_ONLY default automation mode — never auto-submits (§19)", async () => {
    const application = await prisma.jobApplication.findFirstOrThrow({ where: { careerProfileId: profileId, jobId } });
    const result = await submitApplicationCore(application.id, userAId);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("USER_APPROVAL_REQUIRED");
    expect(sendQueuedDraftCoreMock).not.toHaveBeenCalled();
  });
});
