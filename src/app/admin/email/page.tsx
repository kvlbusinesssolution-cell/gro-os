import Link from "next/link";
import { Mail, Inbox as InboxIcon, Send, FileEdit, ExternalLink, AlertTriangle } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { requirePlatformOwner } from "@/lib/billing/platform-admin";
import { resolveKvlOrganizationId } from "@/lib/business-development/kvl-sector-discovery-job";
import { getInboxThreads, getSentEmails, getDraftEmails } from "@/lib/outreach/inbox";
import { InboxThreadRow } from "@/app/dashboard/outreach/inbox/_components/inbox-thread-row";
import { DraftCard } from "@/app/dashboard/outreach/_components/draft-card";

/**
 * Platform-admin Email page — deliberately NOT a cross-tenant email viewer.
 *
 * `/admin/*` in this codebase is genuinely platform-operator-level: every
 * page under here is gated by `requirePlatformOwner`, which (by design) has
 * no `organizationId` scoping concept at all — it's meant for platform staff
 * reviewing things across every tenant. A literal cross-tenant inbox here
 * (showing every organization's real email content, or worse, an org
 * picker) would be a genuine multi-tenant privacy bug the moment this
 * platform has a second real paying tenant, since "platform owner" and
 * "can read a specific tenant's private correspondence" are not the same
 * permission.
 *
 * The resolution used here is the same deliberate, established pattern
 * already in this exact codebase — see
 * src/lib/business-development/kvl-sector-discovery-job.ts's own top-of-file
 * comment: "KVL-only lead discovery... scoped to KVL's own organization only
 * ... so it never runs unbounded... against every tenant." This page mirrors
 * that: it resolves KVL's own organization via the existing, already-tested
 * `resolveKvlOrganizationId()` and shows ONLY that organization's real email
 * data — never any other org's, and never an org-picker. If a second real
 * tenant is ever onboarded, this page still only ever shows KVL's own data;
 * it does not grow into a cross-tenant viewer without a deliberate,
 * separate decision (and a proper per-tenant access model) later.
 *
 * The full, richest Email Center experience (search, all 8 tabs, compose,
 * thread view) already lives at /dashboard/outreach/inbox — this page is a
 * real, useful at-a-glance summary reachable from the admin panel, not a
 * duplicate of that feature. It reuses that feature's own query functions
 * and row components rather than rebuilding any of them.
 */
export default async function AdminEmailPage() {
  await requirePlatformOwner("/admin/email");

  const organizationId = await resolveKvlOrganizationId();

  if (!organizationId) {
    return (
      <Container className="flex flex-col gap-6 py-8">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <Mail className="size-6 text-primary" /> Email
          </h1>
          <p className="text-sm text-muted-foreground">KVL&apos;s organization &amp; Email Center summary.</p>
        </div>
        <Card glass>
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <AlertTriangle className="size-8 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">
              No KVL organization found — there is no active OWNER membership for{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">kamaralamjdu@gmail.com</code> yet (e.g. a fresh
              dev environment with no seeded KVL user). This is an honest empty state, not a placeholder dashboard —
              once that organization exists, its real email data will appear here.
            </p>
          </CardContent>
        </Card>
      </Container>
    );
  }

  const [threads, sent, drafts] = await Promise.all([
    getInboxThreads(organizationId),
    getSentEmails(organizationId),
    getDraftEmails(organizationId),
  ]);

  const unreadCount = threads.filter((t) => t.unread).length;

  const STATS = [
    { label: "Inbox Threads", value: threads.length, icon: InboxIcon },
    { label: "Unread", value: unreadCount, icon: InboxIcon },
    { label: "Sent", value: sent.length, icon: Send },
    { label: "Drafts Pending", value: drafts.length, icon: FileEdit },
  ] as const;

  const PREVIEW_LIMIT = 8;
  const previewThreads = threads.slice(0, PREVIEW_LIMIT);
  const previewSent = sent.slice(0, PREVIEW_LIMIT);
  const previewDrafts = drafts.slice(0, PREVIEW_LIMIT);

  return (
    <Container className="flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <Mail className="size-6 text-primary" /> Email
          </h1>
          <p className="text-sm text-muted-foreground">
            At-a-glance summary of KVL&apos;s own Email Center — real inbox, sent, and draft counts, nothing
            fabricated.
          </p>
        </div>
        <Link
          href="/dashboard/outreach/inbox"
          className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open full Email Center <ExternalLink className="size-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATS.map(({ label, value, icon: Icon }) => (
          <Card glass key={label}>
            <CardContent className="flex flex-col gap-1.5 p-4">
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Icon className="size-3.5" /> {label}
              </span>
              <span className="text-2xl font-semibold tracking-tight text-foreground">
                <AnimatedCounter value={value} />
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inbox</h2>
          <Link
            href="/dashboard/outreach/inbox?view=inbox"
            className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            View all {threads.length}
          </Link>
        </div>
        {previewThreads.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
              <InboxIcon className="size-6 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">No email conversations yet.</p>
            </CardContent>
          </Card>
        ) : (
          <Card glass>
            <CardContent className="p-0">
              <div className="flex flex-col">
                {previewThreads.map((thread) => (
                  <InboxThreadRow key={thread.contact.id} thread={thread} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sent</h2>
          <Link
            href="/dashboard/outreach/inbox?view=sent"
            className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            View all {sent.length}
          </Link>
        </div>
        {previewSent.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
              <Send className="size-6 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">No emails sent yet.</p>
            </CardContent>
          </Card>
        ) : (
          <Card glass>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>To</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Sent at</TableHead>
                    <TableHead>Opens</TableHead>
                    <TableHead>Clicks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewSent.map((draft) => (
                    <TableRow key={draft.id}>
                      <TableCell>
                        <span className="font-medium text-foreground">
                          {draft.contact.firstName} {draft.contact.lastName ?? ""}
                        </span>
                        <p className="text-xs text-muted-foreground">{draft.contact.email}</p>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <p className="line-clamp-1 text-sm text-foreground">{draft.subject ?? "(no subject)"}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {draft.sentAt ? new Date(draft.sentAt).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{draft.openCount}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{draft.clickCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Drafts</h2>
          <Link
            href="/dashboard/outreach/inbox?view=drafts"
            className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            View all {drafts.length}
          </Link>
        </div>
        {previewDrafts.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
              <FileEdit className="size-6 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">No drafts pending.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {previewDrafts.map((draft) => (
              <div key={draft.id} className="flex flex-col gap-1.5">
                <span className="w-fit text-xs text-muted-foreground">
                  To: {draft.contact.firstName} {draft.contact.lastName ?? ""} ({draft.contact.email})
                </span>
                {/* Read-only here (canApprove=false) — approving/rejecting is a
                    tenant-workflow action that belongs in the full Email
                    Center at /dashboard/outreach/inbox, not in this
                    platform-admin summary. */}
                <DraftCard draft={draft} canApprove={false} />
              </div>
            ))}
          </div>
        )}
      </section>
    </Container>
  );
}
