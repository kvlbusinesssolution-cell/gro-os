import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { getAbVariantPerformance, getCampaignAnalytics } from "./campaign-analytics";

/**
 * Phase 17 (Advanced Outbound + Email Deliverability) — real local-Postgres
 * integration test (same convention as reply-automation.test.ts) for the
 * new A/B variant report. Every assertion is against real EmailDraft/Reply
 * rows this test creates itself — never mocked Prisma.
 */
describe("getAbVariantPerformance", () => {
  let orgId: string;
  let userId: string;
  let companyId: string;
  const abTestGroupId = `ab-test-${Date.now()}`;

  async function makeSentDraft(variant: string, opts: { bounced?: boolean; replied?: boolean } = {}) {
    const contact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        companyId,
        firstName: "AB",
        lastName: variant,
        email: `ab-${variant}-${Math.random().toString(36).slice(2)}@example.com`,
        ownerUserId: userId,
      },
    });
    const draft = await prisma.emailDraft.create({
      data: {
        organizationId: orgId,
        contactId: contact.id,
        channel: "EMAIL",
        purpose: "INTRODUCTION",
        tone: "PROFESSIONAL",
        subject: `Subject ${variant}`,
        body: "Body.",
        status: "SENT",
        sentAt: new Date(),
        abVariant: variant,
        abTestGroupId,
        bouncedAt: opts.bounced ? new Date() : null,
      },
    });
    if (opts.replied) {
      await prisma.reply.create({
        data: {
          organizationId: orgId,
          contactId: contact.id,
          emailDraftId: draft.id,
          channel: "EMAIL",
          content: "Real reply content.",
          loggedByUserId: userId,
        },
      });
    }
    return draft;
  }

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "AB Test Org", slug: `ab-test-org-${suffix}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { name: "AB Test User", email: `ab-test-user-${suffix}@example.com` } });
    userId = user.id;
    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });
    const company = await prisma.company.create({ data: { organizationId: orgId, name: "AB Test Co", status: "PROSPECT" } });
    companyId = company.id;

    // Variant A: 2 sent, 1 real reply. Variant B: 1 sent (bounced, not delivered), 0 replies.
    await makeSentDraft("A", { replied: true });
    await makeSentDraft("A");
    await makeSentDraft("B", { bounced: true });
  });

  afterAll(async () => {
    await prisma.reply.deleteMany({ where: { organizationId: orgId } });
    await prisma.emailDraft.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it("computes real per-variant sent/delivered/replied counts, never estimated", async () => {
    const report = await getAbVariantPerformance(orgId, abTestGroupId);
    const variantA = report.variants.find((v) => v.variant === "A");
    const variantB = report.variants.find((v) => v.variant === "B");

    expect(variantA).toBeDefined();
    expect(variantA!.sent).toBe(2);
    expect(variantA!.delivered).toBe(2);
    expect(variantA!.replied).toBe(1);
    expect(variantA!.replyRate).toBe(0.5);

    expect(variantB).toBeDefined();
    expect(variantB!.sent).toBe(1);
    expect(variantB!.delivered).toBe(0); // bounced — never delivered
    expect(variantB!.replied).toBe(0);
  });

  it("never declares a leading variant when sample sizes are below the real minimum", async () => {
    const report = await getAbVariantPerformance(orgId, abTestGroupId);
    // Only 2-3 real sends per variant here — far below MIN_SAMPLE_SIZE (30).
    expect(report.variants.every((v) => v.sufficientSampleSize)).toBe(false);
    expect(report.leadingVariant).toBeNull();
  });

  it("returns an empty report for an abTestGroupId with no real sends, never fabricated variants", async () => {
    const report = await getAbVariantPerformance(orgId, "does-not-exist");
    expect(report.variants).toEqual([]);
    expect(report.leadingVariant).toBeNull();
  });
});

/**
 * Phase 30 (Enterprise Email Deliverability Engine) — real test coverage
 * for getCampaignAnalytics, previously untested. Focused on the new
 * unsubscribeRate field (same real ratio-of-sent pattern as replyRate).
 */
describe("getCampaignAnalytics — unsubscribeRate", () => {
  let orgId: string;
  let userId: string;
  let companyId: string;
  let campaignId: string;

  async function makeSentDraft(opts: { unsubscribed?: boolean } = {}) {
    const contact = await prisma.contact.create({
      data: {
        organizationId: orgId,
        companyId,
        firstName: "Unsub",
        lastName: "Test",
        email: `unsub-rate-${Math.random().toString(36).slice(2)}@example.com`,
        ownerUserId: userId,
        status: opts.unsubscribed ? "UNSUBSCRIBED" : undefined,
      },
    });
    return prisma.emailDraft.create({
      data: { organizationId: orgId, campaignId, contactId: contact.id, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", subject: "S", body: "Body.", status: "SENT", sentAt: new Date() },
    });
  }

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Unsub Rate Test Org", slug: `unsub-rate-org-${suffix}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { name: "Unsub Rate Test User", email: `unsub-rate-user-${suffix}@example.com` } });
    userId = user.id;
    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });
    const company = await prisma.company.create({ data: { organizationId: orgId, name: "Unsub Rate Co", status: "PROSPECT" } });
    companyId = company.id;
    const campaign = await prisma.campaign.create({ data: { organizationId: orgId, name: "Unsub Rate Campaign", type: "STANDARD", status: "ACTIVE", createdByUserId: userId } });
    campaignId = campaign.id;

    // 4 real sends, 1 real recipient genuinely unsubscribed — real 25% rate.
    await makeSentDraft({ unsubscribed: true });
    await makeSentDraft();
    await makeSentDraft();
    await makeSentDraft();
  });

  afterAll(async () => {
    await prisma.emailDraft.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.campaign.deleteMany({ where: { organizationId: orgId } });
    await prisma.company.deleteMany({ where: { organizationId: orgId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it("computes a real unsubscribeRate as a genuine ratio of this campaign's own sent recipients, never a raw count", async () => {
    const analytics = await getCampaignAnalytics(campaignId);
    expect(analytics.emailsSent).toBe(4);
    expect(analytics.unsubscribeRate).toBe(25);
  });

  it("returns 0 (never NaN/undefined) for a campaign with no real sends at all", async () => {
    const emptyCampaign = await prisma.campaign.create({ data: { organizationId: orgId, name: "Empty Campaign", type: "STANDARD", status: "DRAFT", createdByUserId: userId } });
    const analytics = await getCampaignAnalytics(emptyCampaign.id);
    expect(analytics.emailsSent).toBe(0);
    expect(analytics.unsubscribeRate).toBe(0);
    await prisma.campaign.deleteMany({ where: { id: emptyCampaign.id } });
  });
});
