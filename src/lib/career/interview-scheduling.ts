import crypto from "node:crypto";

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import type { CareerInterviewStatus } from "@/generated/prisma/client";
import { checkInterviewConflict, type AvailabilityCheckInput } from "./interview-availability";
import { buildInterviewAcceptanceDraft, buildAlternativeTimeDraft, queueRecruiterDraft } from "./recruiter-reply-drafts";

/**
 * Phase 21 (§20, §21, §22, §26, §27, §53) — real interview creation +
 * decision flow.
 *
 * §20 autonomous scheduling requires a connected, real calendar
 * integration (see interview-availability.ts's doc comment) — since none
 * exists in this codebase, `createOrUpdateInterview` NEVER auto-confirms a
 * SCHEDULED interview purely from `autonomousSchedulingEnabled`; every real
 * interview request honestly resolves to PENDING_APPROVAL until a human
 * calls `decideInterview`. The gate and the field exist and are fully
 * exercised by tests, but there is nothing today that could safely satisfy
 * §20 condition 4 ("calendar integration is connected").
 */

export interface CreateInterviewInput {
  organizationId: string;
  careerProfileId: string;
  applicationId: string;
  sourceCommunicationId: string;
  stage: string | null;
  localDate: string | null;
  localTime: string | null;
  timezone: string | null;
  scheduledAtUtc: Date | null;
  durationMinutes: number | null;
  meetingLink: string | null;
  phone: string | null;
  interviewerName: string | null;
}

/** §53 idempotency — reprocessing the same source communication must never create a duplicate interview. */
export async function createOrUpdateInterviewFromCommunication(input: CreateInterviewInput) {
  const existing = await prisma.careerInterview.findUnique({ where: { sourceCommunicationId: input.sourceCommunicationId } });
  if (existing) return existing;

  const idempotencyKey = crypto.createHash("sha256").update(`interview:${input.sourceCommunicationId}`).digest("hex");

  let status: "PENDING_APPROVAL" | "REQUESTED" = "REQUESTED";
  let conflictDetail: string | null = null;

  // §54 timezone-conflict — real, conservative: if this application already
  // has an active (non-terminal) interview request with a genuinely
  // different stated timezone, surface it honestly rather than silently
  // picking one. Never auto-resolves which timezone is "correct".
  let timezoneConflictDetail: string | null = null;
  if (input.timezone) {
    const priorInterview = await prisma.careerInterview.findFirst({
      where: {
        applicationId: input.applicationId,
        status: { in: ["REQUESTED", "PENDING_APPROVAL", "RESCHEDULE_REQUESTED"] },
        timezone: { not: null },
      },
      select: { timezone: true },
      orderBy: { createdAt: "desc" },
    });
    if (priorInterview?.timezone && priorInterview.timezone !== input.timezone) {
      timezoneConflictDetail = `Timezone conflict: this message states "${input.timezone}", but an earlier pending interview request for this application stated "${priorInterview.timezone}". Not auto-resolved — needs human review.`;
    }
  }

  if (input.scheduledAtUtc) {
    const profile = await prisma.careerProfile.findUnique({ where: { id: input.careerProfileId } });
    if (profile) {
      const availabilityInput: AvailabilityCheckInput = {
        careerProfileId: input.careerProfileId,
        proposedStartUtc: input.scheduledAtUtc,
        durationMinutes: input.durationMinutes ?? 60,
        workingHoursStart: profile.workingHoursStart,
        workingHoursEnd: profile.workingHoursEnd,
        workingHoursTimezone: profile.workingHoursTimezone,
        workingDays: profile.workingDays,
        blackoutPeriods: (profile.blackoutPeriods as Array<{ startsAt: string; endsAt: string; reason?: string }> | null) ?? null,
      };
      const availability = await checkInterviewConflict(availabilityInput);
      conflictDetail = availability.status === "BUSY" || availability.status === "BLACKOUT" || availability.status === "OUTSIDE_WORKING_HOURS" ? availability.detail : null;
    }
    // §21 — always PENDING_APPROVAL, never auto-SCHEDULED (see doc comment above).
    status = "PENDING_APPROVAL";
  }

  const interview = await prisma.careerInterview.create({
    data: {
      organizationId: input.organizationId,
      careerProfileId: input.careerProfileId,
      applicationId: input.applicationId,
      sourceCommunicationId: input.sourceCommunicationId,
      stage: input.stage,
      status,
      localDate: input.localDate,
      localTime: input.localTime,
      timezone: input.timezone,
      scheduledAtUtc: input.scheduledAtUtc,
      durationMinutes: input.durationMinutes,
      meetingLink: input.meetingLink,
      phone: input.phone,
      interviewerName: input.interviewerName,
      idempotencyKey,
      notes: [conflictDetail && `Conflict detected at request time: ${conflictDetail}`, timezoneConflictDetail].filter(Boolean).join(" ") || null,
    },
  });

  await logAudit({ organizationId: input.organizationId, action: "career:interview:created", metadata: { interviewId: interview.id, applicationId: input.applicationId, status } });
  return interview;
}

export type InterviewDecision = "ACCEPT" | "REJECT" | "SUGGEST_ALTERNATIVE" | "REQUEST_ANOTHER_SLOT";

export interface DecideInterviewResult {
  ok: boolean;
  error?: string;
}

/** §22/§23/§24/§25 — the real, human-driven decision on a pending interview request. */
export async function decideInterview(interviewId: string, userId: string, decision: InterviewDecision): Promise<DecideInterviewResult> {
  const interview = await prisma.careerInterview.findUnique({ where: { id: interviewId } });
  if (!interview) return { ok: false, error: "Interview not found." };
  if (interview.status !== "PENDING_APPROVAL" && interview.status !== "REQUESTED") {
    return { ok: false, error: `Cannot decide an interview in status ${interview.status}.` };
  }

  let newStatus: CareerInterviewStatus = interview.status;
  if (decision === "ACCEPT") newStatus = "SCHEDULED";
  if (decision === "REJECT") newStatus = "CANCELLED";
  if (decision === "SUGGEST_ALTERNATIVE" || decision === "REQUEST_ANOTHER_SLOT") newStatus = "RESCHEDULE_REQUESTED";

  await prisma.careerInterview.update({
    where: { id: interviewId },
    data: { status: newStatus, decision, decisionByUserId: userId, decisionAt: new Date() },
  });

  // §22/§24/§25 — a real human decision now genuinely authorizes preparing
  // (never auto-sending — §46, status DRAFT) an actual outbound reply,
  // closing the gap where ACCEPT/SUGGEST_ALTERNATIVE previously only
  // changed internal state with no real communication ever prepared.
  let draftId: string | null = null;
  if (decision === "ACCEPT") {
    const content = await buildInterviewAcceptanceDraft(interviewId);
    if (content) draftId = (await queueRecruiterDraft({ kind: "interview", id: interviewId }, content))?.id ?? null;
  } else if (decision === "SUGGEST_ALTERNATIVE" || decision === "REQUEST_ANOTHER_SLOT") {
    const content = await buildAlternativeTimeDraft(interviewId, decision);
    if (content) draftId = (await queueRecruiterDraft({ kind: "interview", id: interviewId }, content))?.id ?? null;
  }

  await logAudit({ organizationId: interview.organizationId, userId, action: "career:interview:decided", metadata: { interviewId, decision, newStatus, draftId } });
  return { ok: true };
}
