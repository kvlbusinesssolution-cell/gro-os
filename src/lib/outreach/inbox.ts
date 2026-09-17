import { prisma } from "@/lib/prisma";
import type { EmailDraft, Reply, ReplyIntent, ReplySentiment } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";

/**
 * Data layer for the Email Inbox feature — a merged, contact-centric view on
 * top of the existing EmailDraft (outbound) / Reply (inbound) models. This
 * file is read-only: it never creates/updates rows (the sole exception is
 * `markReplyAsRead`, a single explicit read-state mutation). Every function
 * takes `organizationId` as an explicit first argument (never
 * session-derived) so it can be called from both Server Components and tests
 * without going through auth().
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
  /** True if the contact's latest Reply row has `readAt: null` — the real, sticky read-state. */
  unreadPersisted: boolean;
  /** Intent/sentiment from the contact's latest real Reply row (AI Reply Intelligence), null if none. */
  intent: ReplyIntent | null;
  sentiment: ReplySentiment | null;
}

/** Minimal, real attachment shape for the Inbox thread view — filename/size/type only, never the file bytes. */
export interface TimelineDraftAttachment {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
}

export type TimelineEvent =
  | { type: "DRAFT"; draft: EmailDraft & { attachments: TimelineDraftAttachment[] } }
  | { type: "REPLY"; reply: Reply };

/** Shared pagination shape for every list function in this module. */
export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface PaginationOpts {
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 25;

function resolvePagination(opts?: PaginationOpts) {
  const page = Math.max(1, Math.floor(opts?.page ?? 1));
  const pageSize = Math.max(1, Math.floor(opts?.pageSize ?? DEFAULT_PAGE_SIZE));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** The contact shape reused across every EmailDraft-list function below. */
const CONTACT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  company: { select: { name: true } },
} satisfies Prisma.ContactSelect;

function toPreview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
}

/**
 * Shared query behind both `getInboxThreads` (full, unpaginated — used by the
 * Inbox tab today) and `getThreadsView` (paginated). One row per Contact with
 * >= 1 EmailDraft (any status) or Reply, sorted by most recent event (SENT
 * draft or Reply) descending. The final sort/merge happens in JS (it depends
 * on comparing two different relations' timestamps, which Prisma can't
 * `orderBy` directly), so pagination on top of this is applied by slicing
 * the already-sorted array rather than re-querying — no duplicated query
 * logic between the two exported functions.
 */
async function fetchThreads(organizationId: string): Promise<InboxThread[]> {
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
    const unreadPersisted = latestReply ? latestReply.readAt === null : false;

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
      unreadPersisted,
      intent: latestReply?.intent ?? null,
      sentiment: latestReply?.sentiment ?? null,
    });
  }

  threads.sort((a, b) => b.lastMessage.at.getTime() - a.lastMessage.at.getTime());
  return threads;
}

/**
 * One row per Contact with >= 1 EmailDraft (any status) or Reply, sorted by
 * most recent event (SENT draft or Reply) descending. Unpaginated — existing
 * callers (the Inbox tab) keep working exactly as before.
 */
export async function getInboxThreads(organizationId: string): Promise<InboxThread[]> {
  return fetchThreads(organizationId);
}

/**
 * Paginated view over the same thread data as `getInboxThreads`, for the
 * dedicated "Threads" tab.
 */
export async function getThreadsView(
  organizationId: string,
  opts?: PaginationOpts,
): Promise<PaginatedResult<InboxThread>> {
  const { page, pageSize, skip, take } = resolvePagination(opts);
  const all = await fetchThreads(organizationId);
  const items = all.slice(skip, skip + take);
  return { items, totalCount: all.length, page, pageSize };
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
      include: {
        approvals: { orderBy: { createdAt: "desc" } },
        // Phase 3 Email Center — real attachments (Document rows linked via
        // linkedEmailDraftId), filename/size/type only so the timeline view
        // never has to load file bytes just to show a list.
        attachments: { select: { id: true, name: true, sizeBytes: true, mimeType: true } },
      },
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

/**
 * Drafts with a real future `scheduledFor` that are still `APPROVED` — i.e.
 * "Scheduled, not yet queued." Once the scheduled-send job promotes one to
 * QUEUED it drops out of this list (it belongs in Drafts/pending, not here).
 */
export async function getScheduledEmails(
  organizationId: string,
  opts?: PaginationOpts,
): Promise<PaginatedResult<Awaited<ReturnType<typeof queryScheduledEmails>>[number]>> {
  const { page, pageSize, skip, take } = resolvePagination(opts);
  const where: Prisma.EmailDraftWhereInput = {
    organizationId,
    status: "APPROVED",
    scheduledFor: { not: null },
  };
  const [items, totalCount] = await Promise.all([
    queryScheduledEmails(where, skip, take),
    prisma.emailDraft.count({ where }),
  ]);
  return { items, totalCount, page, pageSize };
}

function queryScheduledEmails(where: Prisma.EmailDraftWhereInput, skip: number, take: number) {
  return prisma.emailDraft.findMany({
    where,
    orderBy: { scheduledFor: "asc" },
    include: { contact: { select: CONTACT_SELECT } },
    skip,
    take,
  });
}

/**
 * Drafts that ended up FAILED, REJECTED, or BOUNCED — with `approvals`
 * included (orderBy createdAt desc) so a REJECTED draft's rejection
 * reason/comment is visible without a second query.
 */
export async function getFailedEmails(organizationId: string, opts?: PaginationOpts) {
  const { page, pageSize, skip, take } = resolvePagination(opts);
  const where: Prisma.EmailDraftWhereInput = {
    organizationId,
    status: { in: ["FAILED", "REJECTED", "BOUNCED"] },
  };
  const [items, totalCount] = await Promise.all([
    prisma.emailDraft.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        contact: { select: CONTACT_SELECT },
        approvals: { orderBy: { createdAt: "desc" } },
      },
      skip,
      take,
    }),
    prisma.emailDraft.count({ where }),
  ]);
  return { items, totalCount, page, pageSize };
}

/** Drafts an AI agent generated (`generatedByAgentId` not null). */
export async function getAiGeneratedEmails(organizationId: string, opts?: PaginationOpts) {
  const { page, pageSize, skip, take } = resolvePagination(opts);
  const where: Prisma.EmailDraftWhereInput = {
    organizationId,
    generatedByAgentId: { not: null },
  };
  const [items, totalCount] = await Promise.all([
    prisma.emailDraft.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { contact: { select: CONTACT_SELECT } },
      skip,
      take,
    }),
    prisma.emailDraft.count({ where }),
  ]);
  return { items, totalCount, page, pageSize };
}

/** Drafts attached to a Campaign, optionally scoped to one `campaignId`. */
export async function getCampaignEmails(
  organizationId: string,
  opts?: PaginationOpts & { campaignId?: string },
) {
  const { page, pageSize, skip, take } = resolvePagination(opts);
  const where: Prisma.EmailDraftWhereInput = {
    organizationId,
    campaignId: opts?.campaignId ? opts.campaignId : { not: null },
  };
  const [items, totalCount] = await Promise.all([
    prisma.emailDraft.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        contact: { select: CONTACT_SELECT },
        campaign: { select: { id: true, name: true } },
      },
      skip,
      take,
    }),
    prisma.emailDraft.count({ where }),
  ]);
  return { items, totalCount, page, pageSize };
}

export type EmailCenterSearchResult =
  | {
      type: "DRAFT";
      at: Date;
      draft: EmailDraft & {
        contact: { id: string; firstName: string; lastName: string | null; email: string; company: { name: string } | null };
      };
    }
  | {
      type: "REPLY";
      at: Date;
      reply: Reply & {
        contact: { id: string; firstName: string; lastName: string | null; email: string; company: { name: string } | null };
      };
    };

/**
 * Real substring search (case-insensitive) across EmailDraft.subject/body,
 * Reply.content, Contact.firstName/lastName/email, Company.name (joined
 * through the contact), LeadOpportunity.title/description (joined through
 * the contact's company), and Campaign.name — never a fabricated match.
 *
 * EmailDraft and Reply live in different tables, so this runs two separate
 * queries and merges the results client-side (tagged `type: "DRAFT" |
 * "REPLY"`), sorted by each result's effective timestamp descending, then
 * paginated over the merged, sorted list.
 */
export async function searchEmailCenter(
  organizationId: string,
  query: string,
  opts?: PaginationOpts,
): Promise<PaginatedResult<EmailCenterSearchResult>> {
  const { page, pageSize, skip, take } = resolvePagination(opts);
  const q = query.trim();

  if (!q) {
    return { items: [], totalCount: 0, page, pageSize };
  }

  const insensitiveContains = { contains: q, mode: "insensitive" as const };

  const leadOpportunityMatch: Prisma.CompanyWhereInput = {
    leadOpportunities: {
      some: { OR: [{ title: insensitiveContains }, { description: insensitiveContains }] },
    },
  };

  const contactMatch: Prisma.ContactWhereInput = {
    OR: [
      { firstName: insensitiveContains },
      { lastName: insensitiveContains },
      { email: insensitiveContains },
      { company: { is: { name: insensitiveContains } } },
      { company: { is: leadOpportunityMatch } },
    ],
  };

  const [drafts, replies] = await Promise.all([
    prisma.emailDraft.findMany({
      where: {
        organizationId,
        OR: [
          { subject: insensitiveContains },
          { body: insensitiveContains },
          { contact: { is: contactMatch } },
          { campaign: { is: { name: insensitiveContains } } },
        ],
      },
      include: { contact: { select: CONTACT_SELECT } },
    }),
    prisma.reply.findMany({
      where: {
        organizationId,
        OR: [
          { content: insensitiveContains },
          { contact: { is: contactMatch } },
          { campaign: { is: { name: insensitiveContains } } },
        ],
      },
      include: { contact: { select: CONTACT_SELECT } },
    }),
  ]);

  const merged: EmailCenterSearchResult[] = [
    ...drafts.map((draft) => ({ type: "DRAFT" as const, at: draft.sentAt ?? draft.createdAt, draft })),
    ...replies.map((reply) => ({ type: "REPLY" as const, at: reply.receivedAt, reply })),
  ];

  merged.sort((a, b) => b.at.getTime() - a.at.getTime());

  const totalCount = merged.length;
  const items = merged.slice(skip, skip + take);
  return { items, totalCount, page, pageSize };
}

/**
 * Marks a Reply as explicitly read. No-ops silently (no throw) if the reply
 * doesn't exist, belongs to a different organization, or is already read —
 * callers never need to pre-check state before calling this.
 */
export async function markReplyAsRead(replyId: string, organizationId: string): Promise<void> {
  await prisma.reply.updateMany({
    where: { id: replyId, organizationId, readAt: null },
    data: { readAt: new Date() },
  });
}
