import Link from "next/link";
import { Inbox as InboxIcon, Send, FileEdit, PenSquare, Sparkles } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { requireActiveMembership } from "../../_lib/require-membership";
import { getInboxThreads, getSentEmails, getDraftEmails } from "@/lib/outreach/inbox";
import { DraftCard } from "../_components/draft-card";
import { InboxThreadRow } from "./_components/inbox-thread-row";

type InboxView = "inbox" | "sent" | "drafts";

const TABS: Array<{ value: InboxView; label: string; icon: typeof InboxIcon }> = [
  { value: "inbox", label: "Inbox", icon: InboxIcon },
  { value: "sent", label: "Sent", icon: Send },
  { value: "drafts", label: "Drafts", icon: FileEdit },
];

function isInboxView(value: string | undefined): value is InboxView {
  return value === "inbox" || value === "sent" || value === "drafts";
}

export default async function OutreachInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const params = await searchParams;
  const { membership } = await requireActiveMembership("/dashboard/outreach/inbox");
  const organizationId = membership.organizationId;
  const canApprove = membership.role === "OWNER" || membership.role === "ADMIN";

  const view: InboxView = isInboxView(params.view) ? params.view : "inbox";

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Email Inbox</h1>
            <p className="text-sm text-muted-foreground">
              Every sent email and real reply, merged into one conversation per contact.
            </p>
          </div>
          <Link
            href="/dashboard/outreach/inbox/compose"
            className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <PenSquare className="size-3.5" /> Write Email
          </Link>
        </div>

        <div className="flex w-fit items-center gap-1 rounded-xl border border-border bg-card/40 p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = view === tab.value;
            return (
              <Link
                key={tab.value}
                href={`/dashboard/outreach/inbox?view=${tab.value}`}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" /> {tab.label}
              </Link>
            );
          })}
        </div>

        {view === "inbox" && <InboxView organizationId={organizationId} />}
        {view === "sent" && <SentView organizationId={organizationId} />}
        {view === "drafts" && <DraftsView organizationId={organizationId} canApprove={canApprove} />}
      </Container>
    </main>
  );
}

async function InboxView({ organizationId }: { organizationId: string }) {
  const threads = await getInboxThreads(organizationId);

  if (threads.length === 0) {
    return (
      <Card glass>
        <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <InboxIcon className="size-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-sm text-muted-foreground">
            No email conversations yet — sent emails and real replies will appear here automatically.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card glass>
      <CardContent className="p-0">
        <div className="flex flex-col">
          {threads.map((thread) => (
            <InboxThreadRow key={thread.contact.id} thread={thread} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

async function SentView({ organizationId }: { organizationId: string }) {
  const sent = await getSentEmails(organizationId);

  if (sent.length === 0) {
    return (
      <Card glass>
        <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <Send className="size-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-sm text-muted-foreground">No emails sent yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
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
            {sent.map((draft) => (
              <TableRow key={draft.id}>
                <TableCell>
                  <Link
                    href={`/dashboard/outreach/inbox/${draft.contact.id}`}
                    className="font-medium text-foreground transition-colors hover:text-primary"
                  >
                    {draft.contact.firstName} {draft.contact.lastName ?? ""}
                  </Link>
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
  );
}

async function DraftsView({ organizationId, canApprove }: { organizationId: string; canApprove: boolean }) {
  const drafts = await getDraftEmails(organizationId);

  if (drafts.length === 0) {
    return (
      <Card glass>
        <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <Sparkles className="size-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-sm text-muted-foreground">
            No drafts pending yet — AI-generated drafts show up here pending approval, or write one yourself.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {drafts.map((draft) => (
        <div key={draft.id} className="flex flex-col gap-1.5">
          <Link
            href={`/dashboard/outreach/inbox/${draft.contact.id}`}
            className="w-fit text-xs text-muted-foreground transition-colors hover:text-primary"
          >
            To: {draft.contact.firstName} {draft.contact.lastName ?? ""} ({draft.contact.email})
          </Link>
          <DraftCard draft={draft} canApprove={canApprove} />
        </div>
      ))}
    </div>
  );
}
