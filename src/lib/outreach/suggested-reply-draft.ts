import crypto from "crypto";

import { prisma } from "@/lib/prisma";

export interface CreateDraftFromSuggestedReplyResult {
  ok: boolean;
  error?: string;
  draftId?: string;
}

/**
 * Phase 6 — turns a Reply's AI `suggestedResponse` (already generated and
 * stored by analyzeReply/logReplyCore, reply-actions.ts) into a real,
 * human-reviewable `EmailDraft`. This deliberately does NOT call
 * generateEmailDraft (draft-generator.ts) — that function makes its own
 * fresh AI call and would produce DIFFERENT text than what's already stored
 * on the Reply and shown to the human as "the AI's suggested reply". Instead
 * this persists that exact text directly via prisma.emailDraft.create,
 * landing at status: "DRAFT" — the same starting point as every other
 * draft in this app, still requiring a human to Review -> Approve -> Send
 * via the existing draft-card.tsx / approval-actions.ts pipeline. Nothing
 * here sends anything.
 *
 * `purpose: "CONVERSATION_SUMMARY"` is used for every draft this creates.
 * Of the 11 real DraftPurpose values, it's the only one that represents
 * continuing an existing conversation thread rather than initiating a new
 * one (INTRODUCTION/PRODUCT_INTRODUCTION/CONNECTION_REQUEST) or nudging an
 * unresponsive prospect (FOLLOW_UP/REMINDER/RE_ENGAGEMENT are all framed
 * around "hasn't replied yet", which is the opposite of this case — they
 * DID reply). draft-generator.ts's own label text for CONVERSATION_SUMMARY
 * ("a short LinkedIn message summarizing the conversation so far") is just
 * that function's AI-prompt copy for when purpose+channel=LINKEDIN — it's
 * not a schema constraint. `channel` and `purpose` are independent columns,
 * and EMAIL + CONVERSATION_SUMMARY is a valid, real combination.
 */
export async function createDraftFromSuggestedReply(replyId: string): Promise<CreateDraftFromSuggestedReplyResult> {
  const reply = await prisma.reply.findUnique({
    where: { id: replyId },
    include: { contact: true, emailDraft: true },
  });

  if (!reply) return { ok: false, error: "Reply not found." };

  const suggestedResponse = reply.suggestedResponse?.trim();
  if (!suggestedResponse) {
    return {
      ok: false,
      error: "No suggested response was generated for this reply (AI may have been unavailable, or found nothing useful to suggest).",
    };
  }

  // Dedup: schema is frozen this phase, so there's no dedicated link field
  // to check. A reasonable, correct-enough existence check instead: has a
  // draft with this exact suggested body already been created for this
  // contact since this reply came in? If so, reuse it rather than creating
  // a second identical draft.
  const existing = await prisma.emailDraft.findFirst({
    where: {
      contactId: reply.contactId,
      body: suggestedResponse,
      createdAt: { gte: reply.createdAt },
    },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return { ok: true, draftId: existing.id };

  const subject = reply.emailDraft?.subject ? `Re: ${reply.emailDraft.subject}` : "Following up";

  // Mirrors generateEmailDraft's own agent-resolution convention
  // (draft-generator.ts) — same model field, same "org's OUTREACH-type
  // AIAgentInstance, null if none" lookup — since this function is creating
  // the same EmailDraft.generatedByAgentId this app's other draft-creation
  // path fills in.
  const outreachAgent = await prisma.aIAgentInstance.findFirst({
    where: { organizationId: reply.contact.organizationId, type: "OUTREACH" },
  });

  const draft = await prisma.emailDraft.create({
    data: {
      organizationId: reply.contact.organizationId,
      contactId: reply.contactId,
      channel: "EMAIL",
      purpose: "CONVERSATION_SUMMARY",
      tone: "PROFESSIONAL",
      subject,
      body: suggestedResponse,
      status: "DRAFT",
      generatedByAgentId: outreachAgent?.id,
      trackingToken: crypto.randomUUID(),
    },
  });

  return { ok: true, draftId: draft.id };
}
