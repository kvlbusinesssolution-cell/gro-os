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
 * CC/BCC decision (Phase 3 Compose extension): `EmailDraft` has NO `cc`/
 * `bcc` column (confirmed by reading the model — only `subject`/`body`/
 * `personalizationNotes`/etc), and `sendOutreachEmail`'s `OutreachEmailInput`
 * (src/lib/outreach/email-provider.ts) only accepts `{ to, subject, html,
 * text }` at send time either — none of the four real providers it wraps
 * (Gmail/Outlook/Resend/SMTP) are ever passed a cc/bcc anywhere in that
 * file. So there is genuinely nowhere real for CC/BCC to go yet: no
 * persisted column and no send-time parameter. Repurposing
 * `personalizationNotes` (a `Json?` field that means "which real facts were
 * woven into an AI draft") to smuggle recipient addresses would be
 * semantically wrong and would silently corrupt that field's real meaning
 * for the approval-review UI. Rather than fabricate storage that quietly
 * drops the data (or worse, silently succeeds while never actually cc'ing/
 * bcc'ing anyone), `composeEmailCore`/`composeEmail` deliberately do NOT
 * accept `cc`/`bcc` params. The Compose UI instead renders CC/BCC fields as
 * disabled with an honest tooltip explaining they aren't wired to a real
 * column or send path yet — never accepting input that would be silently
 * thrown away. `scheduledFor`, by contrast, IS a real column on
 * `EmailDraft` (Phase 3), so it's fully supported below.
 */

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
  opts?: { scheduledFor?: Date },
): Promise<{ ok: boolean; error?: string; draftId?: string }> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== organizationId) return { ok: false, error: "Contact not found." };

  const trimmedSubject = subject.trim();
  const trimmedBody = body.trim();
  if (!trimmedSubject) return { ok: false, error: "Subject is required." };
  if (!trimmedBody) return { ok: false, error: "Body is required." };

  let scheduledFor: Date | null = null;
  if (opts?.scheduledFor) {
    if (Number.isNaN(opts.scheduledFor.getTime())) return { ok: false, error: "Invalid scheduled time." };
    if (opts.scheduledFor.getTime() <= Date.now()) return { ok: false, error: "Scheduled time must be in the future." };
    scheduledFor = opts.scheduledFor;
  }

  const draft = await prisma.emailDraft.create({
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
    },
  });

  await logAudit({
    userId: authorUserId,
    organizationId,
    action: "outreach.draft_composed_manually",
    metadata: { contactId, draftId: draft.id, scheduledFor: scheduledFor ? scheduledFor.toISOString() : null },
  });

  revalidatePath("/dashboard/outreach/inbox");
  revalidatePath(`/dashboard/outreach/contacts/${contactId}`);

  return { ok: true, draftId: draft.id };
}

/** Session-gated Server Action wrapper — the real "Compose" affordance in the Inbox UI. */
export async function composeEmail(
  contactId: string,
  subject: string,
  body: string,
  opts?: { scheduledFor?: Date },
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
