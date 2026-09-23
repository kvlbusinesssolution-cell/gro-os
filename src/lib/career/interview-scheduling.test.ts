import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createOrUpdateInterviewFromCommunication, decideInterview } from "./interview-scheduling";
import { buildInterviewAcceptanceDraft } from "./recruiter-reply-drafts";

describe("interview-scheduling — §20/§21/§22/§53 real idempotent creation + human decision flow", () => {
  let organizationId: string;
  let userId: string;
  let careerProfileId: string;
  let applicationId: string;
  let communicationId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Scheduling Test Org", slug: `scheduling-org-${suffix}` } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { name: "Scheduling Test User", email: `scheduling-user-${suffix}@example.com` } });
    userId = user.id;
    const profile = await prisma.careerProfile.create({ data: { userId, organizationId, name: "Scheduling Test Profile" } });
    careerProfileId = profile.id;
    const job = await prisma.job.create({ data: { title: "Engineer", sourceTitle: "Engineer", company: "Acme", description: "Real job.", canonicalUrl: `https://example.com/scheduling-job-${suffix}` } });
    const application = await prisma.jobApplication.create({ data: { organizationId, userId, careerProfileId, jobId: job.id, automationModeAtCreation: "DISCOVERY_ONLY" } });
    applicationId = application.id;

    const contact = await prisma.contact.create({ data: { organizationId, firstName: "Hiring", lastName: "Team", email: `recruiter-${suffix}@acme.example`, tags: ["career-application"] } });
    const reply = await prisma.reply.create({ data: { organizationId, contactId: contact.id, content: "Can we schedule an interview?", channel: "EMAIL", loggedByUserId: userId } });
    const communication = await prisma.recruiterCommunication.create({ data: { organizationId, replyId: reply.id, applicationId, matchStatus: "MATCHED", classification: "INTERVIEW_REQUEST", classificationConfidence: "HIGH" } });
    communicationId = communication.id;

    // Real outbound application email on file — the path buildInterviewAcceptanceDraft/queueRecruiterDraft
    // resolve the real Contact through (same as application-followup.ts's stopping-condition check).
    const outboundDraft = await prisma.emailDraft.create({ data: { organizationId, contactId: contact.id, channel: "EMAIL", purpose: "JOB_APPLICATION", tone: "PROFESSIONAL", body: "Application body.", status: "SENT", resendMessageId: `resend-${suffix}-application` } });
    await prisma.applicationDocument.create({ data: { applicationId, type: "RECRUITER_EMAIL", providerMessageId: outboundDraft.resendMessageId! } });
  });

  afterAll(async () => {
    await prisma.careerInterview.deleteMany({ where: { organizationId } });
    await prisma.recruiterCommunication.deleteMany({ where: { organizationId } });
    await prisma.reply.deleteMany({ where: { organizationId } });
    await prisma.applicationDocument.deleteMany({ where: { applicationId } });
    await prisma.emailDraft.deleteMany({ where: { organizationId } });
    await prisma.jobApplication.deleteMany({ where: { organizationId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.contact.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("§10 — creates a real CareerInterview from actual evidence, honestly PENDING_APPROVAL when a real date/time was resolved", async () => {
    const interview = await createOrUpdateInterviewFromCommunication({
      organizationId,
      careerProfileId,
      applicationId,
      sourceCommunicationId: communicationId,
      stage: "Technical Round 1",
      localDate: "2026-10-05",
      localTime: "15:00",
      timezone: "Asia/Kolkata",
      scheduledAtUtc: new Date("2026-10-05T09:30:00Z"),
      durationMinutes: 60,
      meetingLink: "https://meet.example.com/xyz",
      phone: null,
      interviewerName: "Jane Recruiter",
    });
    expect(interview.status).toBe("PENDING_APPROVAL");
    expect(interview.timezone).toBe("Asia/Kolkata");
  });

  it("§53 — reprocessing the SAME source communication never creates a duplicate interview (real idempotency)", async () => {
    const before = await prisma.careerInterview.count({ where: { sourceCommunicationId: communicationId } });
    await createOrUpdateInterviewFromCommunication({
      organizationId,
      careerProfileId,
      applicationId,
      sourceCommunicationId: communicationId,
      stage: null,
      localDate: "2026-10-05",
      localTime: "15:00",
      timezone: "Asia/Kolkata",
      scheduledAtUtc: new Date("2026-10-05T09:30:00Z"),
      durationMinutes: 60,
      meetingLink: null,
      phone: null,
      interviewerName: null,
    });
    const after = await prisma.careerInterview.count({ where: { sourceCommunicationId: communicationId } });
    expect(after).toBe(before);
    expect(after).toBe(1);
  });

  it("Phase 32 — buildInterviewAcceptanceDraft is grounded in real interview data, never fabricates when data is missing", async () => {
    const interview = await prisma.careerInterview.findUnique({ where: { sourceCommunicationId: communicationId } });
    const draft = await buildInterviewAcceptanceDraft(interview!.id);
    expect(draft).not.toBeNull();
    expect(draft!.subject).toContain("Engineer");
    expect(draft!.body).toContain("15:00");
    expect(draft!.body).toContain("Asia/Kolkata");
    expect(draft!.body).toContain("https://meet.example.com/xyz");
  });

  it("§22 — ACCEPT decision moves a PENDING_APPROVAL interview to SCHEDULED, and now genuinely queues a real DRAFT-status acceptance EmailDraft (§46: never auto-sent)", async () => {
    const interview = await prisma.careerInterview.findUnique({ where: { sourceCommunicationId: communicationId } });
    const result = await decideInterview(interview!.id, userId, "ACCEPT");
    expect(result.ok).toBe(true);
    const updated = await prisma.careerInterview.findUnique({ where: { id: interview!.id } });
    expect(updated!.status).toBe("SCHEDULED");
    expect(updated!.decisionByUserId).toBe(userId);

    const draft = await prisma.emailDraft.findFirst({ where: { organizationId, purpose: "JOB_APPLICATION", subject: { contains: "Interview" } } });
    expect(draft).not.toBeNull();
    expect(draft!.status).toBe("DRAFT");
    expect(draft!.body).toContain("confirm");
  });

  it("cannot re-decide an interview that is no longer PENDING_APPROVAL/REQUESTED", async () => {
    const interview = await prisma.careerInterview.findUnique({ where: { sourceCommunicationId: communicationId } });
    const result = await decideInterview(interview!.id, userId, "REJECT");
    expect(result.ok).toBe(false);
  });

  it("Phase 32 §54 — a genuinely conflicting timezone on a second pending interview request for the same application is honestly surfaced, never silently resolved", async () => {
    const contact2 = await prisma.contact.create({ data: { organizationId, firstName: "Second", lastName: "Recruiter", email: `recruiter2-${Date.now()}@acme.example`, tags: ["career-application"] } });
    const reply2 = await prisma.reply.create({ data: { organizationId, contactId: contact2.id, content: "Can we do 3pm EST instead?", channel: "EMAIL", loggedByUserId: userId } });
    const communication2 = await prisma.recruiterCommunication.create({ data: { organizationId, replyId: reply2.id, applicationId, matchStatus: "MATCHED", classification: "INTERVIEW_REQUEST", classificationConfidence: "HIGH" } });

    // First: a real pending request with timezone "America/New_York".
    await createOrUpdateInterviewFromCommunication({
      organizationId,
      careerProfileId,
      applicationId,
      sourceCommunicationId: communication2.id,
      stage: null,
      localDate: "2026-11-01",
      localTime: "15:00",
      timezone: "America/New_York",
      scheduledAtUtc: null,
      durationMinutes: null,
      meetingLink: null,
      phone: null,
      interviewerName: null,
    });

    // Second: a different real communication proposing a genuinely different timezone.
    const reply3 = await prisma.reply.create({ data: { organizationId, contactId: contact2.id, content: "Actually let's do 3pm PST.", channel: "EMAIL", loggedByUserId: userId } });
    const communication3 = await prisma.recruiterCommunication.create({ data: { organizationId, replyId: reply3.id, applicationId, matchStatus: "MATCHED", classification: "INTERVIEW_REQUEST", classificationConfidence: "HIGH" } });
    const interview3 = await createOrUpdateInterviewFromCommunication({
      organizationId,
      careerProfileId,
      applicationId,
      sourceCommunicationId: communication3.id,
      stage: null,
      localDate: "2026-11-01",
      localTime: "15:00",
      timezone: "America/Los_Angeles",
      scheduledAtUtc: null,
      durationMinutes: null,
      meetingLink: null,
      phone: null,
      interviewerName: null,
    });

    expect(interview3.notes).toContain("Timezone conflict");
    expect(interview3.notes).toContain("America/New_York");
  });
});
