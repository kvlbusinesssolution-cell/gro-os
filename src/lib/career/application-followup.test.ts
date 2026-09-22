import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { computeFollowUpDates, evaluateFollowUpStoppingConditions, scheduleFollowUpsForApplication } from "./application-followup";

describe("computeFollowUpDates — §40 real, configurable interval computation", () => {
  it("computes the default Day 0/5/10 offsets from a real anchor date", () => {
    const anchor = new Date("2026-10-01T00:00:00Z");
    const dates = computeFollowUpDates(anchor, [0, 5, 10]);
    expect(dates).toHaveLength(3);
    expect(dates[0].scheduledFor.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(dates[1].scheduledFor.toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(dates[2].scheduledFor.toISOString()).toBe("2026-10-11T00:00:00.000Z");
  });

  it("honors a genuinely different, user-configured interval (§40: never hard-coded)", () => {
    const dates = computeFollowUpDates(new Date("2026-10-01T00:00:00Z"), [3, 7, 14]);
    expect(dates.map((d) => d.dayOffset)).toEqual([3, 7, 14]);
  });
});

describe("evaluateFollowUpStoppingConditions — §41/§58 real, re-checked-at-send-time stopping conditions", () => {
  let organizationId: string;
  let userId: string;
  let careerProfileId: string;
  let applicationId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "FollowUp Test Org", slug: `followup-org-${suffix}` } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { name: "FollowUp Test User", email: `followup-user-${suffix}@example.com` } });
    userId = user.id;
    const profile = await prisma.careerProfile.create({ data: { userId, organizationId, name: "FollowUp Test Profile", followUpEnabled: true } });
    careerProfileId = profile.id;
    const job = await prisma.job.create({ data: { title: "Engineer", sourceTitle: "Engineer", company: "Acme", description: "Real job.", canonicalUrl: `https://example.com/followup-job-${suffix}` } });
    const application = await prisma.jobApplication.create({ data: { organizationId, userId, careerProfileId, jobId: job.id, automationModeAtCreation: "DISCOVERY_ONLY", status: "SUBMITTED", submittedAt: new Date() } });
    applicationId = application.id;
  });

  afterAll(async () => {
    await prisma.careerFollowUp.deleteMany({ where: { organizationId } });
    await prisma.recruiterCommunication.deleteMany({ where: { organizationId } });
    await prisma.reply.deleteMany({ where: { organizationId } });
    await prisma.jobApplication.deleteMany({ where: { organizationId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.contact.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("§41 — does not send when there is no prior outbound application email on file", async () => {
    const result = await evaluateFollowUpStoppingConditions(applicationId);
    expect(result.shouldSend).toBe(false);
    expect(result.reason).toContain("No prior outbound email");
  });

  it("§41 — does not send when the application already has a real recruiter reply", async () => {
    const contact = await prisma.contact.create({ data: { organizationId, firstName: "Hiring", lastName: "Team", email: `stop-${Date.now()}@acme.example`, tags: ["career-application"] } });
    const reply = await prisma.reply.create({ data: { organizationId, contactId: contact.id, content: "Thanks, received.", channel: "EMAIL", loggedByUserId: userId } });
    await prisma.recruiterCommunication.create({ data: { organizationId, replyId: reply.id, applicationId, matchStatus: "MATCHED", classification: "GENERAL_RESPONSE", classificationConfidence: "HIGH" } });

    const result = await evaluateFollowUpStoppingConditions(applicationId);
    expect(result.shouldSend).toBe(false);
    expect(result.reason).toContain("already been received");
  });

  it("§41 — does not send once the application has reached a terminal/responded status", async () => {
    await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: "REJECTED" } });
    const result = await evaluateFollowUpStoppingConditions(applicationId);
    expect(result.shouldSend).toBe(false);
    expect(result.reason).toContain("REJECTED");
  });
});

describe("scheduleFollowUpsForApplication — §40 idempotent scheduling", () => {
  let organizationId: string;
  let careerProfileId: string;
  let applicationId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "FollowUp Schedule Org", slug: `followup-schedule-org-${suffix}` } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { name: "FollowUp Schedule User", email: `followup-schedule-user-${suffix}@example.com` } });
    const profile = await prisma.careerProfile.create({ data: { userId: user.id, organizationId, name: "FollowUp Schedule Profile", followUpEnabled: true, followUpIntervalDays: [0, 5] } });
    careerProfileId = profile.id;
    const job = await prisma.job.create({ data: { title: "Engineer", sourceTitle: "Engineer", company: "Acme", description: "Real job.", canonicalUrl: `https://example.com/followup-schedule-job-${suffix}` } });
    const application = await prisma.jobApplication.create({ data: { organizationId, userId: user.id, careerProfileId, jobId: job.id, automationModeAtCreation: "DISCOVERY_ONLY", status: "SUBMITTED", submittedAt: new Date() } });
    applicationId = application.id;
  });

  afterAll(async () => {
    await prisma.careerFollowUp.deleteMany({ where: { organizationId } });
    await prisma.jobApplication.deleteMany({ where: { organizationId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("creates real follow-up rows matching the profile's configured intervals", async () => {
    const result = await scheduleFollowUpsForApplication(applicationId);
    expect(result.created).toBe(2);
    const rows = await prisma.careerFollowUp.findMany({ where: { applicationId } });
    expect(rows.map((r) => r.dayOffset).sort()).toEqual([0, 5]);
  });

  it("§53-style idempotency — scheduling again never creates duplicate rows for the same dayOffset", async () => {
    const before = await prisma.careerFollowUp.count({ where: { applicationId } });
    await scheduleFollowUpsForApplication(applicationId);
    const after = await prisma.careerFollowUp.count({ where: { applicationId } });
    expect(after).toBe(before);
  });
});
