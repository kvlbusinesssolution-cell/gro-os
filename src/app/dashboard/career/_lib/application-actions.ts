"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { notifyUser } from "@/lib/notifications";
import { prepareApplicationCore, submitApplicationCore, reconcileSubmissionStatusCore, type PrepareApplicationResult, type SubmitApplicationResult } from "@/lib/career/application-orchestrator";
import { assertValidTransition } from "@/lib/career/application-state-machine";
import { applicationPolicySchema, type ApplicationPolicyInput } from "@/lib/validations/career";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

async function resolveOwnedApplication(userId: string, organizationId: string, applicationId: string) {
  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
  if (!application || application.userId !== userId || application.organizationId !== organizationId) return null;
  return application;
}

/** §2 — kicks off the full prepare pipeline for a real, already-computed JobMatch (§16 spec architecture: JOB DISCOVERY -> JOB MATCH -> SHORTLIST is Phase 19; this begins at ELIGIBILITY). */
export async function prepareApplication(careerProfileId: string, jobMatchId: string): Promise<PrepareApplicationResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const result = await prepareApplicationCore(careerProfileId, jobMatchId, membership.organizationId, userId);
  revalidatePath("/dashboard/career/applications");
  return result;
}

/** §21 — explicit human approval. Only a human user (never a scheduler job) may call this. */
export async function approveApplication(applicationId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const application = await resolveOwnedApplication(userId, membership.organizationId, applicationId);
  if (!application) return { ok: false, error: "Application not found." };
  if (application.status !== "USER_APPROVAL_REQUIRED" && application.status !== "READY_FOR_REVIEW") {
    return { ok: false, error: `Cannot approve from status ${application.status}.` };
  }

  await prisma.jobApplication.update({ where: { id: applicationId }, data: { approvedByUserId: userId, approvedAt: new Date() } });
  await logAudit({ userId, organizationId: membership.organizationId, action: "career:application:approved", metadata: { applicationId } });

  const result = await submitApplicationCore(applicationId, userId);
  revalidatePath("/dashboard/career/applications");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** §14/§48 — the same submit-with-safety-gate path approveApplication uses, exposed for READY_FOR_REVIEW applications that don't need a separate approval click (e.g. re-checking policy after limits reset). */
export async function submitApplication(applicationId: string): Promise<SubmitApplicationResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const application = await resolveOwnedApplication(userId, membership.organizationId, applicationId);
  if (!application) return { ok: false, error: "Application not found." };

  const result = await submitApplicationCore(applicationId, userId);
  revalidatePath("/dashboard/career/applications");
  return result;
}

/** §33 — real, gated retry. Only ever re-enters from a real retryable state (FAILED_REQUIRES_REVIEW), never blindly re-sends from SUBMITTED/CONFIRMED. */
export async function retryApplication(applicationId: string): Promise<SubmitApplicationResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const application = await resolveOwnedApplication(userId, membership.organizationId, applicationId);
  if (!application) return { ok: false, error: "Application not found." };
  if (application.status !== "FAILED_REQUIRES_REVIEW") return { ok: false, error: "Only a FAILED_REQUIRES_REVIEW application can be retried." };

  // First reconcile — the original attempt may since have resolved on its
  // own (e.g. a late-arriving delivered webhook); never retry before
  // checking that (§31/§56).
  const reconciled = await reconcileSubmissionStatusCore(applicationId);
  if (reconciled.status !== application.status) {
    revalidatePath("/dashboard/career/applications");
    return reconciled;
  }

  assertValidTransition("FAILED_REQUIRES_REVIEW", "SUBMITTING");
  await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: "SUBMITTING" } });
  await logAudit({ userId, organizationId: membership.organizationId, action: "career:application:retry", metadata: { applicationId, retryCount: application.retryCount } });

  const result = await submitApplicationCore(applicationId, userId);
  revalidatePath("/dashboard/career/applications");
  return result;
}

/** §43 — real withdrawal. Since no authorized submission-platform integration exists, "provider action" is honestly N/A for the EMAIL/PLATFORM_RESTRICTED paths this build supports — recorded as such, never fabricated. */
export async function withdrawApplication(applicationId: string, reason?: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const application = await resolveOwnedApplication(userId, membership.organizationId, applicationId);
  if (!application) return { ok: false, error: "Application not found." };

  try {
    assertValidTransition(application.status, "WITHDRAWN");
  } catch {
    return { ok: false, error: `Cannot withdraw from status ${application.status}.` };
  }

  await prisma.jobApplication.update({ where: { id: applicationId }, data: { status: "WITHDRAWN", withdrawnAt: new Date(), withdrawReason: reason ?? null } });
  await logAudit({ userId, organizationId: membership.organizationId, action: "career:application:withdrawn", metadata: { applicationId, reason: reason ?? null } });
  await notifyUser({ userId, organizationId: membership.organizationId, type: "SYSTEM_NOTICE", title: "Application withdrawn", message: "Your application was withdrawn." });

  revalidatePath("/dashboard/career/applications");
  return { ok: true };
}

/** §24 — updates the real automation policy fields kept on CareerProfile. */
export async function updateApplicationPolicy(careerProfileId: string, input: ApplicationPolicyInput): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const parsed = applicationPolicySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid policy." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await prisma.careerProfile.findUnique({ where: { id: careerProfileId } });
  if (!profile || profile.userId !== userId || profile.organizationId !== membership.organizationId) return { ok: false, error: "Career profile not found." };

  await prisma.careerProfile.update({
    where: { id: careerProfileId },
    data: {
      applicationAutomationMode: parsed.data.applicationAutomationMode,
      applicationRequireApproval: parsed.data.applicationRequireApproval,
      maxApplicationsPerDay: parsed.data.maxApplicationsPerDay,
      maxApplicationsPerWeek: parsed.data.maxApplicationsPerWeek,
      minEligibilityForAutoApply: parsed.data.minEligibilityForAutoApply,
    },
  });

  await logAudit({ userId, organizationId: membership.organizationId, action: "career:application_policy_updated", metadata: { careerProfileId, ...parsed.data } });
  revalidatePath("/dashboard/career/applications");
  return { ok: true };
}
