import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";
import { generateStructured } from "@/lib/ai/fallback";

export interface ConversationSummary {
  clientRequirements: string[];
  questionsAsked: string[];
  questionsAnswered: string[];
  objections: string[];
  pricingDiscussion: string;
  timelineDiscussion: string;
  requirementsConfirmed: string[];
  requirementsUnknown: string[];
  currentStatus: string;
  nextAction: string;
}

const ConversationSummarySchema = z.object({
  clientRequirements: z.array(z.string()),
  questionsAsked: z.array(z.string()),
  questionsAnswered: z.array(z.string()),
  objections: z.array(z.string()),
  pricingDiscussion: z.string(),
  timelineDiscussion: z.string(),
  requirementsConfirmed: z.array(z.string()),
  requirementsUnknown: z.array(z.string()),
  currentStatus: z.string(),
  nextAction: z.string(),
});

function contactLabel(contact: { firstName: string; lastName: string | null } | undefined): string {
  if (!contact) return "Contact";
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Contact";
}

/**
 * AI conversation summary for a Company, grounded ONLY in the real, full
 * text of every sent EmailDraft + every Reply from this company's contacts.
 * Returns null (never a fabricated summary of nothing) when there isn't any
 * real email/reply activity yet, when AI isn't connected, or when the call
 * fails — matching src/app/dashboard/outreach/_lib/reply-actions.ts's
 * analyzeReply graceful-null idiom.
 */
export async function summarizeCompanyConversation(organizationId: string, companyId: string): Promise<ConversationSummary | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, organizationId: true, name: true },
  });
  if (!company || company.organizationId !== organizationId) return null;

  const contacts = await prisma.contact.findMany({
    where: { companyId, organizationId },
    select: { id: true, firstName: true, lastName: true },
  });
  const contactIds = contacts.map((c) => c.id);
  if (contactIds.length === 0) return null;
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const [sentDrafts, replies] = await Promise.all([
    prisma.emailDraft.findMany({
      where: { contactId: { in: contactIds }, organizationId, sentAt: { not: null } },
      orderBy: { sentAt: "asc" },
      select: { id: true, contactId: true, subject: true, body: true, sentAt: true },
    }),
    prisma.reply.findMany({
      where: { contactId: { in: contactIds }, organizationId },
      orderBy: { receivedAt: "asc" },
      select: { id: true, contactId: true, content: true, receivedAt: true },
    }),
  ]);

  if (sentDrafts.length === 0 && replies.length === 0) return null;
  if (!isAIConnected()) return null;

  type TranscriptEntry = { at: Date; text: string };
  const transcript: TranscriptEntry[] = [];

  for (const draft of sentDrafts) {
    const label = contactLabel(contactById.get(draft.contactId));
    transcript.push({
      at: draft.sentAt!,
      text: `[${draft.sentAt!.toISOString()}] KVL -> ${label}${draft.subject ? ` (Subject: ${draft.subject})` : ""}:\n${draft.body}`,
    });
  }
  for (const reply of replies) {
    const label = contactLabel(contactById.get(reply.contactId));
    transcript.push({
      at: reply.receivedAt,
      text: `[${reply.receivedAt.toISOString()}] ${label} -> KVL:\n${reply.content}`,
    });
  }
  transcript.sort((a, b) => a.at.getTime() - b.at.getTime());

  const transcriptText = transcript.map((t) => t.text).join("\n\n---\n\n");

  try {
    const result = await generateStructured({
      system: `You are summarizing a real email conversation between our team and a prospective client (Company: ${company.name}). The transcript below is the complete, real, chronological set of sent emails and received replies for this company — nothing else exists.

Summarize ONLY what was actually said in this real transcript. Never invent a requirement, question, objection, price, or date that isn't actually present in the text. Never present your own interpretation as a confirmed client fact — if the real conversation doesn't clearly establish something (e.g. budget, timeline, a specific requirement), put it in "requirementsUnknown" rather than guessing at it. Return:
- clientRequirements: concrete things the client said they need/want, in their own terms.
- questionsAsked: real questions the client asked.
- questionsAnswered: which of those questions we (KVL) actually answered in the transcript, and how.
- objections: real pushback/concerns/hesitations the client raised.
- pricingDiscussion: a factual summary of what was actually said about price/budget — an honest "not discussed yet" if pricing never came up.
- timelineDiscussion: a factual summary of what was actually said about timeline/deadlines — an honest "not discussed yet" if it never came up.
- requirementsConfirmed: requirements that are clearly, explicitly established by the transcript.
- requirementsUnknown: things that matter for scoping/closing this deal but are NOT yet established by the real transcript — this is where genuine uncertainty belongs, never a guess.
- currentStatus: one or two real sentences on where this conversation actually stands right now.
- nextAction: one real, concrete next step grounded in what the transcript actually shows (e.g. what the client last asked for).`,
      userContent: transcriptText,
      maxTokens: 2000,
      effort: "medium",
      schema: ConversationSummarySchema,
    });
    return result.parsed;
  } catch (error) {
    console.error("[business-development] summarizeCompanyConversation failed:", error);
    return null;
  }
}
