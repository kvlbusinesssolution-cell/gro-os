import { prisma } from "@/lib/prisma";
import type { WhatsAppConversation } from "@/generated/prisma/client";

/**
 * Phase 8 (WhatsApp Business Outreach) §9 — one real WhatsApp conversation
 * per (organizationId, contactId). Get-or-create only; a conversation is
 * never fabricated — it's created the first time a real outbound message
 * is queued or a real inbound message arrives for this contact.
 */
export async function getOrCreateWhatsAppConversation(organizationId: string, contactId: string): Promise<WhatsAppConversation> {
  const existing = await prisma.whatsAppConversation.findUnique({ where: { organizationId_contactId: { organizationId, contactId } } });
  if (existing) return existing;

  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
  if (!contact.phone) throw new Error("Cannot start a WhatsApp conversation — contact has no phone number.");

  return prisma.whatsAppConversation.create({
    data: { organizationId, contactId, companyId: contact.companyId, phoneNumber: contact.phone },
  });
}

/** Called after a real outbound send succeeds. */
export async function markConversationOutbound(conversationId: string): Promise<void> {
  const now = new Date();
  await prisma.whatsAppConversation.update({ where: { id: conversationId }, data: { lastMessageAt: now, lastOutboundAt: now, status: "OPEN" } });
}

/** Called after a real inbound message is recorded. */
export async function markConversationInbound(conversationId: string): Promise<void> {
  const now = new Date();
  await prisma.whatsAppConversation.update({ where: { id: conversationId }, data: { lastMessageAt: now, lastInboundAt: now, status: "OPEN" } });
}

/** §26 — associates a conversation with a real, already-existing opportunity. Never creates one. */
export async function linkConversationToOpportunity(conversationId: string, opportunityId: string): Promise<void> {
  await prisma.whatsAppConversation.update({ where: { id: conversationId }, data: { opportunityId } });
}
