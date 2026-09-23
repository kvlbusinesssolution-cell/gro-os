import { prisma } from "@/lib/prisma";
import { matchesWholeWord } from "@/lib/business-development/contact-classification";

/**
 * Phase 21 (§4) — real, deterministic Email → Application matching.
 * Deliberately conservative: only MATCHED when a real, strong reference
 * exists (the Reply is explicitly in-reply-to a specific application
 * EmailDraft). Falls back to Contact-based inference (§4's "sender
 * address", "prior email conversation") only for POSSIBLE_MATCH/AMBIGUOUS
 * — never silently attaches on weak evidence alone.
 *
 * Phase 32 (§4 extension) — when a contact has real applications to
 * MULTIPLE companies, the real extracted `company`/`role` text (from the
 * same AI classification pass, not an extra signal invented here) can
 * disambiguate which specific application a reply concerns — but only when
 * it narrows to EXACTLY ONE real candidate; two or more genuine matches (or
 * zero) still correctly falls to AMBIGUOUS/POSSIBLE_MATCH, never a guess.
 */

export type MatchStatus = "MATCHED" | "POSSIBLE_MATCH" | "UNMATCHED" | "AMBIGUOUS";

export interface MatchResult {
  status: MatchStatus;
  applicationId: string | null;
  evidence: string;
}

/**
 * Resolves which real JobApplication(s) this Contact has an outbound
 * career-application EmailDraft for (Phase 20's submitApplicationViaEmail
 * always creates a JOB_APPLICATION-purpose EmailDraft with a real
 * resendMessageId correlated to exactly one ApplicationDocument).
 */
async function findApplicationsForContact(contactId: string): Promise<string[]> {
  const drafts = await prisma.emailDraft.findMany({
    where: { contactId, purpose: "JOB_APPLICATION" },
    select: { resendMessageId: true },
  });
  const messageIds = drafts.map((d) => d.resendMessageId).filter((id): id is string => !!id);
  if (messageIds.length === 0) return [];

  const documents = await prisma.applicationDocument.findMany({
    where: { providerMessageId: { in: messageIds } },
    select: { applicationId: true },
  });
  return [...new Set(documents.map((d) => d.applicationId))];
}

export interface DisambiguationSignals {
  company: string | null;
  role: string | null;
}

/**
 * Phase 32 (§4) — among real candidate application IDs, narrows to exactly
 * one using real extracted company/role text, case-insensitive substring
 * match against each candidate's real Job.company/Job.title. Returns null
 * (never guesses) unless precisely one candidate matches.
 */
async function disambiguateByJobSignals(applicationIds: string[], signals: DisambiguationSignals): Promise<string | null> {
  if (!signals.company && !signals.role) return null;
  const applications = await prisma.jobApplication.findMany({
    where: { id: { in: applicationIds } },
    select: { id: true, job: { select: { company: true, title: true } } },
  });
  const company = signals.company?.toLowerCase().trim();
  const role = signals.role?.toLowerCase().trim();
  const matches = applications.filter((app) => {
    const jobCompany = app.job.company.toLowerCase();
    const jobTitle = app.job.title.toLowerCase();
    const companyMatches = company ? matchesWholeWord(jobCompany, company) || matchesWholeWord(company, jobCompany) : false;
    const roleMatches = role ? matchesWholeWord(jobTitle, role) || matchesWholeWord(role, jobTitle) : false;
    return companyMatches || roleMatches;
  });
  return matches.length === 1 ? matches[0].id : null;
}

export async function matchReplyToApplication(replyId: string, disambiguation?: DisambiguationSignals): Promise<MatchResult> {
  const reply = await prisma.reply.findUnique({
    where: { id: replyId },
    select: { contactId: true, emailDraftId: true },
  });
  if (!reply) return { status: "UNMATCHED", applicationId: null, evidence: "Reply not found." };

  // Strongest signal (§4): the reply is explicitly threaded to a specific
  // outbound EmailDraft — check whether THAT exact draft was a real
  // job-application send.
  if (reply.emailDraftId) {
    const draft = await prisma.emailDraft.findUnique({
      where: { id: reply.emailDraftId },
      select: { resendMessageId: true, purpose: true },
    });
    if (draft?.purpose === "JOB_APPLICATION" && draft.resendMessageId) {
      const document = await prisma.applicationDocument.findUnique({
        where: { providerMessageId: draft.resendMessageId },
        select: { applicationId: true },
      });
      if (document) {
        return { status: "MATCHED", applicationId: document.applicationId, evidence: "THREAD_REFERENCE — reply is explicitly in-reply-to this application's outbound email." };
      }
    }
  }

  // Fall back to the Contact's other real career-application sends.
  const applicationIds = await findApplicationsForContact(reply.contactId);
  if (applicationIds.length === 0) {
    return { status: "UNMATCHED", applicationId: null, evidence: "No real career-application email was ever sent to this sender." };
  }
  if (applicationIds.length === 1) {
    return { status: "POSSIBLE_MATCH", applicationId: applicationIds[0], evidence: "SINGLE_APPLICATION_FOR_CONTACT — exactly one real application email was sent to this sender, but the reply itself carries no direct thread reference." };
  }

  // §4 extension — real company/role text can narrow multiple real
  // candidates to exactly one; never used to invent a match from zero
  // candidates, and still AMBIGUOUS if it narrows to 0 or 2+.
  if (disambiguation) {
    const narrowed = await disambiguateByJobSignals(applicationIds, disambiguation);
    if (narrowed) {
      return { status: "POSSIBLE_MATCH", applicationId: narrowed, evidence: `JOB_SIGNAL_MATCH — the message's real extracted company/role text uniquely matches this application among ${applicationIds.length} candidates for this sender.` };
    }
  }

  return { status: "AMBIGUOUS", applicationId: null, evidence: `MULTIPLE_APPLICATIONS_FOR_CONTACT — ${applicationIds.length} real application emails were sent to this sender; cannot reliably attribute this reply without a direct thread reference${disambiguation ? " or a unique company/role match" : ""}.` };
}
