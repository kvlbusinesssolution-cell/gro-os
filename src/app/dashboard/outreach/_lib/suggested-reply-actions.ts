"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { createDraftFromSuggestedReply } from "@/lib/outreach/suggested-reply-draft";

export interface ActionResult {
  ok: boolean;
  error?: string;
  draftId?: string;
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

/**
 * Session-gated wrapper around createDraftFromSuggestedReply
 * (src/lib/outreach/suggested-reply-draft.ts) — same Core/wrapper split as
 * logReplyCore/logReply (reply-actions.ts) and
 * addOpportunityToCrmCore/addOpportunityToCrm (opportunity-actions.ts). The
 * real "Draft a reply from this suggestion" button on the contact detail
 * page (contacts/[id]/page.tsx, replies tab) calls this, never the core
 * function directly.
 */
export async function createDraftFromSuggestedReplyAction(replyId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const reply = await prisma.reply.findUnique({ where: { id: replyId } });
  if (!reply || reply.organizationId !== membership.organizationId) return { ok: false, error: "Reply not found." };

  const result = await createDraftFromSuggestedReply(replyId);

  if (result.ok) {
    await logAudit({
      userId,
      organizationId: membership.organizationId,
      action: "outreach.suggested_reply_drafted",
      metadata: { replyId, draftId: result.draftId, contactId: reply.contactId },
    });
    revalidatePath(`/dashboard/outreach/contacts/${reply.contactId}`);
  }

  return result;
}
