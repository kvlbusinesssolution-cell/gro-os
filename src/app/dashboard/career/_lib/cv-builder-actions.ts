"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { createCV, updateCV, deleteCV, listCVs, generateCVPdf, translateCV, requireOwnedCV } from "@/lib/career/cv-builder";
import { createCVSchema, updateCVSchema, translateCVSchema, cvContentSchema } from "@/lib/validations/career-cv";
import type { CareerCV } from "@/generated/prisma/client";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

async function resolveOwnedProfile(userId: string, organizationId: string, careerProfileId: string) {
  const profile = await prisma.careerProfile.findUnique({ where: { id: careerProfileId } });
  if (!profile || profile.userId !== userId || profile.organizationId !== organizationId) return null;
  return profile;
}

export interface ListCVsResult extends ActionResult {
  cvs?: CareerCV[];
}

export async function listCVsAction(careerProfileId: string): Promise<ListCVsResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  const cvs = await listCVs(careerProfileId);
  return { ok: true, cvs };
}

/** Profile links (career.ts validation) never require a protocol — falls back to prefixing https:// before parsing, and to the raw string if it's still not a valid URL, rather than throwing. */
function urlHostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    try {
      return new URL(`https://${url}`).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }
}

/** Real starting point for a new CV — pre-fills from the profile's own real, already-collected structured data (never fabricated), never auto-saved: the user still reviews/edits and explicitly creates. */
export async function prefillCVFromProfileAction(careerProfileId: string): Promise<ActionResult & { content?: unknown }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  const content = cvContentSchema.parse({
    personal: {
      fullName: session.user?.name ?? "",
      headline: profile.currentRole ?? "",
      email: session.user?.email ?? "",
      location: profile.location ?? "",
      links: [profile.portfolioUrl, profile.githubUrl, profile.linkedinUrl, profile.websiteUrl]
        .filter((url): url is string => Boolean(url))
        .map((url) => ({ label: urlHostnameLabel(url), url })),
    },
    experience: [],
    education: Array.isArray(profile.education) ? profile.education : [],
    skills: Array.isArray(profile.skills) ? (profile.skills as unknown[]).filter((s): s is string => typeof s === "string") : [],
    certifications: Array.isArray(profile.certifications) ? profile.certifications : [],
    projects: Array.isArray(profile.projects) ? profile.projects : [],
  });

  return { ok: true, content };
}

export interface CreateCVResult extends ActionResult {
  cvId?: string;
}

export async function createCVAction(input: unknown): Promise<CreateCVResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = createCVSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the CV details." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, parsed.data.careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  const cv = await createCV(parsed.data);
  await logAudit({ userId, organizationId: membership.organizationId, action: "career.cv_created", metadata: { careerProfileId: profile.id, cvId: cv.id, language: cv.language, templateKey: cv.templateKey } });

  revalidatePath(`/dashboard/career/cv-builder`);
  return { ok: true, cvId: cv.id };
}

export async function updateCVAction(careerProfileId: string, cvId: string, input: unknown): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = updateCVSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the CV details." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  try {
    await updateCV(cvId, careerProfileId, parsed.data);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update this CV." };
  }

  await logAudit({ userId, organizationId: membership.organizationId, action: "career.cv_updated", metadata: { careerProfileId, cvId } });
  revalidatePath(`/dashboard/career/cv-builder`);
  return { ok: true };
}

export async function deleteCVAction(careerProfileId: string, cvId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  try {
    await deleteCV(cvId, careerProfileId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not delete this CV." };
  }

  await logAudit({ userId, organizationId: membership.organizationId, action: "career.cv_deleted", metadata: { careerProfileId, cvId } });
  revalidatePath(`/dashboard/career/cv-builder`);
  return { ok: true };
}

export interface GenerateCVResult extends ActionResult {
  storageKey?: string;
  unsupportedCharacters?: string[];
}

export async function generateCVPdfAction(careerProfileId: string, cvId: string): Promise<GenerateCVResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  const result = await generateCVPdf(cvId, careerProfileId);
  if (!result.ok) return { ok: false, error: result.error, unsupportedCharacters: result.unsupportedCharacters };

  await logAudit({ userId, organizationId: membership.organizationId, action: "career.cv_pdf_generated", metadata: { careerProfileId, cvId } });
  revalidatePath(`/dashboard/career/cv-builder`);
  return { ok: true, storageKey: result.storageKey };
}

export interface TranslateCVResultAction extends ActionResult {
  cvId?: string;
}

export async function translateCVAction(careerProfileId: string, cvId: string, input: unknown): Promise<TranslateCVResultAction> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = translateCVSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please choose a supported target language." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  const result = await translateCV(cvId, careerProfileId, parsed.data.targetLanguage, membership.organizationId);
  if (!result.ok) return { ok: false, error: result.error };

  await logAudit({ userId, organizationId: membership.organizationId, action: "career.cv_translated", metadata: { careerProfileId, sourceCvId: cvId, newCvId: result.cv.id, targetLanguage: parsed.data.targetLanguage } });
  revalidatePath(`/dashboard/career/cv-builder`);
  return { ok: true, cvId: result.cv.id };
}

export async function getOwnedCVAction(careerProfileId: string, cvId: string): Promise<ActionResult & { cv?: CareerCV }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  try {
    const cv = await requireOwnedCV(cvId, careerProfileId);
    return { ok: true, cv };
  } catch {
    return { ok: false, error: "CV not found." };
  }
}
