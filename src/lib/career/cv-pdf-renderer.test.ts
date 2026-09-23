import { describe, expect, it } from "vitest";

import { findUnsupportedCharacters, collectCVText, renderCVToPdf } from "./cv-pdf-renderer";
import type { CVContent } from "@/lib/validations/career-cv";

function makeContent(overrides: Partial<CVContent> = {}): CVContent {
  return {
    personal: { fullName: "Jane Doe", headline: "Software Engineer", email: "jane@example.com", phone: "+1 555 0100", location: "Remote", links: [] },
    summary: "A real professional summary.",
    experience: [{ company: "Acme", role: "Engineer", location: "Remote", startDate: "2022", endDate: "", current: true, bullets: ["Shipped a real feature."] }],
    education: [{ institution: "State University", degree: "B.Sc.", field: "Computer Science", startDate: "2018", endDate: "2022", notes: "" }],
    skills: ["TypeScript", "PostgreSQL"],
    certifications: [],
    languagesSpoken: [],
    projects: [],
    ...overrides,
  };
}

describe("findUnsupportedCharacters — real glyph-coverage check against the actual embedded font", () => {
  it("finds no unsupported characters in real English text", () => {
    expect(findUnsupportedCharacters("Senior Software Engineer at Acme Corp.")).toEqual([]);
  });

  it("finds no unsupported characters in real French/German accented text (Latin Extended)", () => {
    expect(findUnsupportedCharacters("Développeur — Straße München, café résumé")).toEqual([]);
  });

  it("finds no unsupported characters in real Russian (Cyrillic) text", () => {
    expect(findUnsupportedCharacters("Инженер-программист")).toEqual([]);
  });

  it("finds no unsupported characters in real Hindi (Devanagari) text, including conjuncts", () => {
    expect(findUnsupportedCharacters("सॉफ्टवेयर इंजीनियर")).toEqual([]);
  });

  it("honestly reports unsupported characters for real Arabic text (not covered by the embedded font)", () => {
    const result = findUnsupportedCharacters("مهندس برمجيات");
    expect(result.length).toBeGreaterThan(0);
  });

  it("honestly reports unsupported characters for real CJK text (not covered by the embedded font)", () => {
    const result = findUnsupportedCharacters("软件工程师");
    expect(result.length).toBeGreaterThan(0);
  });

  it("never flags whitespace as unsupported", () => {
    expect(findUnsupportedCharacters("a  b\tc\nd")).toEqual([]);
  });
});

describe("collectCVText — flattens every real user-authored string field", () => {
  it("includes personal, summary, experience bullets, education, skills", () => {
    const text = collectCVText(makeContent());
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Shipped a real feature.");
    expect(text).toContain("State University");
    expect(text).toContain("TypeScript");
  });
});

describe("renderCVToPdf — real PDF bytes for every template", () => {
  it("CLASSIC template produces a real, non-empty PDF", async () => {
    const buffer = await renderCVToPdf(makeContent(), "CLASSIC");
    expect(buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("MODERN template produces a real, non-empty PDF", async () => {
    const buffer = await renderCVToPdf(makeContent(), "MODERN");
    expect(buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("MINIMAL template produces a real, non-empty PDF", async () => {
    const buffer = await renderCVToPdf(makeContent(), "MINIMAL");
    expect(buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("renders real Hindi content without throwing", async () => {
    const buffer = await renderCVToPdf(
      makeContent({ personal: { fullName: "राहुल शर्मा", headline: "सॉफ्टवेयर इंजीनियर", email: "rahul@example.com", phone: "", location: "पुणे", links: [] } }),
      "CLASSIC",
    );
    expect(buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });

  it("handles genuinely empty optional sections without throwing", async () => {
    const buffer = await renderCVToPdf(
      { personal: { fullName: "Empty Sections", headline: "", email: "", phone: "", location: "", links: [] }, summary: "", experience: [], education: [], skills: [], certifications: [], languagesSpoken: [], projects: [] },
      "MODERN",
    );
    expect(buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });
});
