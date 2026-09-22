import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { getAbVariantPerformance } from "./campaign-analytics";

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
