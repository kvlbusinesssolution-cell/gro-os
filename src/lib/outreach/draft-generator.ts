import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { AINotConnectedError, isAIConnected } from "@/lib/ai/client";
import { generateStructured } from "@/lib/ai/fallback";
import { getPersona } from "@/lib/ai/personas";
import { buildContactContext } from "./personalization";
import type { DraftChannel, DraftPurpose, EmailTone, EmailDraft } from "@/generated/prisma/client";

const DraftResponseSchema = z.object({
  subject: z.string().trim().max(150).optional(),
  body: z.string().trim().min(1),
  // Which real facts from the context were actually woven in — powers
  // "Highlight personalization" in the preview UI, recorded honestly by the
  // model itself rather than guessed after the fact.
  personalizationNotes: z.array(z.string().trim().min(1)).max(6),
});

const PURPOSE_LABEL: Record<DraftPurpose, string> = {
  INTRODUCTION: "a first-touch introduction email",
  FOLLOW_UP: "a follow-up email to a prospect who hasn't replied yet",
  MEETING_REQUEST: "a meeting request email",
  PRODUCT_INTRODUCTION: "an email introducing a specific product/service",
  PROPOSAL_REQUEST: "an email asking to send over a proposal",
  CASE_STUDY: "an email sharing a relevant case study",
  THANK_YOU: "a thank-you email",
  REMINDER: "a gentle reminder email",
  RE_ENGAGEMENT: "a re-engagement email to a cold/inactive prospect",
  CONNECTION_REQUEST: "a LinkedIn connection request note",
  CONVERSATION_SUMMARY: "a short LinkedIn message summarizing the conversation so far",
};

const TONE_LABEL: Record<EmailTone, string> = {
  PROFESSIONAL: "professional",
  ENTERPRISE: "enterprise-formal",
  FRIENDLY: "friendly and warm",
  FORMAL: "formal",
  CONSULTATIVE: "consultative, advisory",
};

export interface GenerateDraftParams {
  contactId: string;
  purpose: DraftPurpose;
  tone: EmailTone;
  channel: DraftChannel;
  campaignId?: string;
  sequenceId?: string;
  sequenceStepIndex?: number;
  abVariant?: string;
  abTestGroupId?: string;
  /**
   * Real facts about the SENDING organization (services, differentiators,
   * proof of work, a real meeting-booking link) to ground the pitch side of
   * the email — buildContactContext only ever covers the recipient. Optional
   * and caller-supplied so this stays a generic, reusable field rather than
   * hardcoding any one org's facts into this shared function; see
   * kvl-sector-discovery-job.ts's KVL_COMPANY_PROFILE for the real KVL
   * Business Solutions block (sourced from kvlbusinesssolutions.com, not
   * invented).
   */
  extraContext?: string;
}

/**
 * Generates one real AI email/LinkedIn draft — a single client.messages.parse
 * call (no web_search — grounded purely in buildContactContext's real data),
 * mirrors src/lib/scanner/ai-report-generator.ts's pattern exactly. The same
 * function serves both channels: LinkedIn omits the subject and uses a
 * tighter character budget in the prompt. Persists the EmailDraft itself
 * (status: DRAFT), same "generate-and-persist" convention as
 * generateCompanyIntelligence.
 */
export async function generateEmailDraft(params: GenerateDraftParams): Promise<EmailDraft> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: params.contactId } });
  const persona = getPersona("OUTREACH");
  const outreachAgent = await prisma.aIAgentInstance.findFirst({ where: { organizationId: contact.organizationId, type: "OUTREACH" } });
  const context = await buildContactContext(params.contactId);

  if (outreachAgent) {
    await prisma.aIAgentInstance.update({
      where: { id: outreachAgent.id },
      data: {
        status: "THINKING",
        currentTask: `Drafting ${params.channel === "LINKEDIN" ? "a LinkedIn message" : params.channel === "WHATSAPP" ? "a WhatsApp message" : "an email"} for ${contact.firstName}`,
      },
    });
  }

  const channelInstructions =
    params.channel === "LINKEDIN"
      ? "This is a LinkedIn message, not an email — do NOT include a subject line. Keep it under 300 characters, conversational, no email-style greeting/signature block."
      : params.channel === "WHATSAPP"
        ? // §20/§21 of the WhatsApp Business Outreach spec: a WhatsApp message
          // reads as a short, real conversational text, not an email —
          // never a subject line, never an email-style greeting/signature
          // block, never inventing a commitment (price/date/guarantee) not
          // already present in the grounding context.
          "This is a real WhatsApp Business message, not an email — do NOT include a subject line. Keep it under 400 characters, short and conversational like a real text message, no email-style greeting (\"Dear...\") or signature block. Never invent a price, discount, delivery date, guarantee, or commitment not already present in the context below — if something isn't covered, write a neutral line inviting the recipient to share more, rather than guessing."
        : // A real production bug, confirmed via an actual sent email: the model
          // would sometimes end with a bare "Best regards," and stop, with no
          // name after it — an incomplete-looking sign-off. Nobody's real name
          // is known here (never invent one), but the real company name is —
          // require the body to close with it every time.
          "This is a real cold email. Include a short, specific subject line (never generic like 'Quick question'). The body MUST end with a complete sign-off — never leave a closing line like \"Best regards,\" dangling with nothing after it. Sign off with the real company name \"KVL Business Solutions\" (e.g. \"Best regards,\\nKVL Business Solutions\") — never invent a specific person's name, since no individual sender name is provided in this context.";

  try {
    const result = await generateStructured({
      system: `${persona.systemPrompt}\n\nWrite ${PURPOSE_LABEL[params.purpose]}, in a ${TONE_LABEL[params.tone]} tone. ${channelInstructions} Only reference facts present in the context below — if there's no real researched pain point or tech-stack detail, write a genuinely short, honest, generic-but-still-personal intro rather than inventing a fact. List in personalizationNotes exactly which real facts you actually used (e.g. "mentioned their industry", "referenced a real researched pain point") — if you used none, return an empty array, never a fabricated note.

Writing quality bar — this represents KVL Business Solutions to a real prospect, so it must read like it was written by a sharp, respectful human, not a generic AI template: plain, natural sentences (no corporate filler like "I hope this email finds you well", "in today's fast-paced world", "leverage synergies", "unlock potential"); vary sentence length instead of a flat rhythm; exactly one clear, low-friction ask, never a laundry list of questions; confident and warm, never pushy, salesy, or apologetic. Read it back mentally as if you were the recipient — if it sounds like spam or a mail-merge blast, rewrite it.${
        params.extraContext
          ? ` The context below also includes real facts about our own company (services, proof of work, guarantees, a real booking link) — weave in ONLY what's genuinely relevant to this specific recipient's industry/situation (never list every service), concretely tie it to how it would help THEIR business, and make the one ask "book a short call" using the real link given. Never invent a service, guarantee, or link not present in that block.`
          : ""
      }`,
      userContent: `Real context about this contact:\n\n${context}${params.extraContext ? `\n\n---\n\nReal context about us (the sender):\n\n${params.extraContext}` : ""}\n\nWrite the ${params.channel === "LINKEDIN" ? "LinkedIn message" : params.channel === "WHATSAPP" ? "WhatsApp message" : "email"} now.`,
      maxTokens: 1500,
      effort: "low",
      schema: DraftResponseSchema,
    });

    if (outreachAgent) {
      await prisma.aIAgentInstance.update({ where: { id: outreachAgent.id }, data: { status: "COMPLETED" } });
    }

    const parsed = result.parsed;
    const draft = await prisma.emailDraft.create({
      data: {
        organizationId: contact.organizationId,
        campaignId: params.campaignId ?? null,
        contactId: contact.id,
        sequenceId: params.sequenceId ?? null,
        sequenceStepIndex: params.sequenceStepIndex ?? null,
        channel: params.channel,
        purpose: params.purpose,
        tone: params.tone,
        subject: params.channel === "EMAIL" ? parsed.subject || null : null,
        body: parsed.body,
        personalizationNotes: parsed.personalizationNotes,
        status: "DRAFT",
        generatedByAgentId: outreachAgent?.id,
        trackingToken: params.channel === "EMAIL" ? crypto.randomUUID() : null,
        abVariant: params.abVariant ?? null,
        abTestGroupId: params.abTestGroupId ?? null,
      },
    });

    return draft;
  } catch (error) {
    if (outreachAgent) {
      await prisma.aIAgentInstance.update({ where: { id: outreachAgent.id }, data: { status: "IDLE" } }).catch(() => {});
    }
    throw error;
  }
}
