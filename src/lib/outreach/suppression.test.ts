import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { checkSuppression, addSuppressionEntry } from "./suppression";

/**
 * Phase 30 (Enterprise Email Deliverability Engine) — real local-Postgres
 * integration tests for Phase 4's already-real but previously-untested
 * suppression choke-point: the real `SuppressionEntry` fast path, the
 * `Contact.status`/bounce/complaint backfill fallbacks, and the soft-bounce
 * escalation threshold. Never mocked Prisma.
 */
describe("suppression", () => {
  let orgId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Suppression Test Org", slug: `suppression-test-org-${suffix}` } });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma.emailDraft.deleteMany({ where: { organizationId: orgId } });
    await prisma.contact.deleteMany({ where: { organizationId: orgId } });
    await prisma.suppressionEntry.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it("blocks a real SuppressionEntry row directly, without needing a Contact lookup", async () => {
    const email = `direct-suppressed-${Date.now()}@example.com`;
    await addSuppressionEntry({ organizationId: orgId, identifier: email, reason: "MANUAL_SUPPRESSION", source: "test" });
    const result = await checkSuppression(orgId, email);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe("MANUAL_SUPPRESSION");
  });

  it("allows a real, never-suppressed address", async () => {
    const result = await checkSuppression(orgId, `never-suppressed-${Date.now()}@example.com`);
    expect(result.suppressed).toBe(false);
  });

  it("real Contact.status UNSUBSCRIBED backfills a real SuppressionEntry and blocks", async () => {
    const email = `unsub-fallback-${Date.now()}@example.com`;
    await prisma.contact.create({ data: { organizationId: orgId, firstName: "Unsub", lastName: "Fallback", email, status: "UNSUBSCRIBED" } });
    const result = await checkSuppression(orgId, email);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe("UNSUBSCRIBED");
    const entry = await prisma.suppressionEntry.findUnique({ where: { organizationId_channel_email: { organizationId: orgId, channel: "EMAIL", email: email.toLowerCase() } } });
    expect(entry).not.toBeNull();
  });

  it("a real prior spam complaint on an EmailDraft blocks and backfills SPAM_COMPLAINT", async () => {
    const email = `complaint-fallback-${Date.now()}@example.com`;
    const contact = await prisma.contact.create({ data: { organizationId: orgId, firstName: "Complaint", lastName: "Fallback", email } });
    await prisma.emailDraft.create({
      data: { organizationId: orgId, contactId: contact.id, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", body: "Body.", status: "SENT", sentAt: new Date(), complainedAt: new Date() },
    });
    const result = await checkSuppression(orgId, email);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe("SPAM_COMPLAINT");
  });

  it("a real prior HARD bounce blocks and backfills HARD_BOUNCE", async () => {
    const email = `hard-bounce-fallback-${Date.now()}@example.com`;
    const contact = await prisma.contact.create({ data: { organizationId: orgId, firstName: "Hard", lastName: "Bounce", email } });
    await prisma.emailDraft.create({
      data: { organizationId: orgId, contactId: contact.id, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", body: "Body.", status: "BOUNCED", sentAt: new Date(), bouncedAt: new Date(), bounceType: "hard" },
    });
    const result = await checkSuppression(orgId, email);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe("HARD_BOUNCE");
  });

  it("a single real SOFT bounce does NOT suppress (allows a controlled retry)", async () => {
    const email = `single-soft-bounce-${Date.now()}@example.com`;
    const contact = await prisma.contact.create({ data: { organizationId: orgId, firstName: "Single", lastName: "Soft", email } });
    await prisma.emailDraft.create({
      data: { organizationId: orgId, contactId: contact.id, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", body: "Body.", status: "BOUNCED", sentAt: new Date(), bouncedAt: new Date(), bounceType: "soft" },
    });
    const result = await checkSuppression(orgId, email);
    expect(result.suppressed).toBe(false);
  });

  it("real repeated soft bounces at the documented escalation threshold (3) escalate to suppression", async () => {
    const email = `repeated-soft-bounce-${Date.now()}@example.com`;
    const contact = await prisma.contact.create({ data: { organizationId: orgId, firstName: "Repeated", lastName: "Soft", email } });
    for (let i = 0; i < 3; i++) {
      await prisma.emailDraft.create({
        data: { organizationId: orgId, contactId: contact.id, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", body: "Body.", status: "BOUNCED", sentAt: new Date(), bouncedAt: new Date(), bounceType: "soft" },
      });
    }
    const result = await checkSuppression(orgId, email);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe("HARD_BOUNCE"); // real escalation, correctly reported under the HARD_BOUNCE suppression reason
  });

  it("real 2 soft bounces (below the threshold) still do NOT suppress", async () => {
    const email = `two-soft-bounces-${Date.now()}@example.com`;
    const contact = await prisma.contact.create({ data: { organizationId: orgId, firstName: "Two", lastName: "Soft", email } });
    for (let i = 0; i < 2; i++) {
      await prisma.emailDraft.create({
        data: { organizationId: orgId, contactId: contact.id, channel: "EMAIL", purpose: "INTRODUCTION", tone: "PROFESSIONAL", body: "Body.", status: "BOUNCED", sentAt: new Date(), bouncedAt: new Date(), bounceType: "soft" },
      });
    }
    const result = await checkSuppression(orgId, email);
    expect(result.suppressed).toBe(false);
  });

  it("addSuppressionEntry is idempotent — calling it twice for the same real address never errors or duplicates", async () => {
    const email = `idempotent-${Date.now()}@example.com`;
    await addSuppressionEntry({ organizationId: orgId, identifier: email, reason: "MANUAL_SUPPRESSION", source: "first" });
    await addSuppressionEntry({ organizationId: orgId, identifier: email, reason: "HARD_BOUNCE", source: "second" });
    const rows = await prisma.suppressionEntry.findMany({ where: { organizationId: orgId, email: email.toLowerCase() } });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("HARD_BOUNCE"); // real, latest write wins
  });
});
