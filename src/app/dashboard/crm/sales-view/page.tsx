import Link from "next/link";
import { Users, RotateCcw } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import { formatCurrency } from "../../_lib/format";
import { ReplyIntent as ReplyIntentEnum } from "@/generated/prisma/client";
import type { ReplyIntent } from "@/generated/prisma/client";

/**
 * Client-wise Sales View — one row per Contact with real conversation
 * activity (>= 1 EmailDraft or Reply), merging outreach state (Email
 * Inbox/inbox.ts's own "has activity" filter) with CRM pipeline state
 * (LeadOpportunity, Deal) so a salesperson can see, per client, exactly
 * where the relationship stands without hopping between the Email Inbox and
 * the CRM pipeline. Every column is real data queried live — no column is
 * ever fabricated; a contact with no opportunity/deal yet says so.
 *
 * LeadOpportunity has no FK to Deal (see prisma/schema.prisma) — both are
 * queried independently off the contact's companyId, exactly like
 * priority-queue and the CRM dashboard already do elsewhere.
 */

const REPLY_INTENT_OPTIONS = Object.values(ReplyIntentEnum) as ReplyIntent[];

const INTENT_LABEL: Record<ReplyIntent, string> = {
  INTERESTED: "Interested",
  NOT_INTERESTED: "Not interested",
  NEEDS_INFORMATION: "Needs information",
  REQUEST_CALL: "Request call",
  REQUEST_PROPOSAL: "Request proposal",
  FOLLOW_UP_LATER: "Follow up later",
  PRICE_QUESTION: "Price question",
  WRONG_CONTACT: "Wrong contact",
  OUT_OF_OFFICE: "Out of office",
  UNSUBSCRIBE: "Unsubscribe",
  UNKNOWN: "Unknown",
};

function intentBadgeClassName(intent: ReplyIntent): string {
  if (intent === "INTERESTED" || intent === "REQUEST_CALL" || intent === "REQUEST_PROPOSAL") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }
  if (intent === "NOT_INTERESTED" || intent === "UNSUBSCRIBE" || intent === "WRONG_CONTACT") {
    return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400";
  }
  return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
}

function isReplyIntent(value: string | undefined): value is ReplyIntent {
  return !!value && (REPLY_INTENT_OPTIONS as readonly string[]).includes(value);
}

function toPreview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 100 ? `${trimmed.slice(0, 100)}…` : trimmed;
}

const PAGE_SIZE = 25;

interface SalesViewSearchParams {
  intent?: string;
  page?: string;
}

export default async function SalesViewPage({
  searchParams,
}: {
  searchParams: Promise<SalesViewSearchParams>;
}) {
  const params = await searchParams;
  const { membership } = await requireActiveMembership("/dashboard/crm/sales-view");
  const organizationId = membership.organizationId;
  const currency = membership.organization.currency;

  const intentFilter = isReplyIntent(params.intent) ? params.intent : undefined;
  const page = Math.max(1, Math.floor(Number(params.page) || 1));

  // Same "has activity" filter spirit as getInboxThreads in
  // src/lib/outreach/inbox.ts (read for reference, not imported — that
  // module's InboxThread shape doesn't carry the Task/company-pipeline data
  // this view also needs, so this page runs its own scoped query rather
  // than bolting unrelated fields onto a shared outreach type).
  const contacts = await prisma.contact.findMany({
    where: {
      organizationId,
      OR: [{ emailDrafts: { some: {} } }, { replies: { some: {} } }],
    },
    include: {
      company: { select: { id: true, name: true } },
      emailDrafts: { orderBy: { createdAt: "desc" }, take: 1 },
      replies: { orderBy: { receivedAt: "desc" }, take: 1 },
      tasks: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const contactIds = contacts.map((c) => c.id);

  // Latest SENT draft per contact, fetched separately (a single relation
  // can only be `include`d once per query, and the `emailDrafts` above is
  // deliberately "latest of any status" for the pending-draft fallback
  // below) — one batched query, reduced to a Map in JS, same
  // batch-then-reduce shape as priority-queue's own filter-option queries.
  const sentDrafts =
    contactIds.length > 0
      ? await prisma.emailDraft.findMany({
          where: { organizationId, status: "SENT", contactId: { in: contactIds } },
          orderBy: { sentAt: "desc" },
        })
      : [];
  const latestSentByContact = new Map<string, (typeof sentDrafts)[number]>();
  for (const draft of sentDrafts) {
    if (!latestSentByContact.has(draft.contactId)) latestSentByContact.set(draft.contactId, draft);
  }

  interface Row {
    contactId: string;
    clientName: string;
    companyId: string | null;
    companyName: string | null;
    lastContactAt: Date | null;
    lastContactIsDraftOnly: boolean;
    lastReplyPreview: string | null;
    lastReplyAt: Date | null;
    intent: ReplyIntent | null;
    nextAction: string;
  }

  const rows: Row[] = contacts.map((contact) => {
    const latestSent = latestSentByContact.get(contact.id) ?? null;
    const latestReply = contact.replies[0] ?? null;
    const latestAnyDraft = contact.emailDrafts[0] ?? null;
    const latestTask = contact.tasks[0] ?? null;

    const replyIsLatestEvent = Boolean(latestReply) && (!latestSent || latestReply!.receivedAt > latestSent.sentAt!);

    let lastContactAt: Date | null = null;
    let lastContactIsDraftOnly = false;
    if (latestSent && latestReply) {
      lastContactAt = latestSent.sentAt! >= latestReply.receivedAt ? latestSent.sentAt! : latestReply.receivedAt;
    } else if (latestSent) {
      lastContactAt = latestSent.sentAt!;
    } else if (latestReply) {
      lastContactAt = latestReply.receivedAt;
    } else if (latestAnyDraft) {
      // Only unsent drafts exist (DRAFT/PENDING_APPROVAL/APPROVED/QUEUED) —
      // still real activity, honestly labeled as draft-only below.
      lastContactAt = latestAnyDraft.createdAt;
      lastContactIsDraftOnly = true;
    }

    let nextAction: string;
    if (replyIsLatestEvent) {
      const taskExistsAfterReply = Boolean(latestTask) && latestTask!.createdAt >= latestReply!.receivedAt;
      nextAction = taskExistsAfterReply ? "Follow-up task created" : "Review reply";
    } else if (latestSent) {
      nextAction = "Awaiting reply";
    } else if (latestAnyDraft) {
      nextAction = "Draft pending send";
    } else {
      nextAction = "No activity yet";
    }

    return {
      contactId: contact.id,
      clientName: `${contact.firstName} ${contact.lastName ?? ""}`.trim(),
      companyId: contact.company?.id ?? null,
      companyName: contact.company?.name ?? null,
      lastContactAt,
      lastContactIsDraftOnly,
      lastReplyPreview: latestReply ? toPreview(latestReply.content) : null,
      lastReplyAt: latestReply?.receivedAt ?? null,
      intent: latestReply?.intent ?? null,
      nextAction,
    };
  });

  const filteredRows = intentFilter ? rows.filter((r) => r.intent === intentFilter) : rows;
  filteredRows.sort((a, b) => (b.lastContactAt?.getTime() ?? 0) - (a.lastContactAt?.getTime() ?? 0));

  const totalCount = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  // Company-level pipeline data (LeadOpportunity, Deal) — queried
  // independently off companyId, only for the companies actually shown on
  // this page, and always re-scoped to this organization even though the
  // companyIds already came from an org-scoped contact query (defense in
  // depth, same discipline as priority-queue's `company: { organizationId }`
  // conditions).
  const companyIds = Array.from(new Set(pageRows.map((r) => r.companyId).filter((id): id is string => !!id)));

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

  const buildHref = (nextPage: number) => {
    const search = new URLSearchParams();
    if (intentFilter) search.set("intent", intentFilter);
    if (nextPage > 1) search.set("page", String(nextPage));
    const qs = search.toString();
    return `/dashboard/crm/sales-view${qs ? `?${qs}` : ""}`;
  };

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Client-wise Sales View</h1>
          <p className="text-sm text-muted-foreground">
            Every client with real conversation activity, one row each — last contact, last reply, reply intent, and
            this client&apos;s most recent Opportunity and Deal, merged from the Email Inbox and CRM pipeline.
          </p>
        </div>

        <Card glass>
          <CardContent className="p-4">
            <form className="flex flex-wrap items-end gap-3" action="/dashboard/crm/sales-view" method="GET">
              <div className="flex flex-col gap-1">
                <label htmlFor="intent" className="text-xs text-muted-foreground">
                  Reply intent
                </label>
                <Select id="intent" name="intent" defaultValue={intentFilter ?? ""} className="w-52">
                  <option value="">All intents</option>
                  {REPLY_INTENT_OPTIONS.map((i) => (
                    <option key={i} value={i}>
                      {INTENT_LABEL[i]}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="submit"
                className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Apply filter
              </button>
              <Link
                href="/dashboard/crm/sales-view"
                className="flex h-11 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="size-3.5" /> Reset
              </Link>
            </form>
          </CardContent>
        </Card>

        {pageRows.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <Users className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                No clients with real conversation activity match these filters yet — send an email or log a reply
                first, or widen the filter above.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card glass>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Last Contact</TableHead>
                    <TableHead>Last Reply</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Opportunity</TableHead>
                    <TableHead>Deal</TableHead>
                    <TableHead>Next Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row) => {
                    const opportunity = row.companyId ? latestOpportunityByCompany.get(row.companyId) : undefined;
                    const deal = row.companyId ? latestDealByCompany.get(row.companyId) : undefined;

                    return (
                      <TableRow key={row.contactId}>
                        <TableCell>
                          <Link
                            href={`/dashboard/outreach/inbox/${row.contactId}`}
                            className="font-medium text-foreground transition-colors hover:text-primary"
                          >
                            {row.clientName}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {row.companyId ? (
                            <Link
                              href={`/dashboard/companies/${row.companyId}`}
                              className="text-sm text-foreground transition-colors hover:text-primary"
                            >
                              {row.companyName}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">No company on file</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {row.lastContactAt ? (
                            <>
                              {row.lastContactAt.toLocaleString()}
                              {row.lastContactIsDraftOnly && (
                                <span className="ml-1 text-xs text-muted-foreground">(draft, not sent)</span>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          {row.lastReplyPreview ? (
                            <div>
                              <p className="line-clamp-2 text-sm text-foreground">{row.lastReplyPreview}</p>
                              <p className="text-xs text-muted-foreground">{row.lastReplyAt?.toLocaleString()}</p>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">No reply yet</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.intent ? (
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${intentBadgeClassName(row.intent)}`}
                            >
                              {INTENT_LABEL[row.intent]}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {opportunity ? (
                            <Link
                              href={`/dashboard/opportunities/${opportunity.id}`}
                              className="text-sm text-foreground transition-colors hover:text-primary"
                            >
                              {opportunity.title}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">None yet</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {deal ? (
                            <Link
                              href={`/dashboard/crm/deals/${deal.id}`}
                              className="text-sm text-foreground transition-colors hover:text-primary"
                            >
                              {deal.name}
                              {deal.value !== null && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  ({formatCurrency(deal.value, currency)})
                                </span>
                              )}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">None yet</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[160px]">
                          <p className="text-sm text-muted-foreground">{row.nextAction}</p>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <Link
              href={buildHref(Math.max(1, clampedPage - 1))}
              className={clampedPage <= 1 ? "pointer-events-none opacity-40" : "hover:text-foreground"}
            >
              Previous
            </Link>
            <span>
              Page {clampedPage} of {totalPages} ({totalCount} client{totalCount === 1 ? "" : "s"})
            </span>
            <Link
              href={buildHref(Math.min(totalPages, clampedPage + 1))}
              className={clampedPage >= totalPages ? "pointer-events-none opacity-40" : "hover:text-foreground"}
            >
              Next
            </Link>
          </div>
        )}
      </Container>
    </main>
  );
}
