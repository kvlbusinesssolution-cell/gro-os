import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { mergeContacts } from "./contact-merge";

// Real local-Postgres integration test, matching company-merge.test.ts's convention.
describe("mergeContacts — Phase 25 (contact merge safety)", () => {
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const orgA = await prisma.organization.create({ data: { name: "Contact Merge Test Org A", slug: `contact-merge-test-org-a-${suffix}` } });
    const orgB = await prisma.organization.create({ data: { name: "Contact Merge Test Org B", slug: `contact-merge-test-org-b-${suffix}` } });
    orgAId = orgA.id;
    orgBId = orgB.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  });

  it("reassigns real child records (Reminder via relatedContactId) from the merge-away contact to the keeper, inside one transaction", async () => {
    const keep = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Keeper", email: `keeper-${Date.now()}@example.com` } });
    const away = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Away", email: `away-${Date.now()}@example.com` } });
    const user = await prisma.user.create({ data: { name: "Reminder Test User", email: `reminder-user-${Date.now()}@example.com` } });

    const reminder = await prisma.reminder.create({
      data: { organizationId: orgAId, userId: user.id, title: "Follow up", remindAt: new Date(), relatedContactId: away.id },
    });

    const result = await mergeContacts(orgAId, keep.id, away.id, null);
    expect(result.ok).toBe(true);
    expect(result.reassignedCounts?.reminder).toBe(1);

    const moved = await prisma.reminder.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(moved.relatedContactId).toBe(keep.id);
  });

  it("soft-merges — the away contact is never deleted, is flagged mergedIntoId, and stays reachable via mergedInto", async () => {
    const keep = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Keeper Two", email: `keeper2-${Date.now()}@example.com` } });
    const away = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Away Two", email: `away2-${Date.now()}@example.com` } });

    await mergeContacts(orgAId, keep.id, away.id, null);

    const awayRow = await prisma.contact.findUnique({ where: { id: away.id }, include: { mergedInto: true } });
    expect(awayRow).not.toBeNull();
    expect(awayRow?.mergedIntoId).toBe(keep.id);
    expect(awayRow?.mergedAt).toBeInstanceOf(Date);
    expect(awayRow?.mergedInto?.id).toBe(keep.id);
  });

  it("drops the merge-away contact's VoiceConsent (1:1 @unique) rather than violating the constraint, when the keeper already has one", async () => {
    const keep = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Keeper Three", email: `keeper3-${Date.now()}@example.com` } });
    const away = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Away Three", email: `away3-${Date.now()}@example.com` } });

    await prisma.voiceConsent.create({ data: { organizationId: orgAId, contactId: keep.id, status: "GRANTED" } });
    const awayConsent = await prisma.voiceConsent.create({ data: { organizationId: orgAId, contactId: away.id, status: "DENIED" } });

    const result = await mergeContacts(orgAId, keep.id, away.id, null);
    expect(result.ok).toBe(true);
    expect(result.reassignedCounts?.voiceConsent_dropped_duplicate).toBe(1);

    const stillExists = await prisma.voiceConsent.findUnique({ where: { id: awayConsent.id } });
    expect(stillExists).toBeNull();
    const keeperConsent = await prisma.voiceConsent.findUniqueOrThrow({ where: { contactId: keep.id } });
    expect(keeperConsent.status).toBe("GRANTED"); // keeper's own real status untouched
  });

  it("reassigns VoiceConsent normally when the keeper does not already have one", async () => {
    const keep = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Keeper Four", email: `keeper4-${Date.now()}@example.com` } });
    const away = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Away Four", email: `away4-${Date.now()}@example.com` } });

    const awayConsent = await prisma.voiceConsent.create({ data: { organizationId: orgAId, contactId: away.id, status: "GRANTED" } });

    const result = await mergeContacts(orgAId, keep.id, away.id, null);
    expect(result.reassignedCounts?.voiceConsent).toBe(1);

    const moved = await prisma.voiceConsent.findUnique({ where: { id: awayConsent.id } });
    expect(moved?.contactId).toBe(keep.id);
  });

  it("rejects merging contacts that belong to different organizations", async () => {
    const keep = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Org A Contact", email: `orga-${Date.now()}@example.com` } });
    const away = await prisma.contact.create({ data: { organizationId: orgBId, firstName: "Org B Contact", email: `orgb-${Date.now()}@example.com` } });

    const result = await mergeContacts(orgAId, keep.id, away.id, null);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found in your organization/);

    const unchanged = await prisma.contact.findUniqueOrThrow({ where: { id: away.id } });
    expect(unchanged.mergedIntoId).toBeNull();
    expect(unchanged.organizationId).toBe(orgBId);
  });

  it("rejects merging a contact into itself", async () => {
    const contact = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Self", email: `self-${Date.now()}@example.com` } });
    const result = await mergeContacts(orgAId, contact.id, contact.id, null);
    expect(result.ok).toBe(false);
  });

  it("rejects merging a contact that has already been merged away", async () => {
    const keep = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Keeper Five", email: `keeper5-${Date.now()}@example.com` } });
    const away = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Away Five", email: `away5-${Date.now()}@example.com` } });
    const other = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Third", email: `third-${Date.now()}@example.com` } });

    const first = await mergeContacts(orgAId, keep.id, away.id, null);
    expect(first.ok).toBe(true);

    const second = await mergeContacts(orgAId, other.id, away.id, null);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already been merged/);
  });
});
