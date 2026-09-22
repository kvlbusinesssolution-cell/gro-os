import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Same real reason as actions.test.ts — auth()/cookies() need a real
// Next.js request-scoped context that doesn't exist calling a Server
// Action directly from Vitest.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { enrichCompanyAction, enrichContactAction, batchEnrichCompaniesAction } from "./enrichment-actions";

/**
 * Phase 26 (P2 — real cross-org/permission-failure/large-batch test
 * coverage for the manual enrichment trigger path, per lane 5's gap list).
 * Real local-Postgres integration test, two real Organizations so tenant
 * isolation is a genuine cross-org check, not just same-org wrong-record.
 */
describe("enrichment-actions — tenant isolation, permission, large batch", () => {
  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;
  let companyAId: string;
  let contactAId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const orgA = await prisma.organization.create({ data: { name: "Enrich Actions Org A", slug: `enrich-actions-org-a-${suffix}` } });
    orgAId = orgA.id;
    const orgB = await prisma.organization.create({ data: { name: "Enrich Actions Org B", slug: `enrich-actions-org-b-${suffix}` } });
    orgBId = orgB.id;

    const userA = await prisma.user.create({ data: { email: `enrich-actions-user-a-${suffix}@example.com` } });
    userAId = userA.id;
    const userB = await prisma.user.create({ data: { email: `enrich-actions-user-b-${suffix}@example.com` } });
    userBId = userB.id;

    await prisma.membership.create({ data: { userId: userAId, organizationId: orgAId, role: "OWNER", status: "ACTIVE" } });
    await prisma.membership.create({ data: { userId: userBId, organizationId: orgBId, role: "OWNER", status: "ACTIVE" } });

    const companyA = await prisma.company.create({ data: { organizationId: orgAId, name: "Org A Real Company" } });
    companyAId = companyA.id;
    const contactA = await prisma.contact.create({ data: { organizationId: orgAId, firstName: "Org", lastName: "A Contact", email: `org-a-contact-${suffix}@example.com` } });
    contactAId = contactA.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgAId } });
    await prisma.organization.delete({ where: { id: orgBId } });
    await prisma.user.delete({ where: { id: userAId } });
    await prisma.user.delete({ where: { id: userBId } });
  });

  it("rejects enrichCompanyAction for a company in a different real organization", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: userBId } } as never);
    const result = await enrichCompanyAction(companyAId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Company not found."); // no existence leak to the wrong org
  });

  it("rejects enrichContactAction for a contact in a different real organization", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: userBId } } as never);
    const result = await enrichContactAction(contactAId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Contact not found.");
  });

  it("rejects enrichCompanyAction with no real session — permission failure", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const result = await enrichCompanyAction(companyAId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("You must be signed in.");
  });

  it("rejects batchEnrichCompaniesAction when the batch exceeds the real 20-company cap", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: userAId } } as never);
    const oversizedBatch = Array.from({ length: 21 }, (_, i) => `fake-id-${i}`);
    const result = await batchEnrichCompaniesAction(oversizedBatch);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Batch limited to 20 companies at a time.");
  });

  it("rejects batchEnrichCompaniesAction when any id in the batch belongs to a different real organization", async () => {
    const companyB = await prisma.company.create({ data: { organizationId: orgBId, name: "Org B Real Company" } });
    vi.mocked(auth).mockResolvedValue({ user: { id: userAId } } as never);
    const result = await batchEnrichCompaniesAction([companyAId, companyB.id]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("One or more companies not found in your organization.");
    await prisma.company.delete({ where: { id: companyB.id } });
  });
});
