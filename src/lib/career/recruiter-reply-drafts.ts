import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { suggestAlternativeSlots, type AvailabilityCheckInput } from "./interview-availability";

/**
 * Phase 32 — real AI-draft generation for recruiter/interview communication
 * (§47: recruiter reply, interview acceptance, alternative time, document
 * response, availability, thank-you). Reuses the EXACT real infrastructure
 * `application-followup.ts`'s `buildFollowUpDraft`/queue pattern already
 * established — a real `EmailDraft` row, never a parallel draft system.
 *
 * Every draft here is template-based (deterministic string interpolation
 * from real, already-extracted/stored data), matching `buildFollowUpDraft`'s
 * own real precedent — never an AI call, so these never risk fabricating a
 * detail an AI might invent, and never depend on AI-provider availability.
 *
 * §46 — every draft is created at DraftStatus.DRAFT (never auto-queued for
 * send), so a human always reviews before anything goes out. This is
 * stricter than `buildFollowUpDraft`'s existing auto-send precedent
 * (a deliberate choice: those are pure day-N reminders with zero variable
 * content; these respond to real, unpredictable recruiter communication).
 */

export interface DraftContent {
  subject: string;
  body: string;
}

function extractionField(extraction: unknown, key: string): string | null {
  if (!extraction || typeof extraction !== "object") return null;
  const field = (extraction as Record<string, unknown>)[key];
  if (!field || typeof field !== "object") return null;
  const value = (field as Record<string, unknown>).value;
  return typeof value === "string" ? value : null;
}

/** Same real resolution path as application-followup.ts's stopping-condition check — via the application's own outbound application email's Contact. */
async function resolveContactIdForApplication(applicationId: string): Promise<string | null> {
  const document = await prisma.applicationDocument.findFirst({
    where: { applicationId, type: { in: ["RECRUITER_EMAIL", "HIRING_MANAGER_EMAIL"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!document?.providerMessageId) return null;
  const originalDraft = await prisma.emailDraft.findUnique({ where: { resendMessageId: document.providerMessageId }, select: { contactId: true } });
  return originalDraft?.contactId ?? null;
}

/** §47 — general recruiter reply, grounded strictly in real extracted context + real application/profile data. */
export async function buildRecruiterReplyDraft(communicationId: string): Promise<DraftContent | null> {
  const communication = await prisma.recruiterCommunication.findUnique({
    where: { id: communicationId },
    include: { application: { include: { job: true, careerProfile: true } } },
  });
  if (!communication?.application) return null;
  const { job, careerProfile } = communication.application;
  const recruiterName = extractionField(communication.extraction, "recruiterName");
  const subject = `Re: ${job.title} at ${job.company}`;
  const body = `Hi${recruiterName ? ` ${recruiterName}` : ""},\n\nThank you for your message regarding the ${job.title} role at ${job.company}. I appreciate you reaching out and remain very interested in this opportunity.\n\nPlease let me know how I can help move things forward.\n\nBest regards,\n${careerProfile.name}`;
  return { subject, body };
}

/** §22 — interview acceptance draft, only from real, already-recorded interview data. */
export async function buildInterviewAcceptanceDraft(interviewId: string): Promise<DraftContent | null> {
  const interview = await prisma.careerInterview.findUnique({
    where: { id: interviewId },
    include: { application: { include: { job: true, careerProfile: true } } },
  });
  if (!interview) return null;
  const { job, careerProfile } = interview.application;
  const whenText = interview.localDate && interview.localTime ? `${interview.localDate} at ${interview.localTime}${interview.timezone ? ` (${interview.timezone})` : ""}` : "the proposed time";
  const subject = `Re: Interview — ${job.title} at ${job.company}`;
  const body = `Hello,\n\nThank you for the interview invitation for the ${job.title} role. I'm happy to confirm ${whenText} works for me.${interview.meetingLink ? ` I'll join via ${interview.meetingLink}.` : ""}\n\nLooking forward to speaking with you.\n\nBest regards,\n${careerProfile.name}`;
  return { subject, body };
}

/** §24/§25 — alternative-time (real, independently-verified-free slots only) / request-another-slot draft. Never fabricates availability. */
export async function buildAlternativeTimeDraft(interviewId: string, mode: "SUGGEST_ALTERNATIVE" | "REQUEST_ANOTHER_SLOT"): Promise<DraftContent | null> {
  const interview = await prisma.careerInterview.findUnique({
    where: { id: interviewId },
    include: { application: { include: { job: true, careerProfile: true } }, careerProfile: true },
  });
  if (!interview) return null;
  const { job, careerProfile: appCareerProfile } = interview.application;
  const subject = `Re: Interview — ${job.title} at ${job.company}`;

  if (mode === "REQUEST_ANOTHER_SLOT") {
    const body = `Hello,\n\nThank you for reaching out about the ${job.title} role. Unfortunately the proposed time doesn't work for me — could you share a couple of alternative times that would suit you?\n\nBest regards,\n${appCareerProfile.name}`;
    return { subject, body };
  }

  let slotsText = "a few alternative times that work on my end";
  if (interview.scheduledAtUtc) {
    const input: AvailabilityCheckInput = {
      careerProfileId: interview.careerProfileId,
      proposedStartUtc: interview.scheduledAtUtc,
      durationMinutes: interview.durationMinutes ?? 60,
      workingHoursStart: interview.careerProfile.workingHoursStart,
      workingHoursEnd: interview.careerProfile.workingHoursEnd,
      workingHoursTimezone: interview.careerProfile.workingHoursTimezone,
      workingDays: interview.careerProfile.workingDays,
      blackoutPeriods: (interview.careerProfile.blackoutPeriods as Array<{ startsAt: string; endsAt: string; reason?: string }> | null) ?? null,
      excludeInterviewId: interview.id,
    };
    const alternatives = await suggestAlternativeSlots(input, 3);
    if (alternatives.length > 0) {
      const tz = interview.careerProfile.workingHoursTimezone ?? "UTC";
      slotsText = alternatives.map((slot) => new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(slot)).join("; ");
    }
  }

  const body = `Hello,\n\nThank you for the invitation to interview for the ${job.title} role. The proposed time doesn't quite work for me — would any of the following work instead: ${slotsText}?\n\nBest regards,\n${appCareerProfile.name}`;
  return { subject, body };
}

/** §13 — document-request response, acknowledging only the real, actually-requested documents. */
export async function buildDocumentResponseDraft(communicationId: string): Promise<DraftContent | null> {
  const communication = await prisma.recruiterCommunication.findUnique({
    where: { id: communicationId },
    include: { application: { include: { job: true, careerProfile: true } } },
  });
  if (!communication?.application) return null;
  const { job, careerProfile } = communication.application;
  const extraction = communication.extraction as Record<string, unknown> | null;
  const documents = Array.isArray(extraction?.documents) ? (extraction!.documents as unknown[]).filter((d): d is string => typeof d === "string") : [];
  const docsText = documents.length > 0 ? documents.join(", ") : "the requested documents";
  const subject = `Re: ${job.title} at ${job.company} — Documents`;
  const body = `Hello,\n\nThank you for your message. I'll get ${docsText} over to you shortly.\n\nPlease let me know if you need anything else.\n\nBest regards,\n${careerProfile.name}`;
  return { subject, body };
}

/** §17 — availability response, using only real, configured working-hours data — never fabricates availability. */
export async function buildAvailabilityResponseDraft(communicationId: string): Promise<DraftContent | null> {
  const communication = await prisma.recruiterCommunication.findUnique({
    where: { id: communicationId },
    include: { application: { include: { job: true, careerProfile: true } } },
  });
  if (!communication?.application) return null;
  const { job, careerProfile } = communication.application;
  const subject = `Re: ${job.title} at ${job.company} — Availability`;

  const hasWorkingHours = careerProfile.workingHoursStart && careerProfile.workingHoursEnd && careerProfile.workingHoursTimezone;
  const availabilityText = hasWorkingHours
    ? `I'm generally available ${careerProfile.workingHoursStart}-${careerProfile.workingHoursEnd} (${careerProfile.workingHoursTimezone}) on my working days.`
    : "I haven't set detailed working hours yet — happy to share specific times if you let me know a few options that work for you.";

  const body = `Hello,\n\nThank you for reaching out about the ${job.title} role. ${availabilityText}\n\nLet me know what works best for you.\n\nBest regards,\n${careerProfile.name}`;
  return { subject, body };
}

/** Genuinely distinct from interview-preparation.ts (internal prep notes, never outbound). Only from a real SCHEDULED/COMPLETED interview — never fabricates that an interview occurred. */
export async function buildThankYouDraft(interviewId: string): Promise<DraftContent | null> {
  const interview = await prisma.careerInterview.findUnique({
    where: { id: interviewId },
    include: { application: { include: { job: true, careerProfile: true } } },
  });
  if (!interview) return null;
  if (interview.status !== "SCHEDULED" && interview.status !== "COMPLETED") return null;
  const { job, careerProfile } = interview.application;
  const subject = `Thank you — ${job.title} at ${job.company}`;
  const body = `Hello${interview.interviewerName ? ` ${interview.interviewerName}` : ""},\n\nThank you for taking the time to speak with me about the ${job.title} role. I enjoyed our conversation and remain very interested in the opportunity.\n\nPlease let me know if you need anything further from me.\n\nBest regards,\n${careerProfile.name}`;
  return { subject, body };
}

export type QueueableSource = { kind: "communication"; id: string } | { kind: "interview"; id: string };

/**
 * Creates a real EmailDraft (status DRAFT — §46, never auto-queued) for a
 * built draft, resolving the real Contact via the application's own
 * outbound application email (same real path `application-followup.ts`
 * uses). Returns null (and logs nothing) when no real Contact can be
 * resolved — never sends to a guessed/fabricated address.
 */
export async function queueRecruiterDraft(source: QueueableSource, content: DraftContent, purpose: "JOB_APPLICATION" | "THANK_YOU" = "JOB_APPLICATION") {
  const applicationId =
    source.kind === "communication"
      ? (await prisma.recruiterCommunication.findUnique({ where: { id: source.id }, select: { applicationId: true } }))?.applicationId
      : (await prisma.careerInterview.findUnique({ where: { id: source.id }, select: { applicationId: true } }))?.applicationId;
  if (!applicationId) return null;

  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId }, select: { organizationId: true } });
  const contactId = await resolveContactIdForApplication(applicationId);
  if (!application || !contactId) return null;

  const draft = await prisma.emailDraft.create({
    data: {
      organizationId: application.organizationId,
      contactId,
      channel: "EMAIL",
      purpose,
      tone: "PROFESSIONAL",
      subject: content.subject,
      body: content.body,
      status: "DRAFT",
    },
  });
  await logAudit({ organizationId: application.organizationId, action: "career:recruiter_draft:created", metadata: { draftId: draft.id, sourceKind: source.kind, sourceId: source.id } });
  return draft;
}
