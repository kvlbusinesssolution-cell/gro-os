import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { matchReplyToApplication } from "./recruiter-message-matching";

describe("matchReplyToApplication — §4 real, conservative email->application matching", () => {
  let organizationId: string;
  let userId: string;
  let careerProfileId: string;
  let contactId: string;
  let contactNoApplicationId: string;
  let contactMultipleId: string;
  let applicationAId: string;
  let applicationBId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Matching Test Org", slug: `matching-org-${suffix}` } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { name: "Matching Test User", email: `matching-user-${suffix}@example.com` } });
    userId = user.id;
    const profile = await prisma.careerProfile.create({ data: { userId, organizationId, name: "Matching Test Profile" } });
    careerProfileId = profile.id;

    const contact = await prisma.contact.create({ data: { organizationId, firstName: "Hiring", lastName: "Team", email: `recruiter-${suffix}@acme.example`, tags: ["career-application"] } });
    contactId = contact.id;
    const contactNoApp = await prisma.contact.create({ data: { organizationId, firstName: "Hiring", lastName: "Team", email: `norecruit-${suffix}@acme.example`, tags: ["career-application"] } });
    contactNoApplicationId = contactNoApp.id;
    const contactMultiple = await prisma.contact.create({ data: { organizationId, firstName: "Hiring", lastName: "Team", email: `multi-${suffix}@acme.example`, tags: ["career-application"] } });
    contactMultipleId = contactMultiple.id;

    const jobA = await prisma.job.create({ data: { title: "Engineer A", sourceTitle: "Engineer A", company: "Acme", description: "Real job A.", canonicalUrl: `https://example.com/job-a-${suffix}` } });
    const jobB = await prisma.job.create({ data: { title: "Engineer B", sourceTitle: "Engineer B", company: "Acme", description: "Real job B.", canonicalUrl: `https://example.com/job-b-${suffix}` } });

    const applicationA = await prisma.jobApplication.create({ data: { organizationId, userId, careerProfileId, jobId: jobA.id, automationModeAtCreation: "DISCOVERY_ONLY" } });
    applicationAId = applicationA.id;
    const applicationB = await prisma.jobApplication.create({ data: { organizationId, userId, careerProfileId, jobId: jobB.id, automationModeAtCreation: "DISCOVERY_ONLY" } });
    applicationBId = applicationB.id;

    // Single real application email for `contactId` — this is what a THREAD_REFERENCE match resolves against.
    const draft = await prisma.emailDraft.create({ data: { organizationId, contactId, channel: "EMAIL", purpose: "JOB_APPLICATION", tone: "PROFESSIONAL", body: "Application body.", status: "SENT", resendMessageId: `resend-${suffix}-a` } });
    await prisma.applicationDocument.create({ data: { applicationId: applicationAId, type: "RECRUITER_EMAIL", providerMessageId: draft.resendMessageId! } });

    // Two real application emails for `contactMultipleId` — ambiguous without a direct thread reference.
    const draftM1 = await prisma.emailDraft.create({ data: { organizationId, contactId: contactMultipleId, channel: "EMAIL", purpose: "JOB_APPLICATION", tone: "PROFESSIONAL", body: "Application body.", status: "SENT", resendMessageId: `resend-${suffix}-m1` } });
    await prisma.applicationDocument.create({ data: { applicationId: applicationAId, type: "RECRUITER_EMAIL", providerMessageId: draftM1.resendMessageId! } });
    const draftM2 = await prisma.emailDraft.create({ data: { organizationId, contactId: contactMultipleId, channel: "EMAIL", purpose: "JOB_APPLICATION", tone: "PROFESSIONAL", body: "Application body.", status: "SENT", resendMessageId: `resend-${suffix}-m2` } });
    await prisma.applicationDocument.create({ data: { applicationId: applicationBId, type: "RECRUITER_EMAIL", providerMessageId: draftM2.resendMessageId! } });
  });

  afterAll(async () => {
    await prisma.applicationDocument.deleteMany({ where: { applicationId: { in: [applicationAId, applicationBId] } } });
    await prisma.emailDraft.deleteMany({ where: { organizationId } });
    await prisma.reply.deleteMany({ where: { organizationId } });
    await prisma.jobApplication.deleteMany({ where: { careerProfileId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.contact.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("MATCHED — a reply explicitly threaded (emailDraftId) to the real application email resolves via THREAD_REFERENCE", async () => {
    const draft = await prisma.emailDraft.findFirst({ where: { contactId, purpose: "JOB_APPLICATION" } });
    const reply = await prisma.reply.create({ data: { organizationId, contactId, content: "Thanks for applying.", channel: "EMAIL", loggedByUserId: userId, emailDraftId: draft!.id } });
    const result = await matchReplyToApplication(reply.id);
    expect(result.status).toBe("MATCHED");
    expect(result.applicationId).toBe(applicationAId);
    expect(result.evidence).toContain("THREAD_REFERENCE");
  });

  it("POSSIBLE_MATCH — a reply with no thread reference from a sender with exactly one real application email", async () => {
    const reply = await prisma.reply.create({ data: { organizationId, contactId, content: "Thanks for applying.", channel: "EMAIL", loggedByUserId: userId } });
    const result = await matchReplyToApplication(reply.id);
    expect(result.status).toBe("POSSIBLE_MATCH");
    expect(result.applicationId).toBe(applicationAId);
  });

  it("AMBIGUOUS — a reply with no thread reference from a sender with multiple real application emails is NOT silently attached", async () => {
    const reply = await prisma.reply.create({ data: { organizationId, contactId: contactMultipleId, content: "Thanks for applying.", channel: "EMAIL", loggedByUserId: userId } });
    const result = await matchReplyToApplication(reply.id);
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.applicationId).toBeNull();
  });

  it("UNMATCHED — a reply from a sender with no real career-application email on file", async () => {
    const reply = await prisma.reply.create({ data: { organizationId, contactId: contactNoApplicationId, content: "Hello.", channel: "EMAIL", loggedByUserId: userId } });
    const result = await matchReplyToApplication(reply.id);
    expect(result.status).toBe("UNMATCHED");
    expect(result.applicationId).toBeNull();
  });
});
