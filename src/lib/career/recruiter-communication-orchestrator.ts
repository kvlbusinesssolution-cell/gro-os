import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { notifyUser } from "@/lib/notifications";
import { classifyRecruiterMessage, detectsSensitiveQuestion, type RecruiterExtraction } from "./recruiter-message-classification";
import { matchReplyToApplication } from "./recruiter-message-matching";
import { determineNextAction, type NextAction } from "./next-action-engine";
import { createOrUpdateInterviewFromCommunication } from "./interview-scheduling";

/**
 * Phase 21 — the real orchestration entry point. Called from
 * logReplyCore (reply-actions.ts) for EVERY new Reply, but does real work
 * ONLY when the Reply's Contact is tagged "career-application" (Phase 20's
 * application-submission.ts tag) — every other org's ordinary sales Reply
 * passes through untouched, exactly like the existing intent-recompute /
 * conversation-intelligence calls it sits alongside. Wrapped by the caller
 * in the same try/catch isolation discipline as those calls.
 */

// §9 — only resolves a normalized instant when the extraction is
// genuinely unambiguous (ISO date + HH:MM time + a real IANA timezone
// name). Anything else stays as the raw extracted text, never guessed.
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveInterviewDateTime(dateText: string | null, timeText: string | null, timezoneText: string | null): Date | null {
  if (!dateText || !timeText || !timezoneText) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  if (!/^\d{2}:\d{2}$/.test(timeText)) return null;
  if (!isValidTimezone(timezoneText)) return null;

  // Compute the UTC instant for the given local wall-clock time in the given IANA zone.
  const asUtcGuess = new Date(`${dateText}T${timeText}:00Z`);
  const offsetFormatter = new Intl.DateTimeFormat("en-US", { timeZone: timezoneText, timeZoneName: "shortOffset" });
  const offsetPart = offsetFormatter.formatToParts(asUtcGuess).find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = offsetPart.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  if (!match) return null;
  const offsetHours = Number(match[1]);
  const offsetMinutes = Number(match[2] ?? "0") * Math.sign(offsetHours || 1);
  const utcMillis = asUtcGuess.getTime() - (offsetHours * 60 + offsetMinutes) * 60_000;
  return new Date(utcMillis);
}

export interface ProcessResult {
  processed: boolean;
  communicationId?: string;
  nextAction?: NextAction;
}

export async function processCareerReply(replyId: string): Promise<ProcessResult> {
  const reply = await prisma.reply.findUnique({ where: { id: replyId }, include: { contact: true } });
  if (!reply) return { processed: false };
  if (!reply.contact.tags.includes("career-application")) return { processed: false };

  // §4 extension — classification runs first so its real extracted
  // company/role text can disambiguate among multiple real candidate
  // applications for the same contact (see recruiter-message-matching.ts).
  const classification = await classifyRecruiterMessage(reply.organizationId, reply.content);
  const extraction: RecruiterExtraction | Record<string, never> = classification?.extraction ?? {};
  const match = await matchReplyToApplication(replyId, {
    company: "company" in extraction ? (extraction.company?.value ?? null) : null,
    role: "role" in extraction ? (extraction.role?.value ?? null) : null,
  });

  const questionsText = "questions" in extraction ? (extraction.questions ?? []).join(" ") : "";
  const isSensitive = detectsSensitiveQuestion(`${reply.content} ${questionsText}`);

  const classificationType = classification?.classification ?? "UNKNOWN";
  const confidence = classification?.confidence ?? "UNKNOWN";

  const nextAction = determineNextAction({
    classification: classificationType,
    confidence,
    matchStatus: match.status,
    isSensitive,
  });
  const reviewRequired = nextAction === "USER_APPROVAL_REQUIRED" || confidence === "LOW" || confidence === "UNKNOWN";

  const communication = await prisma.recruiterCommunication.create({
    data: {
      organizationId: reply.organizationId,
      replyId,
      applicationId: match.status === "MATCHED" || match.status === "POSSIBLE_MATCH" ? match.applicationId : null,
      matchStatus: match.status,
      matchEvidence: match.evidence,
      classification: classificationType,
      classificationConfidence: confidence,
      classificationEvidence: classification?.evidence ?? (classification === null ? "AI provider not connected — classification could not run." : "No email content to classify."),
      extraction,
      nextAction,
      reviewRequired,
      isSensitive,
    },
  });

  await logAudit({ organizationId: reply.organizationId, action: "career:communication:classified", metadata: { communicationId: communication.id, replyId, classification: classificationType, confidence, matchStatus: match.status, nextAction } });

  // §59 — application status sync, ONLY on a real MATCHED link, ONLY
  // forward in the lifecycle, NEVER overwriting an already-terminal or
  // already-recorded outcome.
  if (match.status === "MATCHED" && match.applicationId) {
    const application = await prisma.jobApplication.findUnique({ where: { id: match.applicationId } });
    const terminalStatuses = new Set(["WITHDRAWN", "REJECTED", "OFFER", "CLOSED"]);
    if (application && !terminalStatuses.has(application.status)) {
      if (classificationType === "REJECTED" && confidence !== "LOW" && confidence !== "UNKNOWN") {
        await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "REJECTED", rejectedAt: new Date() } });
        await logAudit({ organizationId: reply.organizationId, action: "career:application:status_synced", metadata: { applicationId: application.id, newStatus: "REJECTED", source: "recruiter_communication", communicationId: communication.id } });
      } else if (classificationType === "OFFER" && confidence !== "LOW" && confidence !== "UNKNOWN") {
        await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "OFFER", offerDetectedAt: new Date() } });
        await logAudit({ organizationId: reply.organizationId, action: "career:application:status_synced", metadata: { applicationId: application.id, newStatus: "OFFER", source: "recruiter_communication", communicationId: communication.id } });
      } else if ((classificationType === "INTERVIEW_REQUEST" || classificationType === "SCREENING") && application.status !== "INTERVIEW") {
        await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "INTERVIEW", interviewDetectedAt: new Date() } });
        await logAudit({ organizationId: reply.organizationId, action: "career:application:status_synced", metadata: { applicationId: application.id, newStatus: "INTERVIEW", source: "recruiter_communication", communicationId: communication.id } });
      }
    }

    // §10 — only create an Interview record from actual evidence: a real INTERVIEW_REQUEST classification.
    if (classificationType === "INTERVIEW_REQUEST" && application) {
      const dateField = "dateText" in extraction ? extraction.dateText : null;
      const timeField = "timeText" in extraction ? extraction.timeText : null;
      const tzField = "timezoneText" in extraction ? extraction.timezoneText : null;
      const scheduledAtUtc = resolveInterviewDateTime(dateField?.value ?? null, timeField?.value ?? null, tzField?.value ?? null);

      await createOrUpdateInterviewFromCommunication({
        organizationId: reply.organizationId,
        careerProfileId: application.careerProfileId,
        applicationId: application.id,
        sourceCommunicationId: communication.id,
        stage: null,
        localDate: dateField?.value ?? null,
        localTime: timeField?.value ?? null,
        timezone: tzField?.value ?? null,
        scheduledAtUtc,
        durationMinutes: null,
        meetingLink: "meetingLink" in extraction ? (extraction.meetingLink?.value ?? null) : null,
        phone: "phone" in extraction ? (extraction.phone?.value ?? null) : null,
        interviewerName: "recruiterName" in extraction ? (extraction.recruiterName?.value ?? null) : null,
      });
    }
  }

  if (reviewRequired) {
    // Notify the real owner of the matched application (the candidate
    // whose job search this actually is) when known; the Contact created
    // by application-submission.ts has no ownerUserId of its own.
    const applicationOwner = match.status === "MATCHED" && match.applicationId ? (await prisma.jobApplication.findUnique({ where: { id: match.applicationId }, select: { userId: true } }))?.userId : null;
    const recipient = applicationOwner ?? reply.contact.ownerUserId ?? reply.loggedByUserId;
    await notifyUser({
      userId: recipient,
      organizationId: reply.organizationId,
      type: "APPROVAL_REQUESTED",
      title: "Recruiter reply needs your review",
      message: `A recruiter reply was classified as ${classificationType} (${confidence} confidence) and needs your review.`,
    });
  }

  return { processed: true, communicationId: communication.id, nextAction };
}
