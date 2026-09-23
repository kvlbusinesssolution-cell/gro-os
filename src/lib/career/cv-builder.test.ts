import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createCV, updateCV, deleteCV, listCVs, requireOwnedCV, generateCVPdf, translateCV, getCVPdfBuffer } from "./cv-builder";
import type { CVContent } from "@/lib/validations/career-cv";

function makeContent(overrides: Partial<CVContent> = {}): CVContent {
  return {
    personal: { fullName: "Jane Doe", headline: "Engineer", email: "jane@example.com", phone: "", location: "Remote", links: [] },
    summary: "A real summary.",
    experience: [],
    education: [],
    skills: ["TypeScript"],
    certifications: [],
    languagesSpoken: [],
    projects: [],
    ...overrides,
  };
}

describe("cv-builder — Phase 35 real CV CRUD, generation, and translation", () => {
  let organizationId: string;
  let userId: string;
  let careerProfileId: string;
  let otherCareerProfileId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "CV Builder Test Org", slug: `cv-builder-org-${suffix}` } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { name: "CV Builder Test User", email: `cv-builder-user-${suffix}@example.com` } });
    userId = user.id;
    const profile = await prisma.careerProfile.create({ data: { userId, organizationId, name: "Profile A" } });
    careerProfileId = profile.id;
    const otherProfile = await prisma.careerProfile.create({ data: { userId, organizationId, name: "Profile B" } });
    otherCareerProfileId = otherProfile.id;
  });

  afterAll(async () => {
    await prisma.careerCV.deleteMany({ where: { careerProfileId: { in: [careerProfileId, otherCareerProfileId] } } });
    await prisma.careerProfile.deleteMany({ where: { id: { in: [careerProfileId, otherCareerProfileId] } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("createCV + listCVs — real row created and listed, scoped to its own careerProfileId", async () => {
    const cv = await createCV({ careerProfileId, title: "Engineer CV", language: "en", templateKey: "CLASSIC", content: makeContent() });
    expect(cv.id).toBeTruthy();
    expect(cv.storageKey).toBeNull();

    const list = await listCVs(careerProfileId);
    expect(list.some((c) => c.id === cv.id)).toBe(true);

    const otherList = await listCVs(otherCareerProfileId);
    expect(otherList.some((c) => c.id === cv.id)).toBe(false);
  });

  it("requireOwnedCV — throws for a real CV that belongs to a DIFFERENT careerProfileId (never leaks across profiles)", async () => {
    const cv = await createCV({ careerProfileId, title: "Isolation CV", language: "en", templateKey: "CLASSIC", content: makeContent() });
    await expect(requireOwnedCV(cv.id, otherCareerProfileId)).rejects.toThrow("CV not found.");
    await expect(requireOwnedCV(cv.id, careerProfileId)).resolves.toMatchObject({ id: cv.id });
  });

  it("updateCV — real content update clears a stale generated PDF (storageKey/generatedAt reset)", async () => {
    const cv = await createCV({ careerProfileId, title: "Update CV", language: "en", templateKey: "CLASSIC", content: makeContent() });
    const generated = await generateCVPdf(cv.id, careerProfileId);
    expect(generated.ok).toBe(true);

    const updated = await updateCV(cv.id, careerProfileId, { content: makeContent({ summary: "Changed." }) });
    expect(updated.storageKey).toBeNull();
    expect(updated.generatedAt).toBeNull();
  });

  it("deleteCV — real row removed, requireOwnedCV then throws", async () => {
    const cv = await createCV({ careerProfileId, title: "Delete CV", language: "en", templateKey: "CLASSIC", content: makeContent() });
    await deleteCV(cv.id, careerProfileId);
    await expect(requireOwnedCV(cv.id, careerProfileId)).rejects.toThrow();
  });

  it("generateCVPdf — real success path stores a real PDF and stamps storageKey/generatedAt", async () => {
    const cv = await createCV({ careerProfileId, title: "PDF CV", language: "en", templateKey: "MODERN", content: makeContent() });
    const result = await generateCVPdf(cv.id, careerProfileId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");

    const stored = await getCVPdfBuffer(result.storageKey);
    expect(stored.equals(result.buffer)).toBe(true);

    const row = await prisma.careerCV.findUnique({ where: { id: cv.id } });
    expect(row!.storageKey).toBe(result.storageKey);
    expect(row!.generatedAt).not.toBeNull();
  });

  it("generateCVPdf — honestly refuses content with real unsupported characters instead of silently producing a broken PDF", async () => {
    const cv = await createCV({
      careerProfileId,
      title: "Arabic CV",
      language: "en",
      templateKey: "CLASSIC",
      content: makeContent({ summary: "مهندس برمجيات" }),
    });
    const result = await generateCVPdf(cv.id, careerProfileId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.unsupportedCharacters!.length).toBeGreaterThan(0);

    const row = await prisma.careerCV.findUnique({ where: { id: cv.id } });
    expect(row!.storageKey).toBeNull();
  });

  it("translateCV — cross-profile isolation: cannot translate a CV belonging to a different careerProfileId", async () => {
    const cv = await createCV({ careerProfileId, title: "Isolation Translate Source", language: "en", templateKey: "CLASSIC", content: makeContent() });
    await expect(translateCV(cv.id, otherCareerProfileId, "es", organizationId)).rejects.toThrow("CV not found.");
  });
});
