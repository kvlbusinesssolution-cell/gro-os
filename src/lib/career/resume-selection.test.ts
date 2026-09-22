import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { selectResumeForApplication } from "./resume-selection";

describe("selectResumeForApplication — §8 real, explainable selection", () => {
  let profileId: string;
  let orgId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "Resume Selection Test Org", slug: `resume-sel-org-${suffix}` } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { name: "Resume Selection Test User", email: `resume-sel-${suffix}@example.com` } });
    const profile = await prisma.careerProfile.create({ data: { userId: user.id, organizationId: orgId, name: "Resume Selection Test Profile" } });
    profileId = profile.id;
  });

  afterAll(async () => {
    await prisma.careerResume.deleteMany({ where: { careerProfileId: profileId } });
    await prisma.careerProfile.deleteMany({ where: { id: profileId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  });

  it("returns null with a real, honest reason when no processed resume exists", async () => {
    const result = await selectResumeForApplication(profileId, ["React"]);
    expect(result.resumeId).toBeNull();
    expect(result.reason).toContain("No processed resume");
  });

  it("prefers a VERIFIED resume over a newer PROCESSED one — real confidence ranking, not just latest version", async () => {
    const older = await prisma.careerResume.create({
      data: { careerProfileId: profileId, version: 1, originalFilename: "v1.pdf", mimeType: "application/pdf", sizeBytes: 100, checksum: "c1", storageKey: "k1", status: "VERIFIED" },
    });
    await prisma.careerResume.create({
      data: { careerProfileId: profileId, version: 2, originalFilename: "v2.pdf", mimeType: "application/pdf", sizeBytes: 100, checksum: "c2", storageKey: "k2", status: "PROCESSED" },
    });

    const result = await selectResumeForApplication(profileId, []);
    expect(result.resumeId).toBe(older.id);
  });

  it("explains its choice with real skill overlap against the job's required technologies", async () => {
    await prisma.careerResume.deleteMany({ where: { careerProfileId: profileId } });
    await prisma.careerResume.create({
      data: {
        careerProfileId: profileId,
        version: 1,
        originalFilename: "final.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        checksum: "c3",
        storageKey: "k3",
        status: "VERIFIED",
        aiExtractedProfile: { skills: [{ name: "React" }, { name: "TypeScript" }] },
      },
    });

    const result = await selectResumeForApplication(profileId, ["React", "GraphQL"]);
    expect(result.reason).toContain("React");
  });
});
