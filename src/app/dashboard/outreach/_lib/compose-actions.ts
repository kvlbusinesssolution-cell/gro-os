"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

// A "use server" file may only export async functions — Next.js strips/
// rejects any other export at build time (see
// src/app/dashboard/opportunities/_lib/opportunity-outreach-constants.ts for
// the real production incident this caused in a sibling file). So no shared
// `ComposeEmailResult` interface is exported here; the return type is
// inlined on both functions below instead.

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

/**
 * Headless core of composeEmail — no session, everything past the auth/
 * membership check (mirrors this repo's Core/wrapper convention, e.g.
 * convertOpportunityToOutreachCore).
 *
 * The created draft always lands at `status: "DRAFT"` — it goes through the
 * exact same existing Request Approval -> Approve -> Queue -> Send pipeline
 * (approval-actions.ts) as every AI-generated draft. This is deliberate: a
 * human composing fresh outbound content is exactly the case the approval
 * gate exists for, same as AI-generated content — never auto-approved or
 * auto-sent, and no new send logic is introduced.
 */
export async function composeEmailCore(
  organizationId: string,
  authorUserId: string,
  contactId: string,
  subject: string,
  body: string,
): Promise<{ ok: boolean; error?: string; draftId?: string }> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== organizationId) return { ok: false, error: "Contact not found." };

  const trimmedSubject = subject.trim();
  const trimmedBody = body.trim();
  if (!trimmedSubject) return { ok: false, error: "Subject is required." };
  if (!trimmedBody) return { ok: false, error: "Body is required." };

  const draft = await prisma.emailDraft.create({
    data: {
      organizationId,
      contactId,
      channel: "EMAIL",
      purpose: "INTRODUCTION",
      tone: "PROFESSIONAL",
      subject: trimmedSubject,
      body: trimmedBody,
      status: "DRAFT",
    },
  });

  await logAudit({
    userId: authorUserId,
    organizationId,
    action: "outreach.draft_composed_manually",
    metadata: { contactId, draftId: draft.id },
  });

  revalidatePath("/dashboard/outreach/inbox");
  revalidatePath(`/dashboard/outreach/contacts/${contactId}`);

  return { ok: true, draftId: draft.id };
}

/** Session-gated Server Action wrapper — the real "Compose" affordance in the Inbox UI. */
export async function composeEmail(
  contactId: string,
  subject: string,
  body: string,
): Promise<{ ok: boolean; error?: string; draftId?: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  return composeEmailCore(membership.organizationId, userId, contactId, subject, body);
}
