import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Deterministic, offline test — same rationale as
// recruiter-communication-orchestrator.test.ts: exercises the REAL honest
// "AI not connected" path rather than depending on live provider state.
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return { ...actual, isAIConnected: () => false };
});

import { prisma } from "@/lib/prisma";
import { createCV, translateCV } from "./cv-builder";
import type { CVContent } from "@/lib/validations/career-cv";

const CONTENT: CVContent = {
  personal: { fullName: "Jane Doe", headline: "Engineer", email: "jane@example.com", phone: "", location: "Remote", links: [] },
  summary: "A real summary.",
  experience: [],
  education: [],
  skills: ["TypeScript"],
  certifications: [],
  languagesSpoken: [],
  projects: [],
};

describe("translateCV — Phase 35 real honest degradation when AI is unavailable", () => {
  let organizationId: string;
  let careerProfileId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    const org = await prisma.organization.create({ data: { name: "CV Translate Test Org", slug: `cv-translate-org-${suffix}` } });
    organizationId = org.id;
    const user = await prisma.user.create({ data: { name: "CV Translate Test User", email: `cv-translate-user-${suffix}@example.com` } });
    const profile = await prisma.careerProfile.create({ data: { userId: user.id, organizationId, name: "Profile" } });
    careerProfileId = profile.id;
  });

  afterAll(async () => {
    await prisma.careerCV.deleteMany({ where: { careerProfileId } });
    await prisma.careerProfile.deleteMany({ where: { id: careerProfileId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("never fabricates a translation — returns a real, honest error and creates no new CV row", async () => {
    const cv = await createCV({ careerProfileId, title: "Translate Source", language: "en", templateKey: "CLASSIC", content: CONTENT });

    const before = (await prisma.careerCV.count({ where: { careerProfileId } }));
    const result = await translateCV(cv.id, careerProfileId, "es", organizationId);
    const after = await prisma.careerCV.count({ where: { careerProfileId } });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/AI translation is temporarily unavailable/);
    expect(after).toBe(before);
  });
});
