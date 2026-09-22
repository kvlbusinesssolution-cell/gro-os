"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { careerProfileSchema, type CareerProfileInput } from "@/lib/validations/career";
import type { Prisma } from "@/generated/prisma/client";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

/**
 * Phase 18 (AI Career Agent Foundation) — real ownership check every
 * career action below uses: a CareerProfile belongs to exactly one real
 * userId, and access requires BOTH that userId match AND active membership
 * in the profile's own organizationId (defense in depth — matches this
 * repo's tenant-isolation convention of scoping every query by
 * organizationId, layered on top of the user-ownership check §31 actually
 * requires for personal career data).
 */
async function resolveOwnedProfile(userId: string, organizationId: string, careerProfileId: string) {
  const profile = await prisma.careerProfile.findUnique({ where: { id: careerProfileId } });
  if (!profile || profile.userId !== userId || profile.organizationId !== organizationId) return null;
  return profile;
}

export interface CreateCareerProfileResult extends ActionResult {
  careerProfileId?: string;
}

export async function createCareerProfile(input: CareerProfileInput): Promise<CreateCareerProfileResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = careerProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the profile details." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const existingCount = await prisma.careerProfile.count({ where: { userId, organizationId: membership.organizationId } });

  const profile = await prisma.careerProfile.create({
    data: {
      userId,
      organizationId: membership.organizationId,
      name: parsed.data.name,
      isPrimary: existingCount === 0, // first profile is automatically primary — never left ambiguous
      targetRoles: parsed.data.targetRoles ?? [],
      targetCountries: parsed.data.targetCountries ?? [],
      targetCities: parsed.data.targetCities ?? [],
      industries: parsed.data.industries ?? [],
    },
  });

  await logAudit({ userId, organizationId: membership.organizationId, action: "career.profile_created", metadata: { careerProfileId: profile.id } });
  revalidatePath("/dashboard/career");
  return { ok: true, careerProfileId: profile.id };
}

export async function updateCareerProfile(careerProfileId: string, input: CareerProfileInput): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = careerProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the profile details." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  // §16 preference validation — rejected outright, never silently corrected.
  if (parsed.data.salaryMin != null && parsed.data.salaryMax != null && parsed.data.salaryMin > parsed.data.salaryMax) {
    return { ok: false, error: "Minimum salary cannot be greater than maximum salary." };
  }
  if (
    parsed.data.experienceLevelMinYears != null &&
    parsed.data.experienceLevelMaxYears != null &&
    parsed.data.experienceLevelMinYears > parsed.data.experienceLevelMaxYears
  ) {
    return { ok: false, error: "Minimum experience cannot be greater than maximum experience." };
  }

  await prisma.careerProfile.update({
    where: { id: careerProfileId },
    data: {
      name: parsed.data.name,
      currentRole: parsed.data.currentRole || null,
      careerLevel: parsed.data.careerLevel || null,
      yearsOfExperience: parsed.data.yearsOfExperience ?? null,
      location: parsed.data.location || null,
      industries: parsed.data.industries ?? [],
      portfolioUrl: parsed.data.portfolioUrl || null,
      githubUrl: parsed.data.githubUrl || null,
      linkedinUrl: parsed.data.linkedinUrl || null,
      websiteUrl: parsed.data.websiteUrl || null,
      targetRoles: parsed.data.targetRoles ?? [],
      targetCountries: parsed.data.targetCountries ?? [],
      targetCities: parsed.data.targetCities ?? [],
      workMode: parsed.data.workMode || null,
      salaryMin: parsed.data.salaryMin ?? null,
      salaryMax: parsed.data.salaryMax ?? null,
      salaryCurrency: parsed.data.salaryCurrency || null,
      employmentTypes: parsed.data.employmentTypes ?? [],
      experienceLevelMinYears: parsed.data.experienceLevelMinYears ?? null,
      experienceLevelMaxYears: parsed.data.experienceLevelMaxYears ?? null,
      preferredTechnologies: parsed.data.preferredTechnologies ?? [],
      excludedTechnologies: parsed.data.excludedTechnologies ?? [],
      preferredCompanies: parsed.data.preferredCompanies ?? [],
      excludedCompanies: parsed.data.excludedCompanies ?? [],
      relocationPreference: parsed.data.relocationPreference || null,
      noticePeriodDays: parsed.data.noticePeriodDays ?? null,
    },
  });

  await logAudit({ userId, organizationId: membership.organizationId, action: "career.profile_updated", metadata: { careerProfileId } });
  revalidatePath("/dashboard/career");
  revalidatePath(`/dashboard/career/profile/${careerProfileId}`);
  return { ok: true };
}

export async function setPrimaryCareerProfile(careerProfileId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  // Real, atomic switch — every other profile for this user demoted in the
  // same transaction so exactly one is ever primary, never zero or two.
  await prisma.$transaction([
    prisma.careerProfile.updateMany({ where: { userId, organizationId: membership.organizationId }, data: { isPrimary: false } }),
    prisma.careerProfile.update({ where: { id: careerProfileId }, data: { isPrimary: true } }),
  ]);

  await logAudit({ userId, organizationId: membership.organizationId, action: "career.profile_set_primary", metadata: { careerProfileId } });
  revalidatePath("/dashboard/career");
  return { ok: true };
}

export async function archiveCareerProfile(careerProfileId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  await prisma.careerProfile.update({ where: { id: careerProfileId }, data: { status: "ARCHIVED", isPrimary: false } });

  await logAudit({ userId, organizationId: membership.organizationId, action: "career.profile_archived", metadata: { careerProfileId } });
  revalidatePath("/dashboard/career");
  return { ok: true };
}

/**
 * Applies user-confirmed fields from a resume's AI extraction onto the
 * CareerProfile — the ONLY path by which AI_INFERENCE data is allowed to
 * become the profile's real value (§13). `fields` is an explicit allowlist
 * of which extracted fields the user checked "apply" for — never a blind
 * "apply everything AI found".
 */
export async function applyResumeFieldsToProfile(
  careerProfileId: string,
  careerResumeId: string,
  fields: string[],
): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  const resume = await prisma.careerResume.findUnique({ where: { id: careerResumeId } });
  if (!resume || resume.careerProfileId !== careerProfileId || !resume.aiExtractedProfile) {
    return { ok: false, error: "No AI extraction available for this resume yet." };
  }

  const extraction = resume.aiExtractedProfile as Record<string, unknown>;
  const update: Prisma.CareerProfileUpdateInput = {};
  const allowed = new Set([
    "currentRole",
    "careerLevel",
    "yearsOfExperience",
    "location",
    "industries",
    "skills",
    "education",
    "certifications",
    "projects",
    "portfolioUrl",
    "githubUrl",
    "linkedinUrl",
    "websiteUrl",
  ]);

  for (const field of fields) {
    if (!allowed.has(field) || !(field in extraction)) continue;
    (update as Record<string, unknown>)[field] = extraction[field];
  }
  if (Object.keys(update).length === 0) return { ok: false, error: "No valid fields selected." };

  await prisma.careerProfile.update({ where: { id: careerProfileId }, data: update });

  const verifiedFields = { ...((resume.userVerifiedFields as Record<string, boolean>) ?? {}) };
  for (const field of fields) verifiedFields[field] = true;
  await prisma.careerResume.update({ where: { id: careerResumeId }, data: { userVerifiedFields: verifiedFields, status: "VERIFIED" } });

  await logAudit({
    userId,
    organizationId: membership.organizationId,
    action: "career.resume_fields_verified",
    metadata: { careerProfileId, careerResumeId, fields },
  });
  revalidatePath(`/dashboard/career/profile/${careerProfileId}`);
  return { ok: true };
}
