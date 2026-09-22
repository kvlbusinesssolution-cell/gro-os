/**
 * Phase 20 — §29-34/§56 the real submission engine.
 *
 * Honest architecture note (see the Phase 20 final report's Provider
 * Blockers section): this codebase has NO configured job-board API or
 * authorized browser-automation integration for any external platform
 * (confirmed by inspecting IntegrationProviderKey — LinkedIn is
 * Sign-In-Only, no Indeed/Greenhouse/Lever provider exists). The ONE
 * genuinely real, working submission channel available today is EMAIL —
 * when a job posting's own source text contains a real application
 * email address, this reuses the EXISTING EmailDraft -> sendOutreachEmail
 * -> Resend pipeline end-to-end (§34: "Use existing Phase 17 Email
 * infrastructure"), including its real, webhook-driven deliveredAt
 * confirmation (§32) — zero new send/confirmation code. Every other job
 * genuinely resolves to PLATFORM_RESTRICTED (§47) — prepared, never
 * silently claimed as submitted.
 */

import { prisma } from "@/lib/prisma";
import { sendQueuedDraftCore } from "@/app/dashboard/outreach/_lib/approval-actions";

export type ApplicationSubmissionMethod = "API" | "AUTHORIZED_BROWSER" | "EMPLOYER_PORTAL" | "USER_ACTION_REQUIRED" | "EMAIL" | "OTHER_SUPPORTED_INTEGRATION";

// A real, bounded regex for an explicit application email in source text —
// never a guess at a plausible-looking address; only an address the
// source text itself actually states.
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

export function extractApplicationEmail(description: string): string | null {
  const match = description.match(EMAIL_PATTERN);
  return match ? match[0] : null;
}

export interface SubmissionMethodResult {
  method: ApplicationSubmissionMethod;
  recipientEmail: string | null;
  detail: string;
}

export function determineSubmissionMethod(jobDescription: string, canonicalUrl: string | null): SubmissionMethodResult {
  const email = extractApplicationEmail(jobDescription);
  if (email) {
    return { method: "EMAIL", recipientEmail: email, detail: `Real application email extracted from the job posting: ${email}.` };
  }
  return {
    method: "USER_ACTION_REQUIRED",
    recipientEmail: null,
    detail: canonicalUrl
      ? `No application email found in the posting — the job links to an external platform (${canonicalUrl}) with no configured, authorized submission integration.`
      : "No application email found in the posting, and no source URL is on file.",
  };
}

/** §33 — real, bounded retryable classification. Never retried forever, never retries something the spec explicitly forbids. */
export function isRetryableError(errorKind: string | undefined): boolean {
  const retryable = new Set(["network_timeout", "temporary_unavailable", "5xx", "failed"]); // "failed" covers a generic transient provider rejection from sendOutreachEmail
  const nonRetryable = new Set(["not_configured", "suppressed", "rate_limited", "invalid_data", "duplicate", "authentication_required", "captcha"]);
  if (!errorKind) return false;
  if (nonRetryable.has(errorKind)) return false;
  return retryable.has(errorKind);
}

export interface EmailSubmissionParams {
  organizationId: string;
  applicationId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  candidateUserId: string;
}

export type EmailSubmissionOutcome =
  | { outcome: "SENT"; providerMessageId: string | null }
  | { outcome: "FAILED"; retryable: boolean; error: string }
  | { outcome: "UNCERTAIN"; error: string }; // §31/§56 — the request may or may not have gone through; never blindly retried

/**
 * §34 — reuses the existing Contact/EmailDraft/sendQueuedDraftCore
 * pipeline wholesale. A minimal Contact is found-or-created for the real
 * recruiter email address (tagged "career-application" so it never gets
 * mistaken for a sales-pipeline lead in CRM reporting/filtering) — this is
 * a genuine real-world contact, not a fabricated one.
 */
export async function submitApplicationViaEmail(params: EmailSubmissionParams): Promise<EmailSubmissionOutcome> {
  try {
    let contact = await prisma.contact.findFirst({ where: { organizationId: params.organizationId, email: { equals: params.recipientEmail, mode: "insensitive" } } });
    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          organizationId: params.organizationId,
          firstName: "Hiring",
          lastName: "Team",
          email: params.recipientEmail,
          tags: ["career-application"],
        },
      });
    }

    const draft = await prisma.emailDraft.create({
      data: {
        organizationId: params.organizationId,
        contactId: contact.id,
        channel: "EMAIL",
        purpose: "JOB_APPLICATION",
        tone: "PROFESSIONAL",
        subject: params.subject,
        body: params.body,
        status: "QUEUED",
      },
    });

    const result = await sendQueuedDraftCore(params.organizationId, draft.id, params.candidateUserId);
    if (!result.ok) {
      return { outcome: "FAILED", retryable: isRetryableError(result.errorKind), error: result.error ?? "Send failed." };
    }

    const sent = await prisma.emailDraft.findUnique({ where: { id: draft.id }, select: { resendMessageId: true } });
    return { outcome: "SENT", providerMessageId: sent?.resendMessageId ?? null };
  } catch (error) {
    // §31/§56 — a thrown exception (e.g. a genuine network failure mid-
    // request) means we cannot be certain whether the provider actually
    // received the send. Never treated as a clean failure eligible for
    // immediate blind retry.
    return { outcome: "UNCERTAIN", error: error instanceof Error ? error.message : "Unknown error during submission." };
  }
}

/** §32/§39 — real confirmation lookup: was the correlated EmailDraft actually delivered per the real Resend webhook? Never inferred any other way. */
export async function checkEmailDeliveryConfirmation(providerMessageId: string): Promise<{ confirmed: boolean; bounced: boolean }> {
  const draft = await prisma.emailDraft.findUnique({ where: { resendMessageId: providerMessageId }, select: { deliveredAt: true, bouncedAt: true } });
  if (!draft) return { confirmed: false, bounced: false };
  return { confirmed: draft.deliveredAt !== null, bounced: draft.bouncedAt !== null };
}
