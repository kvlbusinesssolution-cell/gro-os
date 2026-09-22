import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { createCareerProfile } from "./career-profile-actions";
import { uploadCareerResume, deleteCareerResumeVersion } from "./career-resume-actions";

/**
 * Phase 18 (AI Career Agent Foundation) — real local-Postgres integration
 * test covering §7/§8/§9/§22/§25: real upload creates a real new version
 * every time, never overwrites; a byte-identical re-upload is detected as
 * a real duplicate (never a second processing job); an empty file fails
 * honestly rather than fabricating extracted content.
 */
describe("career resume actions", () => {
  let orgId: string;
  let userId: string;
  let careerProfileId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Career Resume Test Org", slug: `career-resume-org-${suffix}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { name: "Career Resume Test User", email: `career-resume-user-${suffix}@example.com` } });
    userId = user.id;
    await prisma.membership.create({ data: { userId, organizationId: orgId, role: "OWNER", status: "ACTIVE" } });

    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);

    const profile = await createCareerProfile({ name: "Resume Upload Test Profile" });
    careerProfileId = profile.careerProfileId!;
  });

  afterAll(async () => {
    await prisma.careerResume.deleteMany({ where: { careerProfileId } });
    await prisma.careerProfile.deleteMany({ where: { organizationId: orgId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  function makeTxtFile(content: string, name = "resume.txt"): File {
    return new File([content], name, { type: "text/plain" });
  }

  it("creates real version 1 on first upload, with real extracted text", async () => {
    const result = await uploadCareerResume(careerProfileId, makeTxtFile("Jane Doe\nSenior Engineer\n5 years experience."));
    expect(result.ok).toBe(true);
    expect(result.careerResumeId).toBeDefined();

    const resume = await prisma.careerResume.findUnique({ where: { id: result.careerResumeId } });
    expect(resume?.version).toBe(1);
    expect(resume?.extractedText).toContain("Jane Doe");
    expect(resume?.status).not.toBe("UPLOADED"); // real pipeline advanced past the initial state
  });

  it("creates a real new version on a second, different upload — never overwrites version 1", async () => {
    const result = await uploadCareerResume(careerProfileId, makeTxtFile("Jane Doe\nStaff Engineer\n7 years experience."));
    expect(result.ok).toBe(true);

    const resume = await prisma.careerResume.findUnique({ where: { id: result.careerResumeId } });
    expect(resume?.version).toBe(2);

    const allVersions = await prisma.careerResume.findMany({ where: { careerProfileId }, orderBy: { version: "asc" } });
    expect(allVersions.length).toBe(2);
    expect(allVersions[0].extractedText).toContain("Senior Engineer"); // v1 untouched
    expect(allVersions[1].extractedText).toContain("Staff Engineer");
  });

  it("detects a real byte-identical duplicate upload and does not create a new version", async () => {
    const countBefore = await prisma.careerResume.count({ where: { careerProfileId } });
    const result = await uploadCareerResume(careerProfileId, makeTxtFile("Jane Doe\nStaff Engineer\n7 years experience.")); // identical to version 2
    expect(result.ok).toBe(true);
    expect(result.duplicateOfVersion).toBe(2);

    const countAfter = await prisma.careerResume.count({ where: { careerProfileId } });
    expect(countAfter).toBe(countBefore); // no new row created
  });

  it("fails honestly on an empty file rather than fabricating extracted content", async () => {
    const result = await uploadCareerResume(careerProfileId, makeTxtFile(""));
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("deletes exactly the targeted version, leaving other real versions intact", async () => {
    const allVersions = await prisma.careerResume.findMany({ where: { careerProfileId }, orderBy: { version: "asc" } });
    const v1 = allVersions[0];

    const result = await deleteCareerResumeVersion(careerProfileId, v1.id);
    expect(result.ok).toBe(true);

    const remaining = await prisma.careerResume.findMany({ where: { careerProfileId } });
    expect(remaining.find((r) => r.id === v1.id)).toBeUndefined();
    expect(remaining.length).toBe(allVersions.length - 1);
  });
});
