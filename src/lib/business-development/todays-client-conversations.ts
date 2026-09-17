import { prisma } from "@/lib/prisma";
import { suggestNextActionForCompany } from "./company-next-action";
import type { ReplyIntent } from "@/generated/prisma/client";

/**
 * "Today's Client Conversations" for the Revenue Command Center — the same
 * real client-wise merge of outreach state (EmailDraft) and reply state
 * (Reply) as `/dashboard/crm/sales-view` (src/app/dashboard/crm/sales-view/page.tsx),
 * but scoped to TODAY only: a contact appears here only when their most
 * recent EmailDraft `sentAt` or Reply `receivedAt` falls on today (same
 * `startOfDay` convention as revenue-command-center.ts's own helper — a
 * calendar day in the server's local time). A contact whose only activity is
 * from a previous day never appears, even if that's their "most recent"
 * activity overall.
 *
 * LeadOpportunity and Deal have no FK to each other — both are queried
 * independently off the contact's companyId, exactly the same discipline
 * sales-view/page.tsx already follows (read there for the reference
 * pattern; not imported, since that page's query is scoped to its own
 * pagination/filter needs).
 */
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface TodaysConversation {
  contact: { id: string; firstName: string; lastName: string | null; email: string };
  company: { id: string; name: string } | null;
  lastEmailAt: Date | null;
  lastReplyAt: Date | null;
  lastReplyPreview: string | null;
  intent: ReplyIntent | null;
  opportunity: { id: string; title: string } | null;
  deal: { id: string; name: string; value: number | null } | null;
  nextAction: string;
}

function toPreview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 100 ? `${trimmed.slice(0, 100)}…` : trimmed;
}

export async function getTodaysClientConversations(organizationId: string, now: Date = new Date()): Promise<TodaysConversation[]> {
  const dayStart = startOfDay(now);

  // Today's real activity, queried directly rather than filtering the
  // "any activity ever" contact list sales-view uses — a contact whose only
  // real event today is a sent email (no reply yet) or vice versa must still
  // appear, so both sources are queried independently and merged by contactId.
  const [todaysSentDrafts, todaysReplies] = await Promise.all([
    prisma.emailDraft.findMany({
      where: { organizationId, status: "SENT", sentAt: { gte: dayStart } },
      orderBy: { sentAt: "desc" },
      select: { contactId: true, sentAt: true },
    }),
    prisma.reply.findMany({
      where: { organizationId, receivedAt: { gte: dayStart } },
      orderBy: { receivedAt: "desc" },
      select: { id: true, contactId: true, receivedAt: true, content: true, intent: true },
    }),
  ]);

  const lastEmailByContact = new Map<string, Date>();
  for (const d of todaysSentDrafts) {
    if (!d.sentAt) continue;
    if (!lastEmailByContact.has(d.contactId)) lastEmailByContact.set(d.contactId, d.sentAt);
  }

  const lastReplyByContact = new Map<string, (typeof todaysReplies)[number]>();
  for (const r of todaysReplies) {
    if (!lastReplyByContact.has(r.contactId)) lastReplyByContact.set(r.contactId, r);
  }

  const contactIds = Array.from(new Set([...lastEmailByContact.keys(), ...lastReplyByContact.keys()]));
  if (contactIds.length === 0) return [];

  const contacts = await prisma.contact.findMany({
    where: { organizationId, id: { in: contactIds } },
    include: { company: { select: { id: true, name: true } } },
  });

  const companyIds = Array.from(new Set(contacts.map((c) => c.company?.id).filter((id): id is string => !!id)));

  const [opportunities, deals] = await Promise.all([
    companyIds.length > 0
      ? prisma.leadOpportunity.findMany({
          where: { companyId: { in: companyIds }, company: { organizationId } },
          orderBy: { createdAt: "desc" },
          select: { id: true, companyId: true, title: true },
        })
      : Promise.resolve([]),
    companyIds.length > 0
      ? prisma.deal.findMany({
          where: { companyId: { in: companyIds }, organizationId },
          orderBy: { createdAt: "desc" },
          select: { id: true, companyId: true, name: true, value: true },
        })
      : Promise.resolve([]),
  ]);

  const latestOpportunityByCompany = new Map<string, (typeof opportunities)[number]>();
  for (const o of opportunities) {
    if (o.companyId && !latestOpportunityByCompany.has(o.companyId)) latestOpportunityByCompany.set(o.companyId, o);
  }
  const latestDealByCompany = new Map<string, (typeof deals)[number]>();
  for (const d of deals) {
    if (d.companyId && !latestDealByCompany.has(d.companyId)) latestDealByCompany.set(d.companyId, d);
  }

  const rows: TodaysConversation[] = [];
  for (const contact of contacts) {
    const lastEmailAt = lastEmailByContact.get(contact.id) ?? null;
    const latestReply = lastReplyByContact.get(contact.id) ?? null;
    const companyId = contact.company?.id ?? null;
    const opportunity = companyId ? (latestOpportunityByCompany.get(companyId) ?? null) : null;
    const deal = companyId ? (latestDealByCompany.get(companyId) ?? null) : null;

    // Reuse suggestNextActionForCompany (company-next-action.ts) — it's a
    // company-level heuristic (surfaces the real Task reply-automation.ts
    // creates after the company's latest reply, else a deterministic
    // fallback), not per-contact, but that's the same granularity sales-view
    // itself effectively resolves to per row today (one dominant contact per
    // company in practice) — reused rather than inventing a second,
    // parallel next-action concept. Companyless contacts get a plain,
    // deterministic fallback below instead of a fabricated call.
    const nextAction = companyId
      ? (await suggestNextActionForCompany(organizationId, companyId)).action
      : latestReply
        ? "Review reply"
        : "Awaiting reply";

    rows.push({
      contact: { id: contact.id, firstName: contact.firstName, lastName: contact.lastName, email: contact.email },
      company: contact.company ? { id: contact.company.id, name: contact.company.name } : null,
      lastEmailAt,
      lastReplyAt: latestReply?.receivedAt ?? null,
      lastReplyPreview: latestReply ? toPreview(latestReply.content) : null,
      intent: latestReply?.intent ?? null,
      opportunity: opportunity ? { id: opportunity.id, title: opportunity.title } : null,
      deal: deal ? { id: deal.id, name: deal.name, value: deal.value } : null,
      nextAction,
    });
  }

  rows.sort((a, b) => {
    const aTime = Math.max(a.lastEmailAt?.getTime() ?? 0, a.lastReplyAt?.getTime() ?? 0);
    const bTime = Math.max(b.lastEmailAt?.getTime() ?? 0, b.lastReplyAt?.getTime() ?? 0);
    return bTime - aTime;
  });

  return rows;
}
