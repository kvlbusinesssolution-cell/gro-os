import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { buildRecruiterReplyDraft, buildDocumentResponseDraft, buildAvailabilityResponseDraft, buildThankYouDraft, queueRecruiterDraft } from "./recruiter-reply-drafts";

describe("recruiter-reply-drafts — Phase 32 real, grounded draft generation (never fabricates)", () => {
  let organizationId: string;
  let userId: string;
  let careerProfileId: string;
  let applicationId: string;
  let contactId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Drafts Test Org", slug: `drafts-org-${suffix}` } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { name: "Drafts Test User", email: `drafts-user-${suffix}@example.com` } });
    userId = user.id;
    const profile = await prisma.careerProfile.create({ data: { userId, organizationId, name: "Drafts Test Profile", workingHoursStart: "09:00", workingHoursEnd: "17:00", workingHoursTimezone: "Asia/Kolkata", workingDays: [1, 2, 3, 4, 5] } });
    careerProfileId = profile.id;
    const job = await prisma.job.create({ data: { title: "Backend Engineer", sourceTitle: "Backend Engineer", company: "Globex", description: "Real job.", canonicalUrl: `https://example.com/drafts-job-${suffix}` } });
    const application = await prisma.jobApplication.create({ data: { organizationId, userId, careerProfileId, jobId: job.id, automationModeAtCreation: "DISCOVERY_ONLY" } });
    applicationId = application.id;

    const contact = await prisma.contact.create({ data: { organizationId, firstName: "Hiring", lastName: "Team", email: `recruiter-${suffix}@globex.example`, tags: ["career-application"] } });
    contactId = contact.id;
    const outboundDraft = await prisma.emailDraft.create({ data: { organizationId, contactId, channel: "EMAIL", purpose: "JOB_APPLICATION", tone: "PROFESSIONAL", body: "Application body.", status: "SENT", resendMessageId: `resend-${suffix}` } });
    await prisma.applicationDocument.create({ data: { applicationId, type: "RECRUITER_EMAIL", providerMessageId: outboundDraft.resendMessageId! } });
  });

  afterAll(async () => {
    await prisma.emailDraft.deleteMany({ where: { organizationId } });
    await prisma.applicationDocument.deleteMany({ where: { applicationId } });
    await prisma.recruiterCommunication.deleteMany({ where: { organizationId } });
    await prisma.careerInterview.deleteMany({ where: { organizationId } });
    await prisma.reply.deleteMany({ where: { organizationId } });
    await prisma.jobApplication.deleteMany({ where: { organizationId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.contact.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  async function makeCommunication(extraction: Record<string, unknown> = {}) {
    const reply = await prisma.reply.create({ data: { organizationId, contactId, content: "Real recruiter message.", channel: "EMAIL", loggedByUserId: userId } });
    return prisma.recruiterCommunication.create({ data: { organizationId, replyId: reply.id, applicationId, matchStatus: "MATCHED", classification: "GENERAL_RESPONSE", classificationConfidence: "MEDIUM", extraction: extraction as Prisma.InputJsonValue } });
  }

  it("buildRecruiterReplyDraft — grounded in real job/company/profile data, honestly omits a recruiter name when none was extracted", async () => {
    const communication = await makeCommunication();
    const draft = await buildRecruiterReplyDraft(communication.id);
    expect(draft).not.toBeNull();
    expect(draft!.subject).toContain("Backend Engineer");
    expect(draft!.subject).toContain("Globex");
    expect(draft!.body).not.toContain("undefined");
    expect(draft!.body).not.toContain("null");
  });

  it("buildDocumentResponseDraft — acknowledges only the real, actually-extracted documents, never invents a list", async () => {
    const communication = await makeCommunication({ documents: ["resume", "portfolio link"] });
    const draft = await buildDocumentResponseDraft(communication.id);
    expect(draft!.body).toContain("resume, portfolio link");
  });

  it("buildDocumentResponseDraft — honest generic phrasing when no specific documents were extracted (never fabricates a list)", async () => {
    const communication = await makeCommunication({ documents: [] });
    const draft = await buildDocumentResponseDraft(communication.id);
    expect(draft!.body).toContain("the requested documents");
  });

  it("buildAvailabilityResponseDraft — uses the real configured working hours, never a guessed schedule", async () => {
    const communication = await makeCommunication();
    const draft = await buildAvailabilityResponseDraft(communication.id);
    expect(draft!.body).toContain("09:00-17:00");
    expect(draft!.body).toContain("Asia/Kolkata");
  });

  it("buildThankYouDraft — returns null (never fabricates) when the interview never genuinely reached SCHEDULED/COMPLETED", async () => {
    const communication = await makeCommunication();
    const interview = await prisma.careerInterview.create({ data: { organizationId, careerProfileId, applicationId, status: "REQUESTED" } });
    const draft = await buildThankYouDraft(interview.id);
    expect(draft).toBeNull();
    await prisma.careerInterview.delete({ where: { id: interview.id } });
    void communication;
  });

  it("buildThankYouDraft — real draft once the interview genuinely reached SCHEDULED", async () => {
    const interview = await prisma.careerInterview.create({ data: { organizationId, careerProfileId, applicationId, status: "SCHEDULED", interviewerName: "Jane Recruiter" } });
    const draft = await buildThankYouDraft(interview.id);
    expect(draft).not.toBeNull();
    expect(draft!.body).toContain("Jane Recruiter");
    await prisma.careerInterview.delete({ where: { id: interview.id } });
  });

  it("queueRecruiterDraft — creates a real EmailDraft at status DRAFT (§46: never auto-queued for send)", async () => {
    const communication = await makeCommunication();
    const draft = await queueRecruiterDraft({ kind: "communication", id: communication.id }, { subject: "Test", body: "Test body." });
    expect(draft).not.toBeNull();
    expect(draft!.status).toBe("DRAFT");
    expect(draft!.contactId).toBe(contactId);
  });

  it("queueRecruiterDraft — returns null (never guesses a recipient) when no real outbound application email exists to resolve a Contact from", async () => {
    const job2 = await prisma.job.create({ data: { title: "No Outbound Job", sourceTitle: "No Outbound Job", company: "Initech", description: "Real job.", canonicalUrl: `https://example.com/no-outbound-${Date.now()}` } });
    const application2 = await prisma.jobApplication.create({ data: { organizationId, userId, careerProfileId, jobId: job2.id, automationModeAtCreation: "DISCOVERY_ONLY" } });
    const reply2 = await prisma.reply.create({ data: { organizationId, contactId, content: "Message.", channel: "EMAIL", loggedByUserId: userId } });
    const communication2 = await prisma.recruiterCommunication.create({ data: { organizationId, replyId: reply2.id, applicationId: application2.id, matchStatus: "MATCHED", classification: "GENERAL_RESPONSE", classificationConfidence: "MEDIUM" } });

    const draft = await queueRecruiterDraft({ kind: "communication", id: communication2.id }, { subject: "Test", body: "Test body." });
    expect(draft).toBeNull();

    await prisma.recruiterCommunication.delete({ where: { id: communication2.id } });
    await prisma.reply.delete({ where: { id: reply2.id } });
    await prisma.jobApplication.delete({ where: { id: application2.id } });
  });
});
