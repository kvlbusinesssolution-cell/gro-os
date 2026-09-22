"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { runJobDiscoveryForProfile, type DiscoveryRunResult } from "@/lib/career/job-discovery";
import { careerJobDiscoveryConfigSchema, type CareerJobDiscoveryConfigInput } from "@/lib/validations/career";

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

export async function triggerJobDiscovery(careerProfileId: string): Promise<DiscoveryRunResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  const result = await runJobDiscoveryForProfile(careerProfileId, membership.organizationId, "MANUAL");

  await logAudit({
    userId,
    organizationId: membership.organizationId,
    action: "career.job_discovery_triggered",
    metadata: { careerProfileId, ok: result.ok, status: result.status, newJobsCount: result.newJobsCount },
  });

  revalidatePath("/dashboard/career/jobs");
  revalidatePath("/dashboard/career/job-search");
  return result;
}

export async function updateJobDiscoveryConfig(careerProfileId: string, input: CareerJobDiscoveryConfigInput): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = careerJobDiscoveryConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid configuration." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await resolveOwnedProfile(userId, membership.organizationId, careerProfileId);
  if (!profile) return { ok: false, error: "Career profile not found." };

  await prisma.careerProfile.update({
    where: { id: careerProfileId },
    data: {
      discoveryEnabled: parsed.data.discoveryEnabled,
      discoveryFrequency: parsed.data.discoveryFrequency,
      minMatchThreshold: parsed.data.minMatchThreshold,
    },
  });

  await logAudit({ userId, organizationId: membership.organizationId, action: "career.discovery_config_updated", metadata: { careerProfileId, ...parsed.data } });
  revalidatePath("/dashboard/career/job-search");
  return { ok: true };
}

export async function setJobMatchStatus(jobMatchId: string, status: "SHORTLISTED" | "REVIEW_REQUIRED" | "NOT_MATCHED", notes?: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const match = await prisma.jobMatch.findUnique({ where: { id: jobMatchId }, include: { careerProfile: { select: { userId: true } } } });
  if (!match || match.careerProfile.userId !== userId || match.organizationId !== membership.organizationId) {
    return { ok: false, error: "Job match not found." };
  }

  await prisma.jobMatch.update({ where: { id: jobMatchId }, data: { status, userNotes: notes } });
  await logAudit({ userId, organizationId: membership.organizationId, action: "career.job_match_status_changed", metadata: { jobMatchId, status } });
  revalidatePath("/dashboard/career/jobs");
  return { ok: true };
}
