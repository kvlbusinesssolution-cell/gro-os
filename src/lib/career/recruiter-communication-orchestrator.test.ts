import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Deterministic, offline test run — same rationale as
// application-orchestrator.test.ts: exercises the REAL honest-degradation
// path when AI is unavailable (UNKNOWN classification, reviewRequired —
// never a guessed classification), itself real spec-relevant behavior
// (§68 "AI failure"/"AI timeout" test cases).
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return { ...actual, isAIConnected: () => false };
});

import { prisma } from "@/lib/prisma";
import { processCareerReply, resolveInterviewDateTime } from "./recruiter-communication-orchestrator";

describe("resolveInterviewDateTime — §9/§54 real, conservative date/time resolution", () => {
  it("resolves a genuinely unambiguous ISO date + time + valid IANA timezone", () => {
    const result = resolveInterviewDateTime("2026-10-05", "15:00", "Asia/Kolkata");
    expect(result).not.toBeNull();
    // 15:00 IST = 09:30 UTC
    expect(result!.toISOString()).toBe("2026-10-05T09:30:00.000Z");
  });

  it("§9 — never resolves a relative date text like 'next Friday'", () => {
    expect(resolveInterviewDateTime("next Friday", "15:00", "Asia/Kolkata")).toBeNull();
  });

  it("§9 — never resolves when timezone is missing (TIMEZONE_REQUIRED case)", () => {
    expect(resolveInterviewDateTime("2026-10-05", "15:00", null)).toBeNull();
  });

  it("never resolves an invalid IANA timezone string", () => {
    expect(resolveInterviewDateTime("2026-10-05", "15:00", "Not/AZone")).toBeNull();
  });
});

describe("processCareerReply — real end-to-end orchestration + tenant/contact-tag gating", () => {
  let organizationId: string;
  let userId: string;
  let careerProfileId: string;
  let careerContactId: string;
  let nonCareerContactId: string;
  let applicationId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Orchestrator Test Org", slug: `orchestrator-org-${suffix}` } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { name: "Orchestrator Test User", email: `orchestrator-user-${suffix}@example.com` } });
    userId = user.id;
    const profile = await prisma.careerProfile.create({ data: { userId, organizationId, name: "Orchestrator Test Profile" } });
    careerProfileId = profile.id;

    const careerContact = await prisma.contact.create({ data: { organizationId, firstName: "Hiring", lastName: "Team", email: `recruiter-${suffix}@acme.example`, tags: ["career-application"] } });
    careerContactId = careerContact.id;
    const nonCareerContact = await prisma.contact.create({ data: { organizationId, firstName: "Sales", lastName: "Prospect", email: `prospect-${suffix}@acme.example`, tags: [] } });
    nonCareerContactId = nonCareerContact.id;

    const job = await prisma.job.create({ data: { title: "Engineer", sourceTitle: "Engineer", company: "Acme", description: "Real job.", canonicalUrl: `https://example.com/orchestrator-job-${suffix}` } });
    const application = await prisma.jobApplication.create({ data: { organizationId, userId, careerProfileId, jobId: job.id, automationModeAtCreation: "DISCOVERY_ONLY" } });
    applicationId = application.id;

    const draft = await prisma.emailDraft.create({ data: { organizationId, contactId: careerContactId, channel: "EMAIL", purpose: "JOB_APPLICATION", tone: "PROFESSIONAL", body: "Application body.", status: "SENT", resendMessageId: `resend-${suffix}` } });
    await prisma.applicationDocument.create({ data: { applicationId, type: "RECRUITER_EMAIL", providerMessageId: draft.resendMessageId! } });
  });

  afterAll(async () => {
    await prisma.recruiterCommunication.deleteMany({ where: { organizationId } });
    await prisma.careerInterview.deleteMany({ where: { organizationId } });
    await prisma.applicationDocument.deleteMany({ where: { applicationId } });
    await prisma.emailDraft.deleteMany({ where: { organizationId } });
    await prisma.reply.deleteMany({ where: { organizationId } });
    await prisma.jobApplication.deleteMany({ where: { organizationId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.contact.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("§3 — no-ops for a Reply whose Contact is NOT tagged career-application (never touches ordinary sales replies)", async () => {
    const reply = await prisma.reply.create({ data: { organizationId, contactId: nonCareerContactId, content: "We'd like to move forward.", channel: "EMAIL", loggedByUserId: userId } });
    const result = await processCareerReply(reply.id);
    expect(result.processed).toBe(false);
    const communication = await prisma.recruiterCommunication.findUnique({ where: { replyId: reply.id } });
    expect(communication).toBeNull();
  });

  it("processes a real career reply: matches via POSSIBLE_MATCH, classification honestly UNKNOWN with AI disconnected, reviewRequired true", async () => {
    const reply = await prisma.reply.create({ data: { organizationId, contactId: careerContactId, content: "Can we schedule an interview next week?", channel: "EMAIL", loggedByUserId: userId } });
    const result = await processCareerReply(reply.id);
    expect(result.processed).toBe(true);

    const communication = await prisma.recruiterCommunication.findUnique({ where: { replyId: reply.id } });
    expect(communication).not.toBeNull();
    expect(communication!.matchStatus).toBe("POSSIBLE_MATCH");
    expect(communication!.applicationId).toBe(applicationId);
    expect(communication!.classification).toBe("UNKNOWN");
    expect(communication!.classificationConfidence).toBe("UNKNOWN");
    expect(communication!.reviewRequired).toBe(true);
  });

  it("§59 — never applies an application status sync for a non-MATCHED (POSSIBLE_MATCH) communication", async () => {
    const application = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
    // The reply above was POSSIBLE_MATCH, not MATCHED — status must be untouched.
    expect(application!.status).toBe("DISCOVERED");
  });

  it("§60 — a real Notification row is created for the actual application owner when review is required", async () => {
    const notifications = await prisma.notification.findMany({ where: { userId, organizationId, type: "APPROVAL_REQUESTED" } });
    expect(notifications.length).toBeGreaterThan(0);
  });
});
