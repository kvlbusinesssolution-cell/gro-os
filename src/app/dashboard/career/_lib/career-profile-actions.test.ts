import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Same pre-existing, file-independent Vitest/next-auth ESM breakage
// documented in reply-actions.test.ts / opportunity-actions.test.ts —
// mocked here for the same reason.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { createCareerProfile, updateCareerProfile, setPrimaryCareerProfile, archiveCareerProfile } from "./career-profile-actions";

/**
 * Phase 18 (AI Career Agent Foundation) — real local-Postgres integration
 * test (same convention as reply-automation.test.ts). Covers the
 * spec-critical guarantees: cross-user isolation (§31), preference
 * validation (§16), multi-profile isolation (§6), and atomic primary-switch.
 */
describe("career profile actions", () => {
  let orgId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Career Test Org", slug: `career-test-org-${suffix}` } });
    orgId = org.id;

    const userA = await prisma.user.create({ data: { name: "Career Test User A", email: `career-user-a-${suffix}@example.com` } });
    userAId = userA.id;
    const userB = await prisma.user.create({ data: { name: "Career Test User B", email: `career-user-b-${suffix}@example.com` } });
    userBId = userB.id;

    await prisma.membership.create({ data: { userId: userAId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });
    await prisma.membership.create({ data: { userId: userBId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });
  });

  afterAll(async () => {
    await prisma.careerResume.deleteMany({ where: { careerProfile: { organizationId: orgId } } });
    await prisma.careerProfile.deleteMany({ where: { organizationId: orgId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  function mockSession(userId: string) {
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
  }

  it("creates a profile owned by the real signed-in user, auto-primary on first creation", async () => {
    mockSession(userAId);
    const result = await createCareerProfile({ name: "Senior React Developer" });
    expect(result.ok).toBe(true);
    expect(result.careerProfileId).toBeDefined();

    const profile = await prisma.careerProfile.findUnique({ where: { id: result.careerProfileId } });
    expect(profile?.userId).toBe(userAId);
    expect(profile?.organizationId).toBe(orgId);
    expect(profile?.isPrimary).toBe(true);
  });

  it("keeps multiple profiles for the same user fully isolated — editing one never changes another", async () => {
    mockSession(userAId);
    const p1 = await createCareerProfile({ name: "Full Stack Developer" });
    const p2 = await createCareerProfile({ name: "AI Engineer" });
    expect(p1.careerProfileId).toBeDefined();
    expect(p2.careerProfileId).toBeDefined();

    await updateCareerProfile(p1.careerProfileId!, { name: "Full Stack Developer", currentRole: "Full Stack Lead" });

    const profile1 = await prisma.careerProfile.findUnique({ where: { id: p1.careerProfileId } });
    const profile2 = await prisma.careerProfile.findUnique({ where: { id: p2.careerProfileId } });
    expect(profile1?.currentRole).toBe("Full Stack Lead");
    expect(profile2?.currentRole).toBeNull(); // untouched by profile 1's edit
  });

  it("rejects a real cross-user access attempt — User B cannot update User A's profile", async () => {
    mockSession(userAId);
    const created = await createCareerProfile({ name: "User A's Private Profile" });

    mockSession(userBId);
    const result = await updateCareerProfile(created.careerProfileId!, { name: "Hijacked" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Career profile not found."); // same 404-style response an IDOR probe should get, never "not authorized"

    const stillOriginal = await prisma.careerProfile.findUnique({ where: { id: created.careerProfileId } });
    expect(stillOriginal?.name).toBe("User A's Private Profile");
  });

  it("rejects salaryMin > salaryMax — never silently corrects it", async () => {
    mockSession(userAId);
    const created = await createCareerProfile({ name: "Salary Test Profile" });
    const result = await updateCareerProfile(created.careerProfileId!, {
      name: "Salary Test Profile",
      salaryMin: 200000,
      salaryMax: 100000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("salary");
  });

  it("atomically switches primary — exactly one profile is ever primary for a user", async () => {
    mockSession(userAId);
    const allProfiles = await prisma.careerProfile.findMany({ where: { userId: userAId, organizationId: orgId } });
    const target = allProfiles[allProfiles.length - 1];

    await setPrimaryCareerProfile(target.id);

    const afterSwitch = await prisma.careerProfile.findMany({ where: { userId: userAId, organizationId: orgId, status: "ACTIVE" } });
    const primaryCount = afterSwitch.filter((p) => p.isPrimary).length;
    expect(primaryCount).toBe(1);
    expect(afterSwitch.find((p) => p.id === target.id)?.isPrimary).toBe(true);
  });

  it("archiving a profile removes it from active listing without deleting real data", async () => {
    mockSession(userAId);
    const created = await createCareerProfile({ name: "To Be Archived" });
    await archiveCareerProfile(created.careerProfileId!);

    const archived = await prisma.careerProfile.findUnique({ where: { id: created.careerProfileId } });
    expect(archived?.status).toBe("ARCHIVED");
    expect(archived).not.toBeNull(); // real row preserved, not deleted
  });
});
