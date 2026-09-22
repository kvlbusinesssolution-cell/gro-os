import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export interface MergeContactsResult {
  ok: boolean;
  error?: string;
  reassignedCounts?: Record<string, number>;
}

/**
 * Phase 25 (contact merge safety) — mirrors company-merge.ts's exact
 * soft-merge pattern (Phase 24). The merge-away Contact row is never
 * deleted, only flagged (`mergedIntoId`/`mergedAt`) and excluded from
 * findOrCreateContact matching going forward — full history stays
 * reachable via the `mergedInto` relation, never silently lost.
 *
 * Every real foreign-key relation pointing at Contact in this schema
 * (extracted directly from prisma/schema.prisma — CampaignContact,
 * EmailDraft, Reply, OutreachMeeting, Task, Deal, Reminder [relatedContactId],
 * Quotation, RateNegotiation, ConversationIntelligence, RevenueAttribution,
 * WhatsAppConversation, Call, LearningObservation [loose reference, no
 * formal Prisma relation — see its own schema comment], and VoiceConsent
 * [a real 1:1 @unique relation]) is reassigned from the merge-away contact
 * to the keeper inside a single real Prisma transaction.
 *
 * VoiceConsent.contactId is @unique — a naive bulk reassignment would
 * violate that constraint if BOTH contacts already have their own row;
 * handled specially below (drop the merge-away duplicate, never silently
 * duplicate). Every other relation is a plain non-unique child record.
 */
export async function mergeContacts(
  organizationId: string,
  keepId: string,
  mergeAwayId: string,
  actorUserId: string | null,
): Promise<MergeContactsResult> {
  if (keepId === mergeAwayId) {
    return { ok: false, error: "Cannot merge a contact into itself." };
  }

  const [keep, mergeAway] = await Promise.all([
    prisma.contact.findUnique({ where: { id: keepId } }),
    prisma.contact.findUnique({ where: { id: mergeAwayId } }),
  ]);

  if (!keep || keep.organizationId !== organizationId) {
    return { ok: false, error: "The contact to keep was not found in your organization." };
  }
  if (!mergeAway || mergeAway.organizationId !== organizationId) {
    return { ok: false, error: "The contact to merge away was not found in your organization." };
  }
  if (keep.mergedIntoId) {
    return { ok: false, error: "The contact to keep has itself already been merged into another contact." };
  }
  if (mergeAway.mergedIntoId) {
    return { ok: false, error: "That contact has already been merged into another contact." };
  }

  const reassignedCounts: Record<string, number> = {};

  await prisma.$transaction(async (tx) => {
    // ---- VoiceConsent: contactId @unique — drop the merge-away row if the
    // keeper already has one, otherwise reassign it.
    const keeperHasVoiceConsent = await tx.voiceConsent.findUnique({ where: { contactId: keepId } });
    if (keeperHasVoiceConsent) {
      const deleted = await tx.voiceConsent.deleteMany({ where: { contactId: mergeAwayId } });
      reassignedCounts.voiceConsent_dropped_duplicate = deleted.count;
    } else {
      const updated = await tx.voiceConsent.updateMany({ where: { contactId: mergeAwayId }, data: { contactId: keepId } });
      reassignedCounts.voiceConsent = updated.count;
    }

    // ---- Every other real relation pointing at Contact (plain, non-unique
    // child records) — straightforward bulk reassignment.
    const plainContactIdModels = [
      "campaignContact",
      "emailDraft",
      "reply",
      "outreachMeeting",
      "task",
      "deal",
      "quotation",
      "rateNegotiation",
      "conversationIntelligence",
      "revenueAttribution",
      "whatsAppConversation",
      "call",
      "contactEvidence",
      "learningObservation",
    ] as const;

    for (const model of plainContactIdModels) {
      const updated = await (tx[model] as { updateMany: (args: unknown) => Promise<{ count: number }> }).updateMany({
        where: { contactId: mergeAwayId },
        data: { contactId: keepId },
      });
      reassignedCounts[model] = updated.count;
    }

    // ---- Reminder uses a differently-named FK column (relatedContactId).
    const updatedReminder = await tx.reminder.updateMany({
      where: { relatedContactId: mergeAwayId },
      data: { relatedContactId: keepId },
    });
    reassignedCounts.reminder = updatedReminder.count;

    // ---- Flag the merge-away row — never deleted, real soft-merge.
    await tx.contact.update({
      where: { id: mergeAwayId },
      data: { mergedIntoId: keepId, mergedAt: new Date() },
    });
  });

  await logAudit({
    userId: actorUserId,
    organizationId,
    action: "contact.merged",
    metadata: { keepId, mergeAwayId, reassignedCounts },
  });

  return { ok: true, reassignedCounts };
}
