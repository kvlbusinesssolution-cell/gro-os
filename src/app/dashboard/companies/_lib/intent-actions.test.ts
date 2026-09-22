import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { getCompanyIntentAction, getIntentHistoryAction, getRecommendedActionAction, recalculateIntentAction } from "./intent-actions";

/**
 * Phase 28 (buying intent) — real cross-org/permission-failure test
 * coverage for the intent-score action layer, per lane 5's confirmed gap
 * ("intent-scoring.test.ts only has ONE org fixture, no action-layer test
 * exists at all"). Real local-Postgres integration test, two real
 * Organizations so this is a genuine cross-org check, matching the exact
 * pattern established in enrichment-actions.test.ts (Phase 26).
 */
describe("intent-actions — tenant isolation, permission failure", () => {
  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;
  let companyAId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const orgA = await prisma.organization.create({ data: { name: "Intent Actions Org A", slug: `intent-actions-org-a-${suffix}` } });
    orgAId = orgA.id;
    const orgB = await prisma.organization.create({ data: { name: "Intent Actions Org B", slug: `intent-actions-org-b-${suffix}` } });
    orgBId = orgB.id;

    const userA = await prisma.user.create({ data: { email: `intent-actions-user-a-${suffix}@example.com` } });
    userAId = userA.id;
    const userB = await prisma.user.create({ data: { email: `intent-actions-user-b-${suffix}@example.com` } });
    userBId = userB.id;

    await prisma.membership.create({ data: { userId: userAId, organizationId: orgAId, role: "OWNER", status: "ACTIVE" } });
    await prisma.membership.create({ data: { userId: userBId, organizationId: orgBId, role: "OWNER", status: "ACTIVE" } });

    const companyA = await prisma.company.create({ data: { organizationId: orgAId, name: "Org A Intent Company" } });
    companyAId = companyA.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgAId } });
    await prisma.organization.delete({ where: { id: orgBId } });
    await prisma.user.delete({ where: { id: userAId } });
    await prisma.user.delete({ where: { id: userBId } });
  });

  it("rejects getCompanyIntentAction for a company in a different real organization", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: userBId } } as never);
    const result = await getCompanyIntentAction(companyAId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Company not found."); // no existence leak to the wrong org
  });

  it("rejects getIntentHistoryAction for a company in a different real organization", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: userBId } } as never);
    const result = await getIntentHistoryAction(companyAId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Company not found.");
  });

  it("rejects getRecommendedActionAction for a company in a different real organization", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: userBId } } as never);
    const result = await getRecommendedActionAction(companyAId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Company not found.");
  });

  it("rejects recalculateIntentAction for a company in a different real organization", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: userBId } } as never);
    const result = await recalculateIntentAction(companyAId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Company not found.");
  });

  it("rejects getCompanyIntentAction with no real session — permission failure", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const result = await getCompanyIntentAction(companyAId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("You must be signed in.");
  });

  it("rejects recalculateIntentAction with no real session — permission failure", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const result = await recalculateIntentAction(companyAId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("You must be signed in.");
  });

  it("allows the real owning-org member to read intent for their own company (positive control)", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: userAId } } as never);
    const result = await getCompanyIntentAction(companyAId);
    expect(result.ok).toBe(true); // no IntentScore computed yet, data is honestly null — but the ownership check itself passes
    expect(result.data).toBeNull();
  });
});
