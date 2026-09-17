import { prisma } from "@/lib/prisma";
import type { EmailDraft, Reply } from "@/generated/prisma/client";

/**
 * Data layer for the Email Inbox feature — a merged, contact-centric view on
 * top of the existing EmailDraft (outbound) / Reply (inbound) models. This
 * file is read-only: it never creates/updates rows. Every function takes
 * `organizationId` as an explicit first argument (never session-derived) so
 * it can be called from both Server Components and tests without going
 * through auth().
 */

export interface InboxThread {
  contact: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string;
    company: { name: string } | null;
  };
  lastMessage: {
    kind: "SENT" | "REPLY";
    /** First ~120 chars of the underlying draft body / reply content. */
    preview: string;
    at: Date;
  };
  /** True only when the contact spoke last (a Reply) and nobody has sent a later EmailDraft since. */
  unread: boolean;
}

export type TimelineEvent = { type: "DRAFT"; draft: EmailDraft } | { type: "REPLY"; reply: Reply };

function toPreview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
}

/**
 * One row per Contact with >= 1 EmailDraft (any status) or Reply, sorted by
 * most recent event (SENT draft or Reply) descending.
 */
export async function getInboxThreads(organizationId: string): Promise<InboxThread[]> {
  const contacts = await prisma.contact.findMany({
    where: {
      organizationId,
      OR: [{ emailDrafts: { some: {} } }, { replies: { some: {} } }],
    },
    include: {
      company: { select: { name: true } },
      emailDrafts: { where: { status: "SENT" }, orderBy: { sentAt: "desc" }, take: 1 },
      replies: { orderBy: { receivedAt: "desc" }, take: 1 },
    },
  });

  const threads: InboxThread[] = [];

  for (const contact of contacts) {
    const latestSent = contact.emailDrafts[0];
    const latestReply = contact.replies[0];

    let lastMessage: InboxThread["lastMessage"] | null = null;

    if (latestSent && latestReply) {
      lastMessage =
        latestSent.sentAt! >= latestReply.receivedAt
          ? { kind: "SENT", preview: toPreview(latestSent.body), at: latestSent.sentAt! }
          : { kind: "REPLY", preview: toPreview(latestReply.content), at: latestReply.receivedAt };
    } else if (latestSent) {
      lastMessage = { kind: "SENT", preview: toPreview(latestSent.body), at: latestSent.sentAt! };
    } else if (latestReply) {
      lastMessage = { kind: "REPLY", preview: toPreview(latestReply.content), at: latestReply.receivedAt };
    } else {
      // Edge case not covered by the spec's "most recent SENT draft / most
      // recent Reply" pair: a contact whose only drafts have never been
      // SENT (still DRAFT/PENDING_APPROVAL/APPROVED/QUEUED/FAILED). It still
      // passed the `some: {}` filter above, so it needs *a* lastMessage —
      // fall back to that contact's single most recent draft regardless of
      // status rather than silently dropping the thread.
      const fallbackDraft = await prisma.emailDraft.findFirst({
        where: { contactId: contact.id },
        orderBy: { createdAt: "desc" },
      });
      if (fallbackDraft) {
        lastMessage = {
          kind: "SENT",
          preview: toPreview(fallbackDraft.body),
          at: fallbackDraft.sentAt ?? fallbackDraft.createdAt,
        };
      }
    }

    if (!lastMessage) continue; // Unreachable given the where clause above, kept for type-safety.

    const unread = Boolean(latestReply) && (!latestSent || latestReply!.receivedAt > latestSent.sentAt!);

    threads.push({
      contact: {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        company: contact.company ? { name: contact.company.name } : null,
      },
      lastMessage,
      unread,
    });
  }

  threads.sort((a, b) => b.lastMessage.at.getTime() - a.lastMessage.at.getTime());
  return threads;
}

/**
 * The real gap this feature fills: a single chronological merge of one
 * contact's EmailDrafts (ALL statuses) and Replies, ascending by effective
 * timestamp (draft: sentAt ?? createdAt; reply: receivedAt).
 *
 * Org-ownership: returns `[]` for a contact that doesn't exist or belongs to
 * a different organization (rather than throwing) — callers get an
 * empty-timeline UI state instead of a hard error, and cross-org data is
 * never returned.
 */
export async function getContactTimeline(organizationId: string, contactId: string): Promise<TimelineEvent[]> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== organizationId) return [];

  const [drafts, replies] = await Promise.all([
    prisma.emailDraft.findMany({
      where: { contactId },
      include: { approvals: { orderBy: { createdAt: "desc" } } },
    }),
    prisma.reply.findMany({ where: { contactId } }),
  ]);

  const dated: Array<{ at: Date; event: TimelineEvent }> = [
    ...drafts.map((draft) => ({ at: draft.sentAt ?? draft.createdAt, event: { type: "DRAFT" as const, draft } })),
    ...replies.map((reply) => ({ at: reply.receivedAt, event: { type: "REPLY" as const, reply } })),
  ];

  dated.sort((a, b) => a.at.getTime() - b.at.getTime());
  return dated.map((d) => d.event);
}

export async function getSentEmails(organizationId: string, opts?: { take?: number }) {
  return prisma.emailDraft.findMany({
    where: { organizationId, status: "SENT" },
    orderBy: { sentAt: "desc" },
    include: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } },
    take: opts?.take,
  });
}

// This exact status list ("pending" = not yet sent, not failed/rejected/bounced)
// mirrors getOutreachDashboardStats's own `pending` count in
// src/lib/outreach/campaign-analytics.ts verbatim — that function is this
// codebase's canonical definition of "pending", so it's reused rather than
// re-derived here.
export async function getDraftEmails(organizationId: string) {
  return prisma.emailDraft.findMany({
    where: { organizationId, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "QUEUED"] } },
    orderBy: { createdAt: "desc" },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      approvals: { orderBy: { createdAt: "desc" } },
    },
  });
}
