"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { notifyUser } from "@/lib/notifications";
import { AINotConnectedError, AIBillingError, isAIBillingError } from "@/lib/ai/client";
import { generateEmailDraft } from "@/lib/outreach/draft-generator";
import { suggestFollowUp, type FollowUpSuggestion } from "@/lib/outreach/follow-up-engine";
import type { DraftChannel, DraftPurpose, EmailTone, EmailDraft } from "@/generated/prisma/client";

export interface ActionResult {
  ok: boolean;
  error?: string;
  errorKind?: "not_connected" | "billing" | "generic";
}

function describeAIError(error: unknown): ActionResult {
  if (error instanceof AINotConnectedError) {
    return { ok: false, errorKind: "not_connected", error: "AI is not connected — no ANTHROPIC_API_KEY is configured for this environment." };
  }
  if (error instanceof AIBillingError || isAIBillingError(error)) {
    return { ok: false, errorKind: "billing", error: "AI is connected but the account has no API credits — add credits at console.anthropic.com/settings/billing." };
  }
  console.error("[outreach] AI call failed:", error);
  return { ok: false, errorKind: "generic", error: "Something went wrong. Please try again." };
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

export interface GenerateDraftResult extends ActionResult {
  draft?: EmailDraft;
}

export async function generateDraftForContact(
  contactId: string,
  purpose: DraftPurpose,
  tone: EmailTone,
  channel: DraftChannel,
  campaignId?: string,
): Promise<GenerateDraftResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== membership.organizationId) return { ok: false, error: "Contact not found." };

  try {
    const draft = await generateEmailDraft({ contactId, purpose, tone, channel, campaignId });
    await logAudit({ userId, organizationId: membership.organizationId, action: "outreach.draft_generated", metadata: { contactId, draftId: draft.id } });
    await notifyUser({
      userId,
      organizationId: membership.organizationId,
      type: "EMAIL_READY",
      title: "Draft ready for review",
      message: `${draft.channel === "LINKEDIN" ? "A LinkedIn message" : draft.channel === "WHATSAPP" ? "A WhatsApp message" : (draft.subject ?? "An email")} for ${contact.firstName} is ready.`,
    });
    revalidatePath(`/dashboard/outreach/contacts/${contactId}`);
    return { ok: true, draft };
  } catch (error) {
    return describeAIError(error);
  }
}

export interface FollowUpResult extends ActionResult {
  suggestion?: FollowUpSuggestion;
}

export async function getFollowUpSuggestion(contactId: string): Promise<FollowUpResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== membership.organizationId) return { ok: false, error: "Contact not found." };

  try {
    const suggestion = await suggestFollowUp(contactId);
    return { ok: true, suggestion };
  } catch (error) {
    return describeAIError(error);
  }
}
