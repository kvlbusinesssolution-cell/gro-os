import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { enrichContact } from "./enrichment";

/**
 * Phase 26 — real Postgres integration test for the ContactEvidence wiring
 * Phase 25's own report claimed already existed but genuinely didn't (see
 * this phase's final report). Confirms enrichContact actually creates real
 * ContactEvidence rows for its deterministic seniority/buyer-role
 * derivations, is idempotent on a repeated no-change run, and never writes
 * evidence for a null/UNKNOWN derivation.
 */
describe("enrichContact — real ContactEvidence wiring", () => {
  let organizationId: string;
  let userId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Enrich Contact Evidence Test Org", slug: `enrich-contact-evidence-test-${Date.now()}` },
    });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { email: `enrich-contact-evidence-test-${Date.now()}@example.com` } });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates real ContactEvidence rows for seniority and buyer-role when a real derivation exists", async () => {
    const contact = await prisma.contact.create({
      data: { organizationId, firstName: "Jordan", lastName: "Rivera", email: `jordan-${Date.now()}@example.com`, jobTitle: "Chief Technology Officer" },
    });

    const result = await enrichContact(contact.id, { triggeredBy: "MANUAL", triggeredByUserId: userId });
    expect(result.status).toBe("COMPLETED");

    const evidence = await prisma.contactEvidence.findMany({ where: { contactId: contact.id } });
    expect(evidence.length).toBe(2);

    const seniorityEvidence = evidence.find((e) => e.fieldName === "seniority");
    expect(seniorityEvidence?.kind).toBe("AI_INTERPRETATION");
    expect(seniorityEvidence?.source).toBe("COMPANY_INTELLIGENCE");
    expect(seniorityEvidence?.fact).toContain("C-Level");
    expect(seniorityEvidence?.fact).toContain("Chief Technology Officer");

    const buyerRoleEvidence = evidence.find((e) => e.fieldName === "buyerRole");
    expect(buyerRoleEvidence?.fact).toContain("TECHNICAL_BUYER");

    await prisma.contact.delete({ where: { id: contact.id } });
  });

  it("does not fabricate evidence for a job title with no real seniority signal — UNKNOWN stays UNKNOWN, nothing written for that field", async () => {
    const contact = await prisma.contact.create({
      data: { organizationId, firstName: "Alex", lastName: "Doe", email: `alex-${Date.now()}@example.com`, jobTitle: "Blorptastic Wizard" },
    });

    await enrichContact(contact.id, { triggeredBy: "MANUAL", triggeredByUserId: userId });

    const seniorityEvidence = await prisma.contactEvidence.findFirst({ where: { contactId: contact.id, fieldName: "seniority" } });
    expect(seniorityEvidence).toBeNull();

    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.seniority).toBeNull(); // honest UNKNOWN, never a guessed default

    await prisma.contact.delete({ where: { id: contact.id } });
  });

  it("is idempotent — re-enriching with the same job title does not duplicate evidence rows", async () => {
    const contact = await prisma.contact.create({
      data: { organizationId, firstName: "Sam", lastName: "Lee", email: `sam-${Date.now()}@example.com`, jobTitle: "VP of Sales" },
    });

    await enrichContact(contact.id, { triggeredBy: "MANUAL", triggeredByUserId: userId });
    const firstCount = await prisma.contactEvidence.count({ where: { contactId: contact.id } });
    expect(firstCount).toBeGreaterThan(0);

    // Real re-run: enrichmentStatus must be reset since enrichContact skips
    // an already-RUNNING/QUEUED run, not a COMPLETED one — this matches
    // its own real short-circuit check.
    await enrichContact(contact.id, { triggeredBy: "MANUAL", triggeredByUserId: userId });
    const secondCount = await prisma.contactEvidence.count({ where: { contactId: contact.id } });
    expect(secondCount).toBe(firstCount); // no duplicate rows on a genuine no-change re-run

    await prisma.contact.delete({ where: { id: contact.id } });
  });
});
