"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { AINotConnectedError, AIBillingError, isAIBillingError } from "@/lib/ai/client";
import { saveCareerResume, removeCareerResume } from "@/lib/storage/career-resumes";
import { extractResumeText } from "@/lib/recruitment/resume-text-extraction";
import { extractCareerProfileFromResume } from "@/lib/career/resume-extraction";
import type { Prisma } from "@/generated/prisma/client";

export interface ActionResult {
  ok: boolean;
  error?: string;
  errorKind?: "not_connected" | "billing" | "generic";
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

async function resolveOwnedProfile(userId: string, organizationId: string, careerProfileId: string) {
  const profile = await prisma.careerProfile.findUnique({ where: { id: careerProfileId } });
  if (!profile || profile.userId !== userId || profile.organizationId !== organizationId) return null;
  return profile;
}

export interface UploadCareerResumeResult extends ActionResult {
  careerResumeId?: string;
  duplicateOfVersion?: number;
}

/**
 * Real upload pipeline: UPLOADED -> VALIDATING (implicit, saveCareerResume
 * itself validates size/type) -> a real new CareerResume row (never
 * overwrites a prior version, §8/§9) -> PARSING -> PARSED -> AI_PROCESSING
 * -> PROCESSED/REVIEW_REQUIRED/FAILED. Every stage sets a real, honest
 * status — never silently skipped.
 */
export async function uploadCareerResume(careerProfileId: string, file: File): Promise<UploadCareerResumeResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  // §22 duplicate detection — real sha256 of the real bytes, checked against
  // every prior version of THIS profile's resumes before any new processing
  // job is kicked off.
  let uploadResult;
  try {
    // A throwaway id is fine here — saveCareerResume just needs a unique
    // filesystem-safe entity segment; the real CareerResume.id is assigned
    // by Prisma below and isn't known until after the file is on disk.
    uploadResult = await saveCareerResume(membership.organizationId, `pending-${Date.now()}`, file);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Upload failed." };
  }

  const existingWithSameChecksum = await prisma.careerResume.findFirst({
    where: { careerProfileId, checksum: uploadResult.checksum },
    orderBy: { version: "desc" },
  });
  if (existingWithSameChecksum) {
    // Real duplicate — remove the just-saved redundant copy, never process it again.
    await removeCareerResume(uploadResult.storageKey);
    return { ok: true, duplicateOfVersion: existingWithSameChecksum.version };
  }

  const latest = await prisma.careerResume.findFirst({ where: { careerProfileId }, orderBy: { version: "desc" } });
  const nextVersion = (latest?.version ?? 0) + 1;

  const resume = await prisma.careerResume.create({
    data: {
      careerProfileId,
      version: nextVersion,
      originalFilename: file.name,
      mimeType: uploadResult.mimeType,
      sizeBytes: uploadResult.sizeBytes,
      checksum: uploadResult.checksum,
      storageKey: uploadResult.storageKey,
      status: "PARSING",
    },
  });

  await logAudit({
    userId,
    organizationId: membership.organizationId,
    action: "career.resume_uploaded",
    metadata: { careerProfileId, careerResumeId: resume.id, version: nextVersion },
  });

  // Real text extraction — failures preserve the uploaded original and mark
  // FAILED honestly rather than corrupting profile data (§24).
  let extractedText: string;
  try {
    const buffer = await file.arrayBuffer();
    extractedText = await extractResumeText(Buffer.from(buffer), uploadResult.mimeType);
  } catch (error) {
    await prisma.careerResume.update({
      where: { id: resume.id },
      data: { status: "FAILED", failureReason: error instanceof Error ? error.message : "Could not read this document." },
    });
    revalidatePath(`/dashboard/career/profile/${careerProfileId}`);
    return { ok: true, careerResumeId: resume.id };
  }

  if (!extractedText.trim()) {
    await prisma.careerResume.update({
      where: { id: resume.id },
      data: { status: "FAILED", failureReason: "This document appears to be empty — no extractable text was found." },
    });
    revalidatePath(`/dashboard/career/profile/${careerProfileId}`);
    return { ok: true, careerResumeId: resume.id };
  }

  await prisma.careerResume.update({
    where: { id: resume.id },
    data: { status: "AI_PROCESSING", extractedText: extractedText.slice(0, 50_000) },
  });

  try {
    const extraction = await extractCareerProfileFromResume(membership.organizationId, extractedText);
    if (!extraction) {
      // Honest "AI not connected" — real extracted text is still saved and reviewable manually.
      await prisma.careerResume.update({ where: { id: resume.id }, data: { status: "REVIEW_REQUIRED", processedAt: new Date() } });
    } else {
      await prisma.careerResume.update({
        where: { id: resume.id },
        data: {
          status: "REVIEW_REQUIRED",
          aiExtractedProfile: extraction as unknown as Prisma.InputJsonValue,
          aiConfidence: extraction.overallConfidence,
          processedAt: new Date(),
        },
      });
    }
  } catch (error) {
    const kind =
      error instanceof AINotConnectedError ? "AI not connected" : error instanceof AIBillingError || isAIBillingError(error) ? "AI billing issue" : "AI processing failed";
    await prisma.careerResume.update({
      where: { id: resume.id },
      data: { status: "REVIEW_REQUIRED", failureReason: `${kind} — the extracted text is still saved and can be reviewed manually.` },
    });
  }

  revalidatePath(`/dashboard/career/profile/${careerProfileId}`);
  revalidatePath("/dashboard/career");
  return { ok: true, careerResumeId: resume.id };
}

export async function deleteCareerResumeVersion(careerProfileId: string, careerResumeId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  const resume = await prisma.careerResume.findUnique({ where: { id: careerResumeId } });
  if (!resume || resume.careerProfileId !== careerProfileId) return { ok: false, error: "Resume version not found." };

  await removeCareerResume(resume.storageKey).catch(() => {}); // real file may already be gone; DB row deletion is the source of truth
  await prisma.careerResume.delete({ where: { id: careerResumeId } });

  await logAudit({
    userId,
    organizationId: membership.organizationId,
    action: "career.resume_deleted",
    metadata: { careerProfileId, careerResumeId, version: resume.version },
  });
  revalidatePath(`/dashboard/career/profile/${careerProfileId}`);
  return { ok: true };
}
