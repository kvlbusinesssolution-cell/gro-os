import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createOrUpdateInterviewFromCommunication, decideInterview } from "./interview-scheduling";

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
  });

  afterAll(async () => {
    await prisma.careerInterview.deleteMany({ where: { organizationId } });
    await prisma.recruiterCommunication.deleteMany({ where: { organizationId } });
    await prisma.reply.deleteMany({ where: { organizationId } });
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

  it("§22 — ACCEPT decision moves a PENDING_APPROVAL interview to SCHEDULED", async () => {
    const interview = await prisma.careerInterview.findUnique({ where: { sourceCommunicationId: communicationId } });
    const result = await decideInterview(interview!.id, userId, "ACCEPT");
    expect(result.ok).toBe(true);
    const updated = await prisma.careerInterview.findUnique({ where: { id: interview!.id } });
    expect(updated!.status).toBe("SCHEDULED");
    expect(updated!.decisionByUserId).toBe(userId);
  });

  it("cannot re-decide an interview that is no longer PENDING_APPROVAL/REQUESTED", async () => {
    const interview = await prisma.careerInterview.findUnique({ where: { sourceCommunicationId: communicationId } });
    const result = await decideInterview(interview!.id, userId, "REJECT");
    expect(result.ok).toBe(false);
  });
});
