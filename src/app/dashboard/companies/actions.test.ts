import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// actions.ts imports `auth` from "@/auth" at module scope. next-auth's ESM
// build fails to resolve `next/server` under Vitest in this Next.js 16
// environment (a pre-existing, file-independent breakage — see
// opportunity-actions.test.ts's doc comment for the full explanation).
// Mocked here for the same reason, with a real resolved session value per
// test since createCompany has no headless Core split to bypass it with.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// createCompany resolves membership via the shared resolveActiveMembership
// (app/dashboard/_lib/require-membership.ts), which reads the `activeOrgId`
// cookie via next/headers' cookies() to support multi-org users. cookies()
// needs a real Next.js request-scoped store that doesn't exist when calling
// a Server Action directly from Vitest (same class of issue as `auth` and
// revalidatePath above) — mocked to look like no cookie is set, which is
// exactly the single-org-membership case every test below exercises, so
// resolveActiveMembership falls back to the user's only membership.
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { createCompany, updateCompany } from "./actions";

// Real local-Postgres integration test (no mocking of Prisma), same
// convention as opportunity-actions.test.ts. Scoped under two throwaway
// Organizations, deleted in afterAll. Only covers the new `referralPartnerId`
// attribution path added for KVL GrowthOS 2.0 Phase 8's Gap 1 — a full
// createCompany/updateCompany suite is out of this fix's proportionate scope.
describe("companies/actions: referralPartnerId attribution", () => {
  let orgId: string;
  let otherOrgId: string;
  let userId: string;
  let activePartnerId: string;
  let otherOrgPartnerId: string;

  beforeAll(async () => {
    const suffix = Date.now();

    const org = await prisma.organization.create({
      data: { name: "Company Actions Test Org", slug: `company-actions-org-${suffix}` },
    });
    orgId = org.id;

    const otherOrg = await prisma.organization.create({
      data: { name: "Company Actions Other Org", slug: `company-actions-other-org-${suffix}` },
    });
    otherOrgId = otherOrg.id;

    const user = await prisma.user.create({
      data: { name: "Company Actions Test User", email: `company-actions-user-${suffix}@example.com` },
    });
    userId = user.id;

    await prisma.membership.create({
      data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" },
    });

    const activePartner = await prisma.referralPartner.create({
      data: { organizationId: orgId, name: "In-Org Active Partner", status: "ACTIVE" },
    });
    activePartnerId = activePartner.id;

    const otherOrgPartner = await prisma.referralPartner.create({
      data: { organizationId: otherOrgId, name: "Other-Org Partner", status: "ACTIVE" },
    });
    otherOrgPartnerId = otherOrgPartner.id;

    vi.mocked(auth).mockResolvedValue({ user: { id: userId, name: "Company Actions Test User" } } as never);
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.organization.delete({ where: { id: otherOrgId } });

    const remaining = await prisma.company.count({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    expect(remaining).toBe(0);
  });

  it("persists a valid in-org referralPartnerId and sets source to REFERRAL", async () => {
    const result = await createCompany({
      name: "Referred Co",
      status: "PROSPECT",
      referralPartnerId: activePartnerId,
    });

    expect(result.ok).toBe(true);
    expect(result.companyId).toBeTruthy();

    const company = await prisma.company.findUnique({ where: { id: result.companyId! } });
    expect(company?.referralPartnerId).toBe(activePartnerId);
    expect(company?.source).toBe("REFERRAL");
  });

  it("defaults source to MANUAL and referralPartnerId to null when no partner is chosen", async () => {
    const result = await createCompany({ name: "No Partner Co", status: "PROSPECT" });

    expect(result.ok).toBe(true);
    const company = await prisma.company.findUnique({ where: { id: result.companyId! } });
    expect(company?.referralPartnerId).toBeNull();
    expect(company?.source).toBe("MANUAL");
  });

  it("rejects a referralPartnerId belonging to a different organization", async () => {
    const countBefore = await prisma.company.count({ where: { organizationId: orgId } });

    const result = await createCompany({
      name: "Should Not Be Created",
      status: "PROSPECT",
      referralPartnerId: otherOrgPartnerId,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("That referral partner could not be found.");

    const countAfter = await prisma.company.count({ where: { organizationId: orgId } });
    expect(countAfter).toBe(countBefore);
  });

  // Phase 26 (requirement #6/#7, source priority + conflict handling) — a
  // real MANUAL-source CompanyEvidence row must exist for a genuine
  // technologies edit, so a later lower-priority automated scan has
  // something real to check against (see technology-evidence-sync.ts).
  it("records real MANUAL CompanyEvidence when technologies is genuinely changed via updateCompany", async () => {
    const created = await createCompany({ name: "Tech Evidence On Edit Co", status: "PROSPECT" });
    expect(created.ok).toBe(true);
    const companyId = created.companyId!;

    const result = await updateCompany(companyId, {
      name: "Tech Evidence On Edit Co",
      status: "PROSPECT",
      technologies: ["Ruby on Rails", "PostgreSQL"],
    });
    expect(result.ok).toBe(true);

    const evidence = await prisma.companyEvidence.findMany({ where: { companyId, source: "MANUAL", fieldName: "technologies" } });
    expect(evidence.length).toBe(1);
    expect(evidence[0].fact).toContain("Ruby on Rails");
    expect(evidence[0].verificationStatus).toBe("USER_VERIFIED");
  });

  it("does not create duplicate MANUAL evidence when updateCompany is called again with the same technologies", async () => {
    const created = await createCompany({ name: "Tech Evidence No-Change Co", status: "PROSPECT" });
    const companyId = created.companyId!;

    await updateCompany(companyId, { name: "Tech Evidence No-Change Co", status: "PROSPECT", technologies: ["React"] });
    const firstCount = await prisma.companyEvidence.count({ where: { companyId, source: "MANUAL", fieldName: "technologies" } });
    expect(firstCount).toBe(1);

    await updateCompany(companyId, { name: "Tech Evidence No-Change Co", status: "PROSPECT", technologies: ["React"] });
    const secondCount = await prisma.companyEvidence.count({ where: { companyId, source: "MANUAL", fieldName: "technologies" } });
    expect(secondCount).toBe(1); // no new row for a genuinely unchanged value
  });
});
