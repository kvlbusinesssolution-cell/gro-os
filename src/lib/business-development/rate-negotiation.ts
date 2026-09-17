import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { isAIConnected } from "@/lib/ai/client";
import { generateStructured } from "@/lib/ai/fallback";
import { KVL_PRICING } from "./kvl-service-catalog";
import { KVL_OWNER_REPORT_EMAIL } from "./kvl-sector-discovery-job";

/**
 * KVL-only real owner-in-the-loop rate-negotiation escalation (built
 * 2026-09-17 per the owner's own description of how KVL actually prices
 * work: scope-based, ₹25,000 floor, no fixed ceiling — real quotes range
 * from ₹25,000 to ₹1,20,00,000+ depending on the work). Triggered only from
 * kvl-reply-sync-job.ts's real IMAP-captured client replies (never from the
 * generic, multi-tenant reply-actions.ts path — this is deliberately not
 * wired into every org's applyReplyAutomation, same "KVL-only, hardcoded"
 * convention as kvl-sector-discovery-job.ts itself; a generic per-org
 * version would need real per-org owner-email configuration this app
 * doesn't have yet).
 *
 * Flow: client reply classified PRICE_QUESTION (Phase 6 ReplyIntent) ->
 * initiateRateNegotiation emails the real owner (KVL_OWNER_REPORT_EMAIL)
 * with a grounded rate recommendation -> owner's own real reply (captured
 * via the same IMAP mailbox) is the final word -> completeRateNegotiation
 * AfterOwnerReply relays it to the client as a human-approved EmailDraft
 * (never auto-sent — same ironclad approval-gate discipline as every other
 * draft in this app) and requests a real closing meeting for the owner.
 */

const RateRecommendationSchema = z.object({
  recommendedRateINR: z.number().int().positive().nullable(),
  reasoning: z.string(),
});

interface ScopeContext {
  summary: string;
  hasRealScope: boolean;
}

/** Only ever built from already-persisted, real rows — never invents project detail the company hasn't actually shown. */
async function buildScopeContext(companyId: string): Promise<ScopeContext> {
  const [opportunity, intelligence] = await Promise.all([
    prisma.leadOpportunity.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" } }),
    prisma.companyIntelligence.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" } }),
  ]);

  const parts: string[] = [];
  if (opportunity) {
    parts.push(
      `Detected opportunity: "${opportunity.title}" — ${opportunity.description}${
        opportunity.recommendedService ? ` (recommended service: ${opportunity.recommendedService})` : ""
      }${opportunity.estimatedValue ? ` — estimated value ₹${opportunity.estimatedValue.toLocaleString("en-IN")}` : ""}.`,
    );
  }
  if (intelligence?.recommendedSolution) {
    parts.push(`AI company research recommended solution: ${intelligence.recommendedSolution}.`);
  }
  if (intelligence?.estimatedProjectValue) {
    parts.push(`AI research's own estimated project value: ₹${intelligence.estimatedProjectValue.toLocaleString("en-IN")}.`);
  }
  if (intelligence?.estimatedSoftwareNeeds?.length) {
    parts.push(`Estimated software needs: ${intelligence.estimatedSoftwareNeeds.join(", ")}.`);
  }

  if (parts.length === 0) {
    return { summary: "No real project-scope information has been gathered for this company yet — no opportunity brief or company research on file.", hasRealScope: false };
  }
  return { summary: parts.join(" "), hasRealScope: true };
}

async function recommendRate(clientMessage: string, scope: ScopeContext): Promise<{ recommendedRateINR: number | null; reasoning: string }> {
  if (!isAIConnected()) {
    return { recommendedRateINR: null, reasoning: "AI is not connected — no automated rate recommendation available. The owner should set the rate directly based on the real project scope below." };
  }
  try {
    const result = await generateStructured({
      system: `You are helping KVL Business Solutions' owner respond to a real client who is negotiating on price for a website/software/digital-marketing project. KVL's real, fixed pricing floor is ₹${KVL_PRICING.minRateINR.toLocaleString("en-IN")} — never recommend anything below this floor. There is NO fixed ceiling; real KVL projects have ranged up to ₹1,20,00,000+ depending on actual scope. ${KVL_PRICING.note}

Ground your recommendation ONLY in the real scope information provided below. If there is genuinely not enough real information to size the work, return "recommendedRateINR": null and explain in "reasoning" that more scope detail is needed before quoting anything beyond the floor — never invent project detail or guess a number with no basis. Otherwise return your best real-world INR rate recommendation as "recommendedRateINR" and a short, honest "reasoning" grounded in the scope information and the client's own message.`,
      userContent: `Client's real message (asking about price): "${clientMessage}"\n\nReal scope information on file for this company: ${scope.summary}`,
      maxTokens: 400,
      effort: "low",
      schema: RateRecommendationSchema,
    });
    return result.parsed;
  } catch (error) {
    console.error("[rate-negotiation] recommendRate failed:", error);
    return { recommendedRateINR: null, reasoning: "AI rate recommendation failed — the owner should set the rate directly based on the real project scope below." };
  }
}

export interface InitiateRateNegotiationResult {
  ok: boolean;
  error?: string;
  negotiationId?: string;
}

/** Called right after a real client reply is logged with intent PRICE_QUESTION — see kvl-reply-sync-job.ts. */
export async function initiateRateNegotiation(replyId: string): Promise<InitiateRateNegotiationResult> {
  const reply = await prisma.reply.findUnique({
    where: { id: replyId },
    include: { contact: { include: { company: true } } },
  });
  if (!reply) return { ok: false, error: "Reply not found." };
  if (!reply.contact.companyId || !reply.contact.company) {
    return { ok: false, error: "Reply's contact has no linked company — cannot ground a rate recommendation." };
  }

  // Idempotency guard — a reply is 1:1 with a negotiation (schema-enforced
  // unique replyId), so a retry of this same reply must not create a
  // second thread/second owner email.
  const existing = await prisma.rateNegotiation.findUnique({ where: { replyId } });
  if (existing) return { ok: true, negotiationId: existing.id };

  const company = reply.contact.company;
  const scope = await buildScopeContext(company.id);
  const recommendation = await recommendRate(reply.content, scope);

  const negotiation = await prisma.rateNegotiation.create({
    data: {
      organizationId: reply.organizationId,
      companyId: company.id,
      contactId: reply.contactId,
      replyId: reply.id,
      clientMessage: reply.content,
      scopeSummary: scope.summary,
      recommendedRateINR: recommendation.recommendedRateINR,
      recommendationReasoning: recommendation.reasoning,
      status: "AWAITING_OWNER",
    },
  });

  const rateLine = recommendation.recommendedRateINR
    ? `AI-recommended rate: ₹${recommendation.recommendedRateINR.toLocaleString("en-IN")}`
    : `AI could not recommend a specific rate (insufficient real scope information) — floor is ₹${KVL_PRICING.minRateINR.toLocaleString("en-IN")}`;

  const text = `${reply.contact.firstName} at ${company.name} replied asking about price:

"${reply.content}"

Real scope information on file: ${scope.summary}

${rateLine}
Reasoning: ${recommendation.reasoning}

Reply directly to this email with the rate you want to quote (in INR) and any notes — your reply will be relayed to the client as a draft (still goes through the normal approval step before sending) and a closing meeting will be requested for you.`;

  await sendEmail({
    to: KVL_OWNER_REPORT_EMAIL,
    subject: `Rate decision needed — ${reply.contact.firstName} at ${company.name} asked about price`,
    text,
  });

  await prisma.rateNegotiation.update({ where: { id: negotiation.id }, data: { ownerEmailSentAt: new Date() } });
  await logAudit({
    userId: reply.loggedByUserId,
    organizationId: reply.organizationId,
    action: "rate_negotiation.owner_email_sent",
    metadata: { negotiationId: negotiation.id, companyId: company.id, contactId: reply.contactId },
  });

  return { ok: true, negotiationId: negotiation.id };
}

export interface CompleteRateNegotiationResult {
  ok: boolean;
  error?: string;
  draftId?: string;
  meetingId?: string;
}

/** Called once the owner's own real reply email is captured — see kvl-reply-sync-job.ts. `ownerReplyContent` is the owner's real, unedited email body. */
export async function completeRateNegotiationAfterOwnerReply(negotiationId: string, ownerReplyContent: string): Promise<CompleteRateNegotiationResult> {
  const negotiation = await prisma.rateNegotiation.findUnique({
    where: { id: negotiationId },
    include: { contact: true, company: true },
  });
  if (!negotiation) return { ok: false, error: "Rate negotiation not found." };
  if (negotiation.status !== "AWAITING_OWNER") return { ok: true, draftId: negotiation.clientReplyDraftId ?? undefined, meetingId: negotiation.outreachMeetingId ?? undefined };

  await prisma.rateNegotiation.update({
    where: { id: negotiationId },
    data: { status: "OWNER_RESPONDED", ownerReplyContent, ownerRespondedAt: new Date() },
  });

  // The reply-to-client draft relays the owner's own real words — never
  // AI-embellished or paraphrased — wrapped in a minimal, honest intro.
  // Still lands at DRAFT and goes through the normal Review -> Approve ->
  // Send pipeline, same as every other draft in this app.
  const draft = await prisma.emailDraft.create({
    data: {
      organizationId: negotiation.organizationId,
      contactId: negotiation.contactId,
      channel: "EMAIL",
      purpose: "FOLLOW_UP",
      tone: "CONSULTATIVE",
      subject: "Re: your question about pricing",
      body: `Hi ${negotiation.contact.firstName},\n\nThanks for your patience — here's what we can do:\n\n${ownerReplyContent.trim()}\n\nHappy to set up a quick call to finalize details.`,
      status: "DRAFT",
    },
  });

  const meeting = await prisma.outreachMeeting.create({
    data: {
      organizationId: negotiation.organizationId,
      contactId: negotiation.contactId,
      emailDraftId: draft.id,
      title: `Final pricing / deal-closing call — ${negotiation.company.name}`,
      agenda: "Owner-led call to finalize scope and pricing and close the deal, following the rate the owner personally approved for this client.",
      status: "REQUESTED",
    },
  });

  await prisma.rateNegotiation.update({
    where: { id: negotiationId },
    data: { status: "CLIENT_REPLIED", clientReplyDraftId: draft.id, outreachMeetingId: meeting.id },
  });

  await logAudit({
    userId: negotiation.contact.ownerUserId ?? null,
    organizationId: negotiation.organizationId,
    action: "rate_negotiation.owner_responded",
    metadata: { negotiationId, draftId: draft.id, meetingId: meeting.id },
  });

  return { ok: true, draftId: draft.id, meetingId: meeting.id };
}
