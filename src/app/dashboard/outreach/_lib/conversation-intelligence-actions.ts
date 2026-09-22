"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  analyzeConversation,
  generateSuggestedReply,
  overrideConversationIntelligence,
  searchConversationThreads,
  getConversationAnalytics,
  type AnalyzeConversationResult,
  type SuggestedReplyResult,
  type ThreadSearchResult,
  type ConversationAnalytics,
} from "@/lib/business-development/conversation-intelligence";
import type { ConversationIntelligence } from "@/generated/prisma/client";

/**
 * Phase 6 (AI Conversation Intelligence) — API surface. Same
 * session/tenant-isolation pattern as every other _lib actions file this
 * session (reused, not reinvented): auth() + a resolveMembershipForContact
 * check enforces organization_id + contact_id at the service layer.
 */

export interface CIActionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function resolveMembershipForContact(userId: string, contactId: string) {
  const membership = await prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!membership) return null;
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== membership.organizationId) return null;
  return { membership, contact };
}

async function requireContactAccess(contactId: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false as const, error: "You must be signed in." };
  const resolved = await resolveMembershipForContact(userId, contactId);
  if (!resolved) return { ok: false as const, error: "Contact not found." };
  return { ok: true as const, userId, organizationId: resolved.membership.organizationId };
}

/** GET the latest real ConversationIntelligence row for this thread (tenant-isolated). */
export async function getConversationIntelligenceAction(contactId: string): Promise<CIActionResult<ConversationIntelligence | null>> {
  const access = await requireContactAccess(contactId);
  if (!access.ok) return { ok: false, error: access.error };
  const data = await prisma.conversationIntelligence.findFirst({ where: { organizationId: access.organizationId, contactId }, orderBy: { generatedAt: "desc" } });
  return { ok: true, data };
}

/** Trigger (or reuse cached, per §31 change-detection) a real analysis of this thread. */
export async function analyzeConversationAction(contactId: string): Promise<CIActionResult<AnalyzeConversationResult>> {
  const access = await requireContactAccess(contactId);
  if (!access.ok) return { ok: false, error: access.error };

  if (!checkRateLimit(`conversation-intel:${access.userId}`, { limit: 20, windowMs: 5 * 60_000 }).allowed) {
    return { ok: false, error: "Too many analysis requests — wait a few minutes and try again." };
  }

  const data = await analyzeConversation(access.organizationId, contactId);
  revalidatePath(`/dashboard/outreach/inbox/${contactId}`);
  return { ok: true, data };
}

/** Generate a real AI-suggested reply as a normal DRAFT EmailDraft — never sent automatically. */
export async function generateSuggestedReplyAction(contactId: string): Promise<CIActionResult<SuggestedReplyResult>> {
  const access = await requireContactAccess(contactId);
  if (!access.ok) return { ok: false, error: access.error };

  if (!checkRateLimit(`suggested-reply:${access.userId}`, { limit: 15, windowMs: 5 * 60_000 }).allowed) {
    return { ok: false, error: "Too many suggested-reply requests — wait a few minutes and try again." };
  }

  const data = await generateSuggestedReply(access.organizationId, contactId);
  if (data.ok) {
    await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "conversation_intelligence.suggested_reply_generated", metadata: { contactId, draftId: data.draftId } });
    revalidatePath(`/dashboard/outreach/inbox/${contactId}`);
  }
  return { ok: true, data };
}

/** Human override (§38) — preserves the AI original, creates a new row with the correction. */
export async function overrideConversationIntelligenceAction(
  contactId: string,
  field: "detectedBuyingStage" | "intent" | "sentiment" | "urgency",
  newValue: string,
  reason: string,
): Promise<CIActionResult<ConversationIntelligence>> {
  const access = await requireContactAccess(contactId);
  if (!access.ok) return { ok: false, error: access.error };
  if (!reason.trim()) return { ok: false, error: "A reason is required for an override." };

  const data = await overrideConversationIntelligence(access.organizationId, contactId, field, newValue, access.userId, reason.trim());
  if (!data) return { ok: false, error: "No existing analysis to override yet — run an analysis first." };

  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "conversation_intelligence.overridden", metadata: { contactId, field, newValue, reason } });
  revalidatePath(`/dashboard/outreach/inbox/${contactId}`);
  return { ok: true, data };
}

async function requireOrgAccess() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false as const, error: "You must be signed in." };
  const membership = await prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!membership) return { ok: false as const, error: "You don't belong to an organization yet." };
  return { ok: true as const, userId, organizationId: membership.organizationId };
}

/** Real keyword search across this organization's real conversation threads. */
export async function searchConversationThreadsAction(query: string): Promise<CIActionResult<ThreadSearchResult[]>> {
  const access = await requireOrgAccess();
  if (!access.ok) return { ok: false, error: access.error };
  const data = await searchConversationThreads(access.organizationId, query);
  return { ok: true, data };
}

/** Real aggregation of intent/sentiment/urgency across this organization's analyzed threads. */
export async function getConversationAnalyticsAction(): Promise<CIActionResult<ConversationAnalytics>> {
  const access = await requireOrgAccess();
  if (!access.ok) return { ok: false, error: access.error };
  const data = await getConversationAnalytics(access.organizationId);
  return { ok: true, data };
}
