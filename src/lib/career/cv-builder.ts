import { prisma } from "@/lib/prisma";
import { createFileStore } from "@/lib/storage/file-store";
import { generateStructured } from "@/lib/ai/fallback";
import { isAIConnected } from "@/lib/ai/client";
import { recordAIUsage } from "@/lib/billing/ai-credits";
import { cvContentSchema, cvLanguageLabel, type CVContent, type CVTemplate } from "@/lib/validations/career-cv";
import { findUnsupportedCharacters, collectCVText, renderCVToPdf } from "./cv-pdf-renderer";
import type { CareerCV, Prisma } from "@/generated/prisma/client";

const store = createFileStore("career-cvs");

/** Org-scoped through the owning CareerProfile — a CareerCV has no organizationId of its own (career data is user-owned, same discipline as CareerProfile itself). */
export async function requireOwnedCV(cvId: string, careerProfileId: string): Promise<CareerCV> {
  const cv = await prisma.careerCV.findFirst({ where: { id: cvId, careerProfileId } });
  if (!cv) throw new Error("CV not found.");
  return cv;
}

export async function listCVs(careerProfileId: string): Promise<CareerCV[]> {
  return prisma.careerCV.findMany({ where: { careerProfileId }, orderBy: { updatedAt: "desc" } });
}

export async function createCV(input: {
  careerProfileId: string;
  title: string;
  language: string;
  templateKey: CVTemplate;
  content: CVContent;
}): Promise<CareerCV> {
  return prisma.careerCV.create({
    data: {
      careerProfileId: input.careerProfileId,
      title: input.title,
      language: input.language,
      templateKey: input.templateKey,
      content: input.content as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function updateCV(
  cvId: string,
  careerProfileId: string,
  input: { title?: string; language?: string; templateKey?: CVTemplate; content?: CVContent },
): Promise<CareerCV> {
  await requireOwnedCV(cvId, careerProfileId);
  return prisma.careerCV.update({
    where: { id: cvId },
    data: {
      title: input.title,
      language: input.language,
      templateKey: input.templateKey,
      content: input.content ? (input.content as unknown as Prisma.InputJsonValue) : undefined,
      // Editing content by hand after a translation invalidates the
      // "AI-translated from X" provenance claim — the CV is now a real,
      // manually-authored mix, so it must stop being labeled as a pure
      // translation.
      translatedFromId: input.content ? null : undefined,
      // A stale PDF from before this edit must never be served as current.
      storageKey: input.content || input.title || input.language || input.templateKey ? null : undefined,
      generatedAt: input.content || input.title || input.language || input.templateKey ? null : undefined,
    },
  });
}

export async function deleteCV(cvId: string, careerProfileId: string): Promise<void> {
  const cv = await requireOwnedCV(cvId, careerProfileId);
  if (cv.storageKey) {
    try {
      await store.remove(cv.storageKey);
    } catch (error) {
      console.error(`[cv-builder] failed to delete stored PDF for CV ${cvId} (continuing with row delete):`, error);
    }
  }
  await prisma.careerCV.delete({ where: { id: cvId } });
}

export interface GenerateCVPdfResult {
  ok: true;
  storageKey: string;
  buffer: Buffer;
}
export interface GenerateCVPdfError {
  ok: false;
  error: string;
  unsupportedCharacters?: string[];
}

/**
 * Real PDF generation — validates every character in the content against
 * the actual embedded font's glyph coverage FIRST (§ cv-pdf-renderer.ts),
 * returning an honest, actionable error naming the specific unsupported
 * characters rather than silently emitting missing-glyph boxes.
 */
export async function generateCVPdf(cvId: string, careerProfileId: string): Promise<GenerateCVPdfResult | GenerateCVPdfError> {
  const cv = await requireOwnedCV(cvId, careerProfileId);
  const parsed = cvContentSchema.safeParse(cv.content);
  if (!parsed.success) return { ok: false, error: "This CV's saved content is invalid — please re-save it from the editor." };

  const unsupported = findUnsupportedCharacters(collectCVText(parsed.data));
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: `This CV contains characters the PDF renderer cannot display correctly: ${unsupported.slice(0, 20).join(" ")}${unsupported.length > 20 ? "…" : ""}. Remove them or choose a supported language.`,
      unsupportedCharacters: unsupported,
    };
  }

  const buffer = await renderCVToPdf(parsed.data, cv.templateKey);
  const storageKey = await store.save(careerProfileId, cvId, "cv.pdf", buffer);

  await prisma.careerCV.update({ where: { id: cvId }, data: { storageKey, generatedAt: new Date() } });

  return { ok: true, storageKey, buffer };
}

export async function getCVPdfBuffer(storageKey: string): Promise<Buffer> {
  return store.read(storageKey);
}

const TRANSLATION_SYSTEM_PROMPT = `You translate a real job candidate's CV/resume content into a target language, preserving
its exact real-world meaning — never inventing, embellishing, or omitting any real fact from the source.

Translate: headline, summary, job titles/roles, bullet points, degree/field of study, notes, skill names,
language-proficiency labels, and project descriptions.

NEVER translate or alter: person names, company/institution names, email addresses, phone numbers, URLs,
dates, and location names that are proper nouns (translate a well-known place name into its standard
target-language form only if one genuinely exists, e.g. "Germany" -> "Allemagne" in French; otherwise leave
it as written).

Preserve the exact same structure (same number of experience/education/certification/project/language
entries, same field names) — you are translating text in place, not rewriting or restructuring the CV.`;

export interface TranslateCVResult {
  ok: true;
  cv: CareerCV;
}
export interface TranslateCVError {
  ok: false;
  error: string;
}

/**
 * Real AI translation into a new CareerCV row (never overwrites the
 * source) — honestly returns an error when no AI provider is connected,
 * exactly like every other AI-backed feature in this app (§ AINotConnected
 * discipline); never fabricates a translation by e.g. echoing the source
 * text unchanged.
 */
export async function translateCV(sourceCvId: string, careerProfileId: string, targetLanguage: string, organizationId: string): Promise<TranslateCVResult | TranslateCVError> {
  const source = await requireOwnedCV(sourceCvId, careerProfileId);
  const parsed = cvContentSchema.safeParse(source.content);
  if (!parsed.success) return { ok: false, error: "This CV's saved content is invalid — please re-save it from the editor before translating." };

  if (!isAIConnected()) return { ok: false, error: "AI translation is temporarily unavailable — no AI provider is currently connected. Please try again shortly." };

  const result = await generateStructured({
    system: TRANSLATION_SYSTEM_PROMPT,
    userContent: `Translate this CV content (JSON) into ${cvLanguageLabel(targetLanguage)}:\n\n${JSON.stringify(parsed.data)}`,
    maxTokens: 4096,
    effort: "medium",
    schema: cvContentSchema,
  });

  await recordAIUsage(organizationId, result.provider, result.model, result.inputTokens, result.outputTokens, "career:cv-translation");

  const unsupported = findUnsupportedCharacters(collectCVText(result.parsed));
  if (unsupported.length > 0) {
    return { ok: false, error: `The AI translation produced characters this app's PDF renderer cannot display: ${unsupported.slice(0, 20).join(" ")}. Translation was not saved.` };
  }

  const cv = await prisma.careerCV.create({
    data: {
      careerProfileId,
      title: `${source.title} (${cvLanguageLabel(targetLanguage)})`,
      language: targetLanguage,
      templateKey: source.templateKey,
      content: result.parsed as unknown as Prisma.InputJsonValue,
      translatedFromId: source.id,
    },
  });

  return { ok: true, cv };
}
