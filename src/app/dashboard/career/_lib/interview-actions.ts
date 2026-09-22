"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { decideInterview, type InterviewDecision } from "@/lib/career/interview-scheduling";
import { careerSchedulingPolicySchema, manualClassificationSchema, type CareerSchedulingPolicyInput, type ManualClassificationInput } from "@/lib/validations/career";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

/** §60 — real ownership check: an interview belongs to a career profile which belongs to the calling user's own account. */
async function resolveOwnedInterview(userId: string, organizationId: string, interviewId: string) {
  const interview = await prisma.careerInterview.findUnique({ where: { id: interviewId }, include: { careerProfile: true } });
  if (!interview || interview.organizationId !== organizationId || interview.careerProfile.userId !== userId) return null;
  return interview;
}

async function resolveOwnedCommunication(userId: string, organizationId: string, communicationId: string) {
  const communication = await prisma.recruiterCommunication.findUnique({ where: { id: communicationId }, include: { application: true } });
  if (!communication || communication.organizationId !== organizationId) return null;
  if (communication.application && communication.application.userId !== userId) return null;
  return communication;
}

/** §21-25 — the real, human-driven ACCEPT/REJECT/SUGGEST_ALTERNATIVE/REQUEST_ANOTHER_SLOT decision. */
export async function decideInterviewAction(interviewId: string, decision: InterviewDecision): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const interview = await resolveOwnedInterview(userId, membership.organizationId, interviewId);
  if (!interview) return { ok: false, error: "Interview not found." };

  const result = await decideInterview(interviewId, userId, decision);
  revalidatePath("/dashboard/career/interviews");
  revalidatePath(`/dashboard/career/applications/${interview.applicationId}`);
  return result;
}

/** §37 — a human manually classifying a message the AI left UNKNOWN/uncertain is a real, auditable event; the original AI classification is never erased. */
export async function manuallyClassifyMessage(communicationId: string, input: ManualClassificationInput): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const communication = await resolveOwnedCommunication(userId, membership.organizationId, communicationId);
  if (!communication) return { ok: false, error: "Message not found." };

  const parsed = manualClassificationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid classification." };

  await prisma.recruiterCommunication.update({
    where: { id: communicationId },
    data: { manualClassification: parsed.data.classification, manuallyClassifiedByUserId: userId, manuallyClassifiedAt: new Date() },
  });
  await logAudit({ userId, organizationId: membership.organizationId, action: "career:communication:manually_classified", metadata: { communicationId, classification: parsed.data.classification } });
  revalidatePath("/dashboard/career/messages");
  return { ok: true };
}

/** §19/§40 — real scheduling/follow-up policy update. */
export async function updateSchedulingPolicy(careerProfileId: string, input: CareerSchedulingPolicyInput): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const profile = await prisma.careerProfile.findUnique({ where: { id: careerProfileId } });
  if (!profile || profile.userId !== userId || profile.organizationId !== membership.organizationId) return { ok: false, error: "Career profile not found." };

  const parsed = careerSchedulingPolicySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  await prisma.careerProfile.update({
    where: { id: careerProfileId },
    data: {
      followUpEnabled: parsed.data.followUpEnabled,
      followUpIntervalDays: parsed.data.followUpIntervalDays,
      workingHoursStart: parsed.data.workingHoursStart || null,
      workingHoursEnd: parsed.data.workingHoursEnd || null,
      workingHoursTimezone: parsed.data.workingHoursTimezone || null,
      workingDays: parsed.data.workingDays,
      autonomousSchedulingEnabled: parsed.data.autonomousSchedulingEnabled,
    },
  });
  await logAudit({ userId, organizationId: membership.organizationId, action: "career:scheduling_policy:updated", metadata: { careerProfileId } });
  revalidatePath(`/dashboard/career/profile/${careerProfileId}`);
  return { ok: true };
}
