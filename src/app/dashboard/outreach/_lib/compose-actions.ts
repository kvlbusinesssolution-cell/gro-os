"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { AINotConnectedError, isAIConnected } from "@/lib/ai/client";
import { generateStructured } from "@/lib/ai/fallback";
import { getPersona } from "@/lib/ai/personas";
import { buildContactContext } from "@/lib/outreach/personalization";
import { getContactTimeline } from "@/lib/outreach/inbox";
import { emailAddressSchema } from "@/lib/validations/outreach";
import { saveDocumentFile, deleteDocumentFile } from "@/lib/storage/documents";

// A "use server" file may only export async functions — Next.js strips/
// rejects any other export at build time (see
// src/app/dashboard/opportunities/_lib/opportunity-outreach-constants.ts for
// the real production incident this caused in a sibling file). So no shared
// `ComposeEmailResult` interface is exported here; the return type is
// inlined on both functions below instead.

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

/**
 * CC/BCC (Phase 3 Compose extension, now wired end to end): `EmailDraft.cc`/
 * `.bcc` are real `String[] @default([])` columns (migration
 * `20260917165930_email_draft_cc_bcc`), and `sendOutreachEmail`'s
 * `OutreachEmailInput` (src/lib/outreach/email-provider.ts) accepts/forwards
 * `cc`/`bcc` to all four real providers (Gmail/Outlook/Resend/SMTP). Each
 * address is validated with the same `emailAddressSchema` every other real
 * email field in this app uses (src/lib/validations/outreach.ts) — an
 * invalid address in either list fails the whole compose with a clear error
 * rather than silently dropping it or silently sending a malformed address
 * to a provider. Valid addresses are trimmed, lowercased, and de-duplicated
 * before persisting.
 *
 * Attachments reuse the app's existing Document/storage model — a Document
 * can be uploaded genuinely unlinked (see `uploadComposeAttachment` below,
 * built on the same `saveDocumentFile` primitive as the Documents module's
 * `uploadDocument`) before a real EmailDraft exists yet, then linked via
 * `Document.linkedEmailDraftId` inside the same transaction that creates the
 * draft. If draft creation fails for ANY reason (validation, a mismatched/
 * cross-org attachment id, a DB error), `cleanupOrphanedAttachments` deletes
 * those staged Documents again — Compose never leaves a dangling, unlinked
 * Document behind just because the human never finished saving.
 */
const MAX_COMPOSE_ATTACHMENT_BYTES = 20 * 1024 * 1024; // Matches src/app/dashboard/documents/actions.ts's MAX_FILE_BYTES convention.

/** `undefined`/empty in -> `{ ok: true, value: [] }`; every address must be real and well-formed, trimmed/lowercased/de-duplicated on the way out. */
function validateEmailList(emails: string[] | undefined, label: "Cc" | "Bcc"): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!emails || emails.length === 0) return { ok: true, value: [] };
  const cleaned: string[] = [];
  for (const raw of emails) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parsed = emailAddressSchema.safeParse(trimmed);
    if (!parsed.success) return { ok: false, error: `${label} has an invalid email address: "${trimmed}".` };
    cleaned.push(parsed.data);
  }
  return { ok: true, value: Array.from(new Set(cleaned)) };
}

/**
 * Deletes any staged (genuinely unlinked — `linkedEmailDraftId: null`)
 * Documents among `documentIds` that belong to `organizationId`, real file
 * and all. Scoped to this org and to still-unlinked rows only, so it can
 * never touch another org's Document (tenant isolation) or one that's
 * already legitimately linked to a different, already-saved draft.
 */
async function cleanupOrphanedAttachments(organizationId: string, documentIds: string[] | undefined): Promise<void> {
  if (!documentIds || documentIds.length === 0) return;
  const orphans = await prisma.document.findMany({
    where: { id: { in: documentIds }, organizationId, linkedEmailDraftId: null },
    select: { id: true, storageKey: true },
  });
  if (orphans.length === 0) return;

  await Promise.all(
    orphans.map(async (doc) => {
      try {
        if (doc.storageKey) await deleteDocumentFile(doc.storageKey);
      } catch (error) {
        console.error("[compose-actions] failed to delete an orphaned attachment's file:", error);
      }
    }),
  );
  await prisma.document.deleteMany({ where: { id: { in: orphans.map((d) => d.id) } } });
}

/**
 * Real file upload for a Compose attachment, staged BEFORE the EmailDraft
 * exists (Compose only creates the draft on Save/Schedule). Reuses the exact
 * same storage primitive as the Documents module's `uploadDocument`
 * (src/app/dashboard/documents/actions.ts) — `saveDocumentFile()` writing
 * under storage/documents/ — rather than a second upload path; this just
 * also returns the created Document's id (which `uploadDocument`'s
 * `ActionResult` doesn't) so the client can hand it to `composeEmail` for
 * linking once a real draft exists. The Document is created genuinely
 * unlinked; see `cleanupOrphanedAttachments` for what happens if Compose is
 * never actually saved.
 */
export async function uploadComposeAttachment(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; documentId?: string; name?: string; sizeBytes?: number }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  const organizationId = membership.organizationId;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to attach." };
  }
  if (file.size > MAX_COMPOSE_ATTACHMENT_BYTES) {
    return { ok: false, error: "Attachments must be 20MB or smaller." };
  }

  try {
    const document = await prisma.document.create({
      data: {
        organizationId,
        name: file.name,
        storageKey: "",
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        uploadedByUserId: userId,
      },
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    const storageKey = await saveDocumentFile(organizationId, document.id, file.name, buffer);
    await prisma.document.update({ where: { id: document.id }, data: { storageKey } });

    return { ok: true, documentId: document.id, name: document.name, sizeBytes: document.sizeBytes };
  } catch (error) {
    console.error("[compose-actions] uploadComposeAttachment failed:", error);
    return { ok: false, error: "Something went wrong uploading the attachment. Please try again." };
  }
}

/**
 * Headless core of composeEmail — no session, everything past the auth/
 * membership check (mirrors this repo's Core/wrapper convention, e.g.
 * convertOpportunityToOutreachCore).
 *
 * The created draft always lands at `status: "DRAFT"` — it goes through the
 * exact same existing Request Approval -> Approve -> Queue -> Send pipeline
 * (approval-actions.ts) as every AI-generated draft. This is deliberate: a
 * human composing fresh outbound content is exactly the case the approval
 * gate exists for, same as AI-generated content — never auto-approved or
 * auto-sent, and no new send logic is introduced.
 */
export async function composeEmailCore(
  organizationId: string,
  authorUserId: string,
  contactId: string,
  subject: string,
  body: string,
  opts?: { scheduledFor?: Date; cc?: string[]; bcc?: string[]; attachmentDocumentIds?: string[] },
): Promise<{ ok: boolean; error?: string; draftId?: string }> {
  const attachmentDocumentIds = (opts?.attachmentDocumentIds ?? []).filter(Boolean);

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== organizationId) {
    await cleanupOrphanedAttachments(organizationId, attachmentDocumentIds);
    return { ok: false, error: "Contact not found." };
  }
  if (contact.status === "UNSUBSCRIBED") {
    await cleanupOrphanedAttachments(organizationId, attachmentDocumentIds);
    return { ok: false, error: "This contact has unsubscribed — cannot compose a new email to them." };
  }

  const trimmedSubject = subject.trim();
  const trimmedBody = body.trim();
  if (!trimmedSubject) {
    await cleanupOrphanedAttachments(organizationId, attachmentDocumentIds);
    return { ok: false, error: "Subject is required." };
  }
  if (!trimmedBody) {
    await cleanupOrphanedAttachments(organizationId, attachmentDocumentIds);
    return { ok: false, error: "Body is required." };
  }

  let scheduledFor: Date | null = null;
  if (opts?.scheduledFor) {
    if (Number.isNaN(opts.scheduledFor.getTime())) {
      await cleanupOrphanedAttachments(organizationId, attachmentDocumentIds);
      return { ok: false, error: "Invalid scheduled time." };
    }
    if (opts.scheduledFor.getTime() <= Date.now()) {
      await cleanupOrphanedAttachments(organizationId, attachmentDocumentIds);
      return { ok: false, error: "Scheduled time must be in the future." };
    }
    scheduledFor = opts.scheduledFor;
  }

  const ccResult = validateEmailList(opts?.cc, "Cc");
  if (!ccResult.ok) {
    await cleanupOrphanedAttachments(organizationId, attachmentDocumentIds);
    return { ok: false, error: ccResult.error };
  }
  const bccResult = validateEmailList(opts?.bcc, "Bcc");
  if (!bccResult.ok) {
    await cleanupOrphanedAttachments(organizationId, attachmentDocumentIds);
    return { ok: false, error: bccResult.error };
  }

  let draftId: string;
  try {
    draftId = await prisma.$transaction(async (tx) => {
      const draft = await tx.emailDraft.create({
        data: {
          organizationId,
          contactId,
          channel: "EMAIL",
          purpose: "INTRODUCTION",
          tone: "PROFESSIONAL",
          subject: trimmedSubject,
          body: trimmedBody,
          status: "DRAFT",
          scheduledFor,
          cc: ccResult.value,
          bcc: bccResult.value,
        },
      });

      if (attachmentDocumentIds.length > 0) {
        // Only ever links Documents that are (a) in this exact org and (b)
        // still genuinely unlinked — a cross-org id, or one already attached
        // to a different draft, simply won't match and the count check below
        // rolls the whole draft back rather than silently under-linking.
        const linked = await tx.document.updateMany({
          where: { id: { in: attachmentDocumentIds }, organizationId, linkedEmailDraftId: null },
          data: { linkedEmailDraftId: draft.id },
        });
        if (linked.count !== attachmentDocumentIds.length) {
          throw new Error("ATTACHMENT_LINK_MISMATCH");
        }
      }

      return draft.id;
    });
  } catch (error) {
    await cleanupOrphanedAttachments(organizationId, attachmentDocumentIds);
    if (error instanceof Error && error.message === "ATTACHMENT_LINK_MISMATCH") {
      return {
        ok: false,
        error: "One or more attachments couldn't be linked — they may belong to a different organization or already be attached to another draft.",
      };
    }
    console.error("[compose-actions] composeEmailCore failed:", error);
    return { ok: false, error: "Something went wrong creating this draft. Please try again." };
  }

  await logAudit({
    userId: authorUserId,
    organizationId,
    action: "outreach.draft_composed_manually",
    metadata: {
      contactId,
      draftId,
      scheduledFor: scheduledFor ? scheduledFor.toISOString() : null,
      ccCount: ccResult.value.length,
      bccCount: bccResult.value.length,
      attachmentCount: attachmentDocumentIds.length,
    },
  });

  revalidatePath("/dashboard/outreach/inbox");
  revalidatePath(`/dashboard/outreach/contacts/${contactId}`);

  return { ok: true, draftId };
}

/** Session-gated Server Action wrapper — the real "Compose" affordance in the Inbox UI. */
export async function composeEmail(
  contactId: string,
  subject: string,
  body: string,
  opts?: { scheduledFor?: Date; cc?: string[]; bcc?: string[]; attachmentDocumentIds?: string[] },
): Promise<{ ok: boolean; error?: string; draftId?: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  return composeEmailCore(membership.organizationId, userId, contactId, subject, body, opts);
}

const WriteWithAIResponseSchema = z.object({
  subject: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1),
});

/**
 * Real-context-grounded AI PREVIEW for the Compose screen's "Write with AI"
 * button. Deliberately does NOT call `generateEmailDraft`
 * (src/lib/outreach/draft-generator.ts) — that function's contract is
 * "generate AND persist" (it always ends in `prisma.emailDraft.create`,
 * same convention as `generateCompanyIntelligence`), and a human still
 * reviewing/editing an AI suggestion before deciding whether to save it at
 * all must never already have a row in the database. So this reuses the
 * exact same real building blocks `generateEmailDraft` is built from —
 * `buildContactContext` (src/lib/outreach/personalization.ts, the same
 * real-data-only grounding summary: Company, most recent CompanyIntelligence
 * run, most recent non-dismissed LeadOpportunity, decision makers, lead/
 * intent scores — never fabricated), the same `OUTREACH` persona, and the
 * same `generateStructured` fallback-chain call — plus this contact's real
 * prior `EmailDraft`/`Reply` history via `getContactTimeline` (read-only
 * import from @/lib/outreach/inbox, unmodified) for continuity, which
 * `generateEmailDraft` itself doesn't consider. It just never writes the
 * result to the database: the human's later "Save Draft" click is what
 * calls `composeEmail`/`composeEmailCore`, same as if they'd typed the text
 * themselves. This is the real mechanism that keeps every AI-authored email
 * behind the same Draft -> Review -> Approve -> Send gate as everything
 * else — the AI never touches Prisma here.
 */
export async function composeEmailWithAI(
  contactId: string,
  instructions?: string,
): Promise<{ ok: boolean; error?: string; subject?: string; body?: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== membership.organizationId) return { ok: false, error: "Contact not found." };
  if (contact.status === "UNSUBSCRIBED") {
    return { ok: false, error: "This contact has unsubscribed — cannot generate a new draft for them." };
  }

  if (!isAIConnected()) {
    return { ok: false, error: "AI is not connected — configure an API key (Gemini/Anthropic/Groq/OpenRouter) to use Write with AI." };
  }

  const [context, timeline] = await Promise.all([
    buildContactContext(contactId),
    getContactTimeline(membership.organizationId, contactId),
  ]);

  const timelineText = summarizeTimelineForPrompt(timeline);
  const persona = getPersona("OUTREACH");
  const trimmedInstructions = instructions?.trim();

  try {
    const result = await generateStructured({
      system: `${persona.systemPrompt}

Write a real, one-off outbound email for a human to review and edit in a Compose screen before saving it as a draft — not a sequence step. Include a short, specific subject line (never generic like "Quick question"). Only reference facts present in the real context below — if there is no real researched detail to personalize with (no company, no opportunity, no prior conversation), write a genuinely short, honest, generic-but-still-professional email rather than inventing a company fact, a prior meeting, a price, or a promise that was never made. If a human instruction is given, follow it as a real steering preference from someone who knows the actual situation, but it never licenses inventing a fact that isn't in the context — if the instruction references something not present in the context (e.g. "mention the pricing we discussed" when no pricing appears below), write around it honestly instead of fabricating the detail.`,
      userContent: `Real context about this contact:\n\n${context}\n\n${timelineText}\n\n${
        trimmedInstructions ? `Human instruction for this draft: ${trimmedInstructions}\n\n` : ""
      }Write the email now.`,
      maxTokens: 1200,
      effort: "low",
      schema: WriteWithAIResponseSchema,
    });

    return { ok: true, subject: result.parsed.subject, body: result.parsed.body };
  } catch (error) {
    if (error instanceof AINotConnectedError) {
      return { ok: false, error: "AI is not connected — configure an API key to use Write with AI." };
    }
    return { ok: false, error: error instanceof Error ? error.message : "AI draft generation failed." };
  }
}

/**
 * Short, honest plain-text summary of this contact's real prior EmailDraft/
 * Reply history (already-sent drafts + logged replies, oldest to newest,
 * capped to the most recent 6 events to stay within prompt budget) for
 * "Write with AI" continuity — e.g. so a follow-up doesn't re-introduce
 * something already said. Every line quotes real, already-persisted
 * content; an empty timeline honestly says so rather than omitting the
 * section (which could read as "there may be history, just not shown").
 */
function summarizeTimelineForPrompt(timeline: Awaited<ReturnType<typeof getContactTimeline>>): string {
  if (timeline.length === 0) {
    return "Prior conversation history with this contact: none — this would be the first outreach to them.";
  }

  const recent = timeline.slice(-6);
  const lines = recent.map((event) => {
    if (event.type === "DRAFT") {
      const label = event.draft.status === "SENT" ? "We previously sent" : `We previously drafted (status: ${event.draft.status})`;
      const subjectPart = event.draft.subject ? ` — subject "${event.draft.subject}"` : "";
      return `- ${label}${subjectPart}: ${truncate(event.draft.body, 300)}`;
    }
    return `- They replied: ${truncate(event.reply.content, 300)}`;
  });

  return `Real prior conversation history with this contact (oldest to newest):\n${lines.join("\n")}`;
}

function truncate(text: string, maxLength: number): string {
  const trimmed = text.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

/**
 * Headless core of cancelScheduledEmail — no session (Core/wrapper
 * convention, matching composeEmailCore above).
 *
 * Deliberately reverts to a normal unscheduled APPROVED draft — NOT back to
 * DRAFT. `scheduledFor` only ever controls WHEN an already-approved draft
 * sends (see the EmailDraft.scheduledFor schema comment and
 * runScheduledEmailSend's doc comment); the real Approval decision behind
 * `status: "APPROVED"` (Approval.decision === "APPROVED",
 * decidedByUserId/decidedAt on that row) genuinely happened and is not being
 * undone by cancelling a send TIME. Reverting to DRAFT would misrepresent
 * that a real approval never occurred. Rejecting/reversing the approval
 * itself is the existing, distinct decideApproval action
 * (approval-actions.ts) — this function doesn't touch it. Only a still-
 * APPROVED (not yet QUEUED/SENT/etc.) scheduled draft can be cancelled —
 * once runScheduledEmailSend has promoted it to QUEUED there is nothing left
 * to cancel.
 */
export async function cancelScheduledEmailCore(
  organizationId: string,
  actingUserId: string,
  draftId: string,
): Promise<{ ok: boolean; error?: string }> {
  const draft = await prisma.emailDraft.findUnique({ where: { id: draftId } });
  if (!draft || draft.organizationId !== organizationId) return { ok: false, error: "Draft not found." };
  if (!draft.scheduledFor) return { ok: false, error: "This draft isn't scheduled." };
  if (draft.status !== "APPROVED") {
    return { ok: false, error: "This draft has already been queued or sent — its schedule can no longer be cancelled." };
  }

  await prisma.emailDraft.update({ where: { id: draftId }, data: { scheduledFor: null } });

  await logAudit({
    userId: actingUserId,
    organizationId,
    action: "outreach.scheduled_email_cancelled",
    metadata: { draftId, previousScheduledFor: draft.scheduledFor.toISOString() },
  });

  revalidatePath("/dashboard/outreach/inbox");
  revalidatePath(`/dashboard/outreach/contacts/${draft.contactId}`);
  return { ok: true };
}

/** Session-gated Server Action wrapper — the real "Cancel" affordance on a Scheduled draft in the Inbox UI. */
export async function cancelScheduledEmail(draftId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  return cancelScheduledEmailCore(membership.organizationId, userId, draftId);
}
