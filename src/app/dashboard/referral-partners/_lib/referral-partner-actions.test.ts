import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// referral-partner-actions.ts imports `auth` from "@/auth" at module scope
// for its session-gated wrappers (activateReferralPartner/
// markPartnerCommissionPaid/createReferralPartner). next-auth's ESM build
// fails to resolve `next/server` under Vitest in this Next.js 16
// environment (a pre-existing, file-independent breakage — see
// opportunity-actions.test.ts's doc comment for the full explanation).
// Mocked here for the same reason, but given a real resolved value in the
// role-gating tests below (the one place in this file that exercises a
// session-gated wrapper rather than a headless *Core function).
vi.mock("@/auth", () => ({ auth: vi.fn() }));

// revalidatePath() needs a Next.js request-scoped static-generation store
// that only exists inside a real request/action invocation; stubbed for the
// same reason as opportunity-actions.test.ts.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { createReferralPartner, createReferralPartnerCore } from "./referral-partner-actions";

// Real local-Postgres integration test (no mocking of Prisma), same
// convention as opportunity-actions.test.ts. Everything is scoped under two
// throwaway Organizations created here and deleted in afterAll (cascades to
// Membership/ReferralPartner).
describe("referral-partner-actions", () => {
  let orgId: string;
  let otherOrgId: string;
  let userId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Referral Partner Actions Test Org", slug: `rp-actions-org-${suffix}` },
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.create({
      data: { name: "Referral Partner Actions Other Org", slug: `rp-actions-other-org-${suffix}` },
    });
    otherOrgId = otherOrg.id;

    const user = await prisma.user.create({
      data: { name: "Referral Partner Test User", email: `rp-actions-user-${suffix}@example.com` },
    });
    userId = user.id;

    await prisma.membership.create({
      data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" },
    });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: otherOrgId } });

    const remaining = await prisma.referralPartner.count({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    expect(remaining).toBe(0);
  });

  it("createReferralPartnerCore: happy path creates an ACTIVE partner with discoverySource 'Manually added'", async () => {
    const result = await createReferralPartnerCore(orgId, userId, {
      name: "Acme Freelance Co",
      type: "FREELANCER",
      email: "hi@acmefreelance.example",
      website: "https://acmefreelance.example",
      commissionRatePercent: 15,
    });

    expect(result.ok).toBe(true);
    expect(result.partnerId).toBeTruthy();

    const partner = await prisma.referralPartner.findUnique({ where: { id: result.partnerId! } });
    expect(partner).not.toBeNull();
    expect(partner?.organizationId).toBe(orgId);
    expect(partner?.status).toBe("ACTIVE");
    expect(partner?.discoverySource).toBe("Manually added");
    expect(partner?.type).toBe("FREELANCER");
    expect(partner?.email).toBe("hi@acmefreelance.example");
    expect(partner?.commissionRatePercent).toBe(15);
    expect(partner?.createdByUserId).toBe(userId);
  });

  it("createReferralPartnerCore: defaults commissionRatePercent to 10 when not provided", async () => {
    const result = await createReferralPartnerCore(orgId, userId, { name: "Default Rate Partner" });
    expect(result.ok).toBe(true);

    const partner = await prisma.referralPartner.findUnique({ where: { id: result.partnerId! } });
    expect(partner?.commissionRatePercent).toBe(10);
    expect(partner?.type).toBeNull();
  });

  it("createReferralPartnerCore: rejects an empty name and creates no row", async () => {
    const countBefore = await prisma.referralPartner.count({ where: { organizationId: orgId } });

    const result = await createReferralPartnerCore(orgId, userId, { name: "   " });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();

    const countAfter = await prisma.referralPartner.count({ where: { organizationId: orgId } });
    expect(countAfter).toBe(countBefore);
  });

  it("createReferralPartnerCore: never leaks a created partner into another organization", async () => {
    const result = await createReferralPartnerCore(orgId, userId, { name: "Org-Scoped Partner" });
    expect(result.ok).toBe(true);

    const partner = await prisma.referralPartner.findUnique({ where: { id: result.partnerId! } });
    expect(partner?.organizationId).toBe(orgId);
    expect(partner?.organizationId).not.toBe(otherOrgId);

    const otherOrgCount = await prisma.referralPartner.count({ where: { organizationId: otherOrgId } });
    expect(otherOrgCount).toBe(0);
  });

  it("createReferralPartner: role-gates non-OWNER/ADMIN members out", async () => {
    const suffix = Date.now();
    const memberUser = await prisma.user.create({
      data: { name: "Regular Member", email: `rp-actions-member-${suffix}@example.com` },
    });
    await prisma.membership.create({
      data: { userId: memberUser.id, organizationId: orgId, role: "VIEWER", status: "ACTIVE" },
    });

    vi.mocked(auth).mockResolvedValue({ user: { id: memberUser.id } } as never);

    const countBefore = await prisma.referralPartner.count({ where: { organizationId: orgId } });
    const result = await createReferralPartner({ name: "Should Not Be Created" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Only owners and admins can add a referral partner.");

    const countAfter = await prisma.referralPartner.count({ where: { organizationId: orgId } });
    expect(countAfter).toBe(countBefore);
  });

  it("createReferralPartner: an OWNER can add a partner through the session-gated wrapper", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);

    const result = await createReferralPartner({ name: "Wrapper Happy Path Partner" });

    expect(result.ok).toBe(true);
    expect(result.partnerId).toBeTruthy();

    const partner = await prisma.referralPartner.findUnique({ where: { id: result.partnerId! } });
    expect(partner?.organizationId).toBe(orgId);
    expect(partner?.status).toBe("ACTIVE");
    expect(partner?.discoverySource).toBe("Manually added");
  });
});
