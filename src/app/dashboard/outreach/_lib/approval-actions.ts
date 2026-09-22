"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { notifyOrganizationOwners, notifyUser } from "@/lib/notifications";
import { sendOutreachEmail } from "@/lib/outreach/email-provider";
import { injectTracking, getAppBaseUrl } from "@/lib/outreach/tracking";
import { sendWhatsAppMessage } from "@/lib/outreach/whatsapp-provider";
import { getOrCreateWhatsAppConversation, markConversationOutbound } from "@/lib/outreach/whatsapp-conversation";
import type { ApprovalDecision } from "@/generated/prisma/client";

export interface ActionResult {
  ok: boolean;
  error?: string;
  errorKind?: "not_configured" | "generic";
}

const APPROVER_ROLES = new Set(["OWNER", "ADMIN"]);

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

async function resolveDraftInOrg(userId: string, draftId: string) {
  const membership = await resolveActiveMembership(userId);
  if (!membership) return null;
  const draft = await prisma.emailDraft.findUnique({ where: { id: draftId }, include: { contact: true } });
  if (!draft || draft.organizationId !== membership.organizationId) return null;
  return { membership, draft };
}

/** Moves a draft into review — creates an Approval row and notifies OWNER/ADMIN. */
export async function requestApproval(draftId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveDraftInOrg(userId, draftId);
  if (!resolved) return { ok: false, error: "Draft not found." };

  await prisma.$transaction([
    prisma.emailDraft.update({ where: { id: draftId }, data: { status: "PENDING_APPROVAL" } }),
    prisma.approval.create({ data: { organizationId: resolved.membership.organizationId, emailDraftId: draftId, decision: "PENDING" } }),
  ]);

  await notifyOrganizationOwners({
    organizationId: resolved.membership.organizationId,
    type: "APPROVAL_REQUESTED",
    title: "A draft is waiting for approval",
    message: `${resolved.draft.subject ?? resolved.draft.body.slice(0, 60)} — for ${resolved.draft.contact.firstName}`,
  });

  revalidatePath("/dashboard/outreach");
  return { ok: true };
}

/** OWNER/ADMIN only — decides a pending draft. CHANGES_REQUESTED kicks it back to DRAFT for editing. */
export async function decideApproval(approvalId: string, decision: ApprovalDecision, comment?: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  if (!APPROVER_ROLES.has(membership.role)) return { ok: false, error: "Only owners and admins can approve drafts." };

  const approval = await prisma.approval.findUnique({ where: { id: approvalId }, include: { emailDraft: true } });
  if (!approval || approval.organizationId !== membership.organizationId) return { ok: false, error: "Approval request not found." };

  await prisma.approval.update({
    where: { id: approvalId },
    data: { decision, comment: comment || null, decidedByUserId: userId, decidedAt: new Date() },
  });

  const nextDraftStatus = decision === "APPROVED" ? "APPROVED" : decision === "REJECTED" ? "REJECTED" : "DRAFT";
  await prisma.emailDraft.update({ where: { id: approval.emailDraftId }, data: { status: nextDraftStatus } });

  await logAudit({ userId, organizationId: membership.organizationId, action: "outreach.approval_decided", metadata: { approvalId, decision } });
  revalidatePath("/dashboard/outreach");
  return { ok: true };
}

/** APPROVED -> QUEUED. Automatic-mode campaigns can queue without a human decision, but never skip the real send-configured check. */
export async function queueDraft(draftId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveDraftInOrg(userId, draftId);
  if (!resolved) return { ok: false, error: "Draft not found." };
  if (resolved.draft.status !== "APPROVED") return { ok: false, error: "Only an approved draft can be queued." };

  await prisma.emailDraft.update({ where: { id: draftId }, data: { status: "QUEUED", queuedAt: new Date() } });
  revalidatePath("/dashboard/outreach");
  return { ok: true };
}

/**
 * Headless core of sendQueuedDraft — no session, everything past the org
 * scope check (mirrors this repo's Core/wrapper convention, e.g.
 * composeEmailCore in compose-actions.ts). Called by the session-gated
 * wrapper below AND by the scheduled-send job (runScheduledEmailSend in
 * src/lib/business-development/scheduled-send-job.ts), which promotes a due
 * APPROVED-with-scheduledFor draft to QUEUED and then calls this exact
 * function — the scheduled-send job never duplicates the real send logic.
 *
 * `actingUserId` is null when called from the job (no human triggered this
 * particular send): in that case the "email sent" notification goes to the
 * org's OWNER/ADMIN roster via notifyOrganizationOwners instead of a
 * specific user, the same fallback-to-owner pattern
 * dailyDeliveryBoardMeetingJob/linkedInReminderJob use in registry.ts.
 *
 * Re-checks the contact isn't UNSUBSCRIBED at send time — defense in depth
 * against a contact unsubscribing between when a draft was queued (or
 * scheduled) and this function actually running. Never silently sends
 * anyway; fails the draft with a clear reason instead.
 */
export async function sendQueuedDraftCore(organizationId: string, draftId: string, actingUserId: string | null): Promise<ActionResult> {
  const draft = await prisma.emailDraft.findUnique({ where: { id: draftId }, include: { contact: true } });
  if (!draft || draft.organizationId !== organizationId) return { ok: false, error: "Draft not found." };
  if (draft.channel === "LINKEDIN") return { ok: false, error: "Only email/WhatsApp drafts can be sent this way — LinkedIn drafts are marked sent manually." };
  if (draft.status !== "QUEUED") return { ok: false, error: "Only a queued draft can be sent." };

  if (draft.contact.status === "UNSUBSCRIBED") {
    const failedReason = "Contact has unsubscribed since this draft was queued — send blocked.";
    await prisma.emailDraft.update({ where: { id: draftId }, data: { status: "FAILED", failedReason } });
    revalidatePath("/dashboard/outreach");
    return { ok: false, error: failedReason };
  }

  if (draft.channel === "WHATSAPP") {
    return sendQueuedWhatsAppDraftCore(organizationId, draft, actingUserId);
  }

  const baseUrl = getAppBaseUrl();
  const rawHtml = `<p>${draft.body.replace(/\n/g, "<br/>")}</p>`;
  const html = draft.trackingToken ? injectTracking(rawHtml, draft.trackingToken, baseUrl) : rawHtml;

  const result = await sendOutreachEmail(organizationId, {
    to: draft.contact.email,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject ?? "",
    html,
    text: draft.body,
  });

  if (!result.ok) {
    await prisma.emailDraft.update({ where: { id: draftId }, data: { status: "FAILED", failedReason: result.error } });
    revalidatePath("/dashboard/outreach");
    return { ok: false, errorKind: result.errorKind === "not_configured" ? "not_configured" : "generic", error: result.error };
  }

  await prisma.emailDraft.update({
    where: { id: draftId },
    data: { status: "SENT", sentAt: new Date(), resendMessageId: result.providerMessageId ?? undefined },
  });

  if (actingUserId) {
    await notifyUser({
      userId: actingUserId,
      organizationId,
      type: "CRM_EVENT",
      title: "Email sent",
      message: `Sent "${draft.subject ?? "email"}" to ${draft.contact.firstName}.`,
    });
  } else {
    await notifyOrganizationOwners({
      organizationId,
      type: "CRM_EVENT",
      title: "Scheduled email sent",
      message: `Sent "${draft.subject ?? "email"}" to ${draft.contact.firstName} at its scheduled time.`,
    });
  }

  revalidatePath("/dashboard/outreach");
  return { ok: true };
}

/**
 * Phase 8 (WhatsApp Business Outreach) — the WHATSAPP-channel counterpart
 * to the EMAIL block above, called from sendQueuedDraftCore so both
 * channels share the exact same approval/queue entry point (§19: AI must
 * never silently send — a WhatsApp draft only ever gets here after a real
 * human APPROVE + QUEUE, or the scheduled-send job's own re-check).
 */
async function sendQueuedWhatsAppDraftCore(
  organizationId: string,
  draft: NonNullable<Awaited<ReturnType<typeof prisma.emailDraft.findUnique>>> & { contact: { firstName: string; phone: string | null } },
  actingUserId: string | null,
): Promise<ActionResult> {
  if (!draft.contact.phone) {
    const failedReason = "Contact has no phone number — cannot send WhatsApp message.";
    await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "FAILED", failedReason } });
    revalidatePath("/dashboard/outreach");
    return { ok: false, error: failedReason };
  }

  const baseUrl = getAppBaseUrl();
  const result = await sendWhatsAppMessage({
    organizationId,
    to: draft.contact.phone,
    body: draft.body,
    templateContentSid: draft.whatsappTemplateId ?? undefined,
    statusCallbackUrl: `${baseUrl}/api/webhooks/twilio-whatsapp/${organizationId}`,
  });

  if (!result.ok) {
    await prisma.emailDraft.update({ where: { id: draft.id }, data: { status: "FAILED", failedReason: result.error } });
    revalidatePath("/dashboard/outreach");
    return { ok: false, errorKind: result.errorKind === "not_configured" ? "not_configured" : "generic", error: result.error };
  }

  const conversation = await getOrCreateWhatsAppConversation(organizationId, draft.contactId);
  await prisma.emailDraft.update({
    where: { id: draft.id },
    data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId, whatsappConversationId: conversation.id },
  });
  await markConversationOutbound(conversation.id);

  if (actingUserId) {
    await notifyUser({ userId: actingUserId, organizationId, type: "CRM_EVENT", title: "WhatsApp message sent", message: `Sent a WhatsApp message to ${draft.contact.firstName}.` });
  } else {
    await notifyOrganizationOwners({ organizationId, type: "CRM_EVENT", title: "Scheduled WhatsApp message sent", message: `Sent a WhatsApp message to ${draft.contact.firstName} at its scheduled time.` });
  }

  await logAudit({ userId: actingUserId, organizationId, action: "whatsapp.message_sent", metadata: { draftId: draft.id, contactId: draft.contactId, providerMessageId: result.providerMessageId } });

  revalidatePath("/dashboard/outreach");
  return { ok: true };
}

/** QUEUED -> SENT|FAILED. Only ever marks SENT after a real send genuinely succeeds — LinkedIn drafts use markLinkedInDraftSent instead (no automation). */
export async function sendQueuedDraft(draftId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveDraftInOrg(userId, draftId);
  if (!resolved) return { ok: false, error: "Draft not found." };

  return sendQueuedDraftCore(resolved.membership.organizationId, draftId, userId);
}

/** LinkedIn drafts are never sent by this app — the user pastes the text into LinkedIn themselves, then confirms here. Zero automation. */
export async function markLinkedInDraftSent(draftId: string): Promise<ActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const resolved = await resolveDraftInOrg(userId, draftId);
  if (!resolved) return { ok: false, error: "Draft not found." };
  if (resolved.draft.channel !== "LINKEDIN") return { ok: false, error: "This action is only for LinkedIn drafts." };
  if (resolved.draft.status !== "QUEUED" && resolved.draft.status !== "APPROVED") {
    return { ok: false, error: "Approve or queue this draft first." };
  }

  await prisma.emailDraft.update({ where: { id: draftId }, data: { status: "SENT", sentAt: new Date() } });
  revalidatePath("/dashboard/outreach");
  return { ok: true };
}
