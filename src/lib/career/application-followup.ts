import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { checkSuppression } from "@/lib/outreach/suppression";
import { sendQueuedDraftCore } from "@/app/dashboard/outreach/_lib/approval-actions";

/**
 * Phase 21 (§40, §41, §42, §43, §44, §45, §58) — real, configurable
 * follow-up scheduling and sending for a submitted job application.
 * Reuses Phase 17's suppression engine (§45: "do not create a separate
 * rate limiter") and the exact same EmailDraft -> sendQueuedDraftCore
 * pipeline Phase 20's submission engine already uses (§42: email only).
 */

/** §40 — day offsets are read from the profile's CURRENT configuration at schedule time; never hard-coded here. */
export function computeFollowUpDates(anchor: Date, intervalDays: number[]): Array<{ dayOffset: number; scheduledFor: Date }> {
  return intervalDays
    .filter((d) => Number.isInteger(d) && d >= 0)
    .map((dayOffset) => ({ dayOffset, scheduledFor: new Date(anchor.getTime() + dayOffset * 24 * 60 * 60_000) }));
}

/** Idempotent: the @@unique([applicationId, dayOffset]) constraint is the real duplicate guard (never rely on application-level checking alone). */
export async function scheduleFollowUpsForApplication(applicationId: string): Promise<{ created: number }> {
  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { careerProfile: true } });
  if (!application || !application.submittedAt) return { created: 0 };
  if (!application.careerProfile.followUpEnabled) return { created: 0 };

  const dates = computeFollowUpDates(application.submittedAt, application.careerProfile.followUpIntervalDays);
  let created = 0;
  for (const { dayOffset, scheduledFor } of dates) {
    const result = await prisma.careerFollowUp.upsert({
      where: { applicationId_dayOffset: { applicationId, dayOffset } },
      update: {},
      create: { organizationId: application.organizationId, careerProfileId: application.careerProfileId, applicationId, dayOffset, scheduledFor },
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) created += 1;
  }
  return { created };
}

export interface StoppingConditionResult {
  shouldSend: boolean;
  reason: string | null;
}

/** §41/§58 — re-checked IMMEDIATELY before every send, never trusted from schedule time. */
export async function evaluateFollowUpStoppingConditions(applicationId: string): Promise<StoppingConditionResult> {
  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { careerProfile: true, job: true } });
  if (!application) return { shouldSend: false, reason: "Application no longer exists." };

  const respondedStatuses = new Set(["REJECTED", "OFFER", "INTERVIEW", "WITHDRAWN", "CLOSED", "CONFIRMED"]);
  if (respondedStatuses.has(application.status)) return { shouldSend: false, reason: `Application status is already ${application.status} — a real response/outcome already exists.` };

  const hasReply = await prisma.recruiterCommunication.findFirst({ where: { applicationId } });
  if (hasReply) return { shouldSend: false, reason: "A recruiter reply has already been received for this application." };

  if (application.careerProfile.excludedCompanies.some((c) => c.toLowerCase() === application.job.company.toLowerCase())) {
    return { shouldSend: false, reason: "Company is on the candidate's excluded-companies list." };
  }
  if (!application.careerProfile.followUpEnabled) return { shouldSend: false, reason: "Follow-ups are disabled on this career profile." };

  // §44/§45 — real suppression + sending-limit check, reusing the exact
  // Phase 17 choke-point every other outbound send already goes through.
  const document = await prisma.applicationDocument.findFirst({ where: { applicationId, type: { in: ["RECRUITER_EMAIL", "HIRING_MANAGER_EMAIL"] } }, orderBy: { createdAt: "desc" } });
  if (!document?.providerMessageId) return { shouldSend: false, reason: "No prior outbound email is on file to follow up on." };
  const originalDraft = await prisma.emailDraft.findUnique({ where: { resendMessageId: document.providerMessageId }, include: { contact: true } });
  if (!originalDraft) return { shouldSend: false, reason: "Original application email record not found." };

  const suppression = await checkSuppression(application.organizationId, originalDraft.contact.email, "EMAIL");
  if (suppression.suppressed) return { shouldSend: false, reason: `Suppressed: ${suppression.reason}.` };

  return { shouldSend: true, reason: null };
}

export interface SendFollowUpResult {
  ok: boolean;
  status: "SENT" | "CANCELLED" | "SKIPPED";
  reason?: string;
}

/** §43 — drafts strictly from real prior context; never fabricates a previous call/conversation. */
export async function buildFollowUpDraft(applicationId: string): Promise<{ subject: string; body: string } | null> {
  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { job: true, careerProfile: true } });
  if (!application) return null;
  const subject = `Following up: application for ${application.job.title}`;
  const body = `Hello,\n\nI wanted to follow up on my application for the ${application.job.title} role at ${application.job.company}, submitted on ${application.submittedAt?.toDateString() ?? "the date on file"}. I remain very interested in this opportunity and would welcome the chance to discuss it further.\n\nThank you for your time.\n\nBest regards,\n${application.careerProfile.name}`;
  return { subject, body };
}

export async function sendFollowUp(followUpId: string): Promise<SendFollowUpResult> {
  const followUp = await prisma.careerFollowUp.findUnique({ where: { id: followUpId } });
  if (!followUp || followUp.status !== "PENDING") return { ok: false, status: "SKIPPED", reason: "Not a pending follow-up." };

  const stopping = await evaluateFollowUpStoppingConditions(followUp.applicationId);
  if (!stopping.shouldSend) {
    await prisma.careerFollowUp.update({ where: { id: followUpId }, data: { status: "CANCELLED", cancelReason: stopping.reason } });
    await logAudit({ organizationId: followUp.organizationId, action: "career:followup:cancelled", metadata: { followUpId, reason: stopping.reason } });
    return { ok: true, status: "CANCELLED", reason: stopping.reason ?? undefined };
  }

  const draftContent = await buildFollowUpDraft(followUp.applicationId);
  const document = await prisma.applicationDocument.findFirst({ where: { applicationId: followUp.applicationId, type: { in: ["RECRUITER_EMAIL", "HIRING_MANAGER_EMAIL"] } }, orderBy: { createdAt: "desc" } });
  const originalDraft = document?.providerMessageId ? await prisma.emailDraft.findUnique({ where: { resendMessageId: document.providerMessageId } }) : null;
  if (!draftContent || !originalDraft) {
    await prisma.careerFollowUp.update({ where: { id: followUpId }, data: { status: "SKIPPED", cancelReason: "No original application email/contact to follow up through." } });
    return { ok: true, status: "SKIPPED" };
  }

  const application = await prisma.jobApplication.findUnique({ where: { id: followUp.applicationId }, select: { userId: true } });
  const draft = await prisma.emailDraft.create({
    data: { organizationId: followUp.organizationId, contactId: originalDraft.contactId, channel: "EMAIL", purpose: "JOB_APPLICATION", tone: "PROFESSIONAL", subject: draftContent.subject, body: draftContent.body, status: "QUEUED" },
  });
  const result = await sendQueuedDraftCore(followUp.organizationId, draft.id, application?.userId ?? "");
  if (!result.ok) {
    await prisma.careerFollowUp.update({ where: { id: followUpId }, data: { status: "SKIPPED", cancelReason: result.error ?? "Send failed." } });
    return { ok: true, status: "SKIPPED", reason: result.error };
  }

  await prisma.careerFollowUp.update({ where: { id: followUpId }, data: { status: "SENT", sentEmailDraftId: draft.id } });
  await logAudit({ organizationId: followUp.organizationId, action: "career:followup:sent", metadata: { followUpId, applicationId: followUp.applicationId, draftId: draft.id } });
  return { ok: true, status: "SENT" };
}
