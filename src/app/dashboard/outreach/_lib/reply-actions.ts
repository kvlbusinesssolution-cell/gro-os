"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { notifyUser } from "@/lib/notifications";
import { isAIConnected } from "@/lib/ai/client";
import { generateStructured } from "@/lib/ai/fallback";
import { applyReplyAutomation } from "@/lib/outreach/reply-automation";
import { ReplyIntent as ReplyIntentEnum } from "@/generated/prisma/client";
import type { DraftChannel, ReplySentiment, ReplyIntent } from "@/generated/prisma/client";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

// Built from the real Prisma enum's own values (not hand-copied) so a
// hallucinated category — or the enum drifting out from under this schema
// later — fails Zod validation instead of silently persisting garbage.
const REPLY_INTENT_VALUES = Object.values(ReplyIntentEnum) as [ReplyIntent, ...ReplyIntent[]];

const ReplyAnalysisSchema = z.object({
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  intent: z.enum(REPLY_INTENT_VALUES),
  intentConfidence: z.number().min(0).max(1),
  suggestedResponse: z.string(),
});

export interface ReplyAnalysis {
  sentiment: ReplySentiment | null;
  intent: ReplyIntent | null;
  intentConfidence: number | null;
  suggestedResponse: string | null;
}

const NULL_ANALYSIS: ReplyAnalysis = { sentiment: null, intent: null, intentConfidence: null, suggestedResponse: null };

/**
 * Single combined AI call over real, already-logged reply text — classifies
 * both tone (sentiment) and what the sender actually wants next (intent),
 * plus a grounded draft reply. Never a second round-trip on top of the old
 * classifySentiment; this replaces it outright. Never runs on anything
 * fabricated, and silently returns all-null (matches the old function's
 * graceful-skip behavior) if AI isn't connected or the call fails.
 */
async function analyzeReply(content: string): Promise<ReplyAnalysis> {
  if (!isAIConnected()) return NULL_ANALYSIS;
  try {
    const result = await generateStructured({
      system: `You are analyzing a real reply a prospect sent to a B2B cold-outreach email or LinkedIn message. Return three things about this exact reply:

1. "sentiment": the reply's overall tone — POSITIVE (interested), NEUTRAL (unclear/needs more info), or NEGATIVE (not interested/unsubscribe).
2. "intent": the single category that best describes what the sender actually wants to happen next. Choose exactly one of:
   - INTERESTED: wants to move forward / learn more, no specific ask yet
   - NOT_INTERESTED: declining, not now, not a fit
   - NEEDS_INFORMATION: asking a general question that isn't specifically about price
   - REQUEST_CALL: asking for a call/meeting/demo
   - REQUEST_PROPOSAL: asking for a proposal, quote, or formal document
   - FOLLOW_UP_LATER: interested but asking to be contacted at a later time
   - PRICE_QUESTION: asking specifically about pricing/cost
   - WRONG_CONTACT: says this isn't the right person, refers elsewhere
   - OUT_OF_OFFICE: an automated out-of-office / away reply
   - UNSUBSCRIBE: asking to stop being contacted / opt out
   - UNKNOWN: genuinely doesn't fit any of the above, or too ambiguous to tell
3. "intentConfidence": your confidence in the intent classification, 0 to 1.
4. "suggestedResponse": a short, real draft reply grounded ONLY in what this specific message actually says. Never generic boilerplate ("Thanks for reaching out!" with nothing specific). Never invent facts, prices, dates, features, or promises that aren't already established as true. If the message is too short, too ambiguous, or there's genuinely nothing useful to suggest, return an empty string ("") for suggestedResponse rather than padding it out.`,
      userContent: content,
      maxTokens: 500,
      effort: "low",
      schema: ReplyAnalysisSchema,
    });
    return result.parsed;
  } catch (error) {
    console.error("[outreach] analyzeReply failed:", error);
    return NULL_ANALYSIS;
  }
}

export interface LogReplyResult extends ActionResult {
  replyId?: string;
  sentiment?: ReplySentiment | null;
  intent?: ReplyIntent | null;
}

/**
 * Headless core of logReply — no session, callable from a real automated
 * source of genuine reply content (kvl-reply-sync-job.ts's real IMAP
 * inbox-read) as well as from the session-gated Server Action below.
 * Mirrors advanceSequence/advanceSequenceCore's exact split
 * (src/app/dashboard/outreach/_lib/sequence-actions.ts). `content` must
 * still be real — either a human's own manual account of what a prospect
 * wrote, or, for the automated caller, the actual body of a real received
 * email — never AI-fabricated either way.
 */
export async function logReplyCore(
  organizationId: string,
  loggedByUserId: string,
  contactId: string,
  content: string,
  channel: DraftChannel,
  emailDraftId?: string,
  receivedAt?: Date,
): Promise<LogReplyResult> {
  if (!content.trim()) return { ok: false, error: "Enter what the prospect actually wrote back." };

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== organizationId) return { ok: false, error: "Contact not found." };

  const { sentiment, intent, intentConfidence, suggestedResponse } = await analyzeReply(content);

  const reply = await prisma.reply.create({
    data: {
      organizationId,
      contactId,
      emailDraftId: emailDraftId || null,
      channel,
      content: content.trim(),
      sentiment,
      intent,
      intentConfidence,
      suggestedResponse: suggestedResponse || null,
      loggedByUserId,
      receivedAt: receivedAt ?? undefined,
    },
  });

  const nextStatus = sentiment === "POSITIVE" ? "INTERESTED" : sentiment === "NEGATIVE" ? "NOT_INTERESTED" : "REPLIED";
  await prisma.contact.update({ where: { id: contactId }, data: { status: nextStatus } });

  // Sync back to the linked Company — a real reply is a real CRM-worthy
  // signal, same "sync status forward, never backward" rule as
  // addCompanyToCrm's PROSPECT->LEAD bump.
  if (contact.companyId && sentiment === "POSITIVE") {
    const company = await prisma.company.findUnique({ where: { id: contact.companyId } });
    if (company?.status === "PROSPECT") {
      await prisma.company.update({ where: { id: contact.companyId }, data: { status: "LEAD" } });
    }
  }

  await notifyUser({
    userId: contact.ownerUserId ?? loggedByUserId,
    organizationId,
    type: "CRM_EVENT",
    title: "New reply logged",
    message: `${contact.firstName} replied${sentiment ? ` (${sentiment.toLowerCase()})` : ""}.`,
  });

  await logAudit({ userId: loggedByUserId, organizationId, action: "outreach.reply_logged", metadata: { contactId, replyId: reply.id, sentiment } });
  revalidatePath("/dashboard/outreach");
  revalidatePath(`/dashboard/outreach/contacts/${contactId}`);
  return { ok: true, replyId: reply.id, sentiment, intent };
}

/** The real, manual "I got a reply" entry point — session-gated wrapper around logReplyCore. */
export async function logReply(contactId: string, content: string, channel: DraftChannel, emailDraftId?: string): Promise<LogReplyResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const result = await logReplyCore(membership.organizationId, userId, contactId, content, channel, emailDraftId);

  // Automation acts on the intent logReplyCore already classified — kept
  // additive and outside logReplyCore itself, same Core/wrapper split
  // discipline as the rest of this file. A failure here must never turn a
  // successfully logged reply into a reported failure.
  if (result.ok && result.replyId) {
    try {
      await applyReplyAutomation(result.replyId);
    } catch (error) {
      console.error("[outreach] applyReplyAutomation failed:", error);
    }
  }

  return result;
}
