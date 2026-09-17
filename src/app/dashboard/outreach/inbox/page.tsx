import Link from "next/link";
import {
  Inbox as InboxIcon,
  Send,
  FileEdit,
  PenSquare,
  Sparkles,
  Clock,
  AlertTriangle,
  MessagesSquare,
  Bot,
  Megaphone,
  Search as SearchIcon,
} from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { requireActiveMembership } from "../../_lib/require-membership";
import {
  getInboxThreads,
  getSentEmails,
  getDraftEmails,
  getScheduledEmails,
  getFailedEmails,
  getThreadsView,
  getAiGeneratedEmails,
  getCampaignEmails,
  searchEmailCenter,
  type EmailCenterSearchResult,
} from "@/lib/outreach/inbox";
import { DraftCard } from "../_components/draft-card";
import { InboxThreadRow } from "./_components/inbox-thread-row";
import { PaginationControls } from "./_components/pagination-controls";
import { SearchBox } from "./_components/search-box";

type InboxView = "inbox" | "sent" | "drafts" | "scheduled" | "failed" | "threads" | "ai" | "campaign";

const TABS: Array<{ value: InboxView; label: string; icon: typeof InboxIcon }> = [
  { value: "inbox", label: "Inbox", icon: InboxIcon },
  { value: "sent", label: "Sent", icon: Send },
  { value: "drafts", label: "Drafts", icon: FileEdit },
  { value: "scheduled", label: "Scheduled", icon: Clock },
  { value: "failed", label: "Failed", icon: AlertTriangle },
  { value: "threads", label: "Threads", icon: MessagesSquare },
  { value: "ai", label: "AI Generated", icon: Bot },
  { value: "campaign", label: "Campaign Emails", icon: Megaphone },
];

const VIEW_VALUES = TABS.map((t) => t.value);

function isInboxView(value: string | undefined): value is InboxView {
  return Boolean(value) && (VIEW_VALUES as string[]).includes(value as string);
}

function parsePage(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export default async function OutreachInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const { membership } = await requireActiveMembership("/dashboard/outreach/inbox");
  const organizationId = membership.organizationId;
  const canApprove = membership.role === "OWNER" || membership.role === "ADMIN";

  const view: InboxView = isInboxView(params.view) ? params.view : "inbox";
  const page = parsePage(params.page);
  const query = params.q?.trim() ?? "";

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

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex w-fit flex-wrap items-center gap-1 rounded-xl border border-border bg-card/40 p-1">
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
          <SearchBox defaultValue={params.q} view={view} />
        </div>

        {query ? (
          <SearchResultsView organizationId={organizationId} query={query} page={page} view={view} />
        ) : (
          <>
            {view === "inbox" && <InboxTabView organizationId={organizationId} />}
            {view === "sent" && <SentView organizationId={organizationId} />}
            {view === "drafts" && <DraftsView organizationId={organizationId} canApprove={canApprove} />}
            {view === "scheduled" && (
              <ScheduledView organizationId={organizationId} canApprove={canApprove} page={page} />
            )}
            {view === "failed" && <FailedView organizationId={organizationId} canApprove={canApprove} page={page} />}
            {view === "threads" && <ThreadsView organizationId={organizationId} page={page} />}
            {view === "ai" && <AiGeneratedView organizationId={organizationId} canApprove={canApprove} page={page} />}
            {view === "campaign" && (
              <CampaignEmailsView organizationId={organizationId} canApprove={canApprove} page={page} />
            )}
          </>
        )}
      </Container>
    </main>
  );
}

function EmptyState({ icon: Icon, message }: { icon: typeof InboxIcon; message: string }) {
  return (
    <Card glass>
      <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
        <Icon className="size-8 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

async function InboxTabView({ organizationId }: { organizationId: string }) {
  const threads = await getInboxThreads(organizationId);

  if (threads.length === 0) {
    return (
      <EmptyState
        icon={InboxIcon}
        message="No email conversations yet — sent emails and real replies will appear here automatically."
      />
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
    return <EmptyState icon={Send} message="No emails sent yet." />;
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
      <EmptyState
        icon={Sparkles}
        message="No drafts pending yet — AI-generated drafts show up here pending approval, or write one yourself."
      />
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

async function ScheduledView({
  organizationId,
  canApprove,
  page,
}: {
  organizationId: string;
  canApprove: boolean;
  page: number;
}) {
  const { items, totalCount, pageSize } = await getScheduledEmails(organizationId, { page });

  if (totalCount === 0) {
    return (
      <EmptyState
        icon={Clock}
        message="Nothing scheduled — drafts sent with a future send time from Compose's Schedule action will wait here."
      />
    );
  }

  return (
    <Card glass>
      <CardContent className="flex flex-col gap-0 p-4">
        <div className="flex flex-col gap-3 pb-2">
          {items.map((draft) => (
            <div key={draft.id} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/dashboard/outreach/inbox/${draft.contact.id}`}
                  className="w-fit text-xs text-muted-foreground transition-colors hover:text-primary"
                >
                  To: {draft.contact.firstName} {draft.contact.lastName ?? ""} ({draft.contact.email})
                </Link>
                {draft.scheduledFor && (
                  <Badge variant="accent" className="text-[10px]">
                    Scheduled for {new Date(draft.scheduledFor).toLocaleString()}
                  </Badge>
                )}
              </div>
              <DraftCard draft={draft} canApprove={canApprove} />
            </div>
          ))}
        </div>
      </CardContent>
      <PaginationControls
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        basePath="/dashboard/outreach/inbox"
        params={{ view: "scheduled" }}
      />
    </Card>
  );
}

async function FailedView({
  organizationId,
  canApprove,
  page,
}: {
  organizationId: string;
  canApprove: boolean;
  page: number;
}) {
  const { items, totalCount, pageSize } = await getFailedEmails(organizationId, { page });

  if (totalCount === 0) {
    return <EmptyState icon={AlertTriangle} message="No failed, rejected, or bounced emails." />;
  }

  return (
    <Card glass>
      <CardContent className="flex flex-col gap-3 p-4">
        {items.map((draft) => {
          const latestApproval = draft.approvals[0];
          return (
            <div key={draft.id} className="flex flex-col gap-1.5">
              <Link
                href={`/dashboard/outreach/inbox/${draft.contact.id}`}
                className="w-fit text-xs text-muted-foreground transition-colors hover:text-primary"
              >
                To: {draft.contact.firstName} {draft.contact.lastName ?? ""} ({draft.contact.email})
              </Link>
              <DraftCard draft={draft} canApprove={canApprove} />
              {draft.status === "FAILED" && draft.failedReason && (
                <p className="text-xs text-destructive">Failure reason: {draft.failedReason}</p>
              )}
              {draft.status === "BOUNCED" && draft.bounceReason && (
                <p className="text-xs text-destructive">Bounce reason: {draft.bounceReason}</p>
              )}
              {draft.status === "REJECTED" && latestApproval?.comment && (
                <p className="text-xs text-destructive">Rejection reason: {latestApproval.comment}</p>
              )}
            </div>
          );
        })}
      </CardContent>
      <PaginationControls
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        basePath="/dashboard/outreach/inbox"
        params={{ view: "failed" }}
      />
    </Card>
  );
}

async function ThreadsView({ organizationId, page }: { organizationId: string; page: number }) {
  const { items, totalCount, pageSize } = await getThreadsView(organizationId, { page });

  if (totalCount === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        message="No email conversations yet — sent emails and real replies will appear here automatically."
      />
    );
  }

  return (
    <Card glass>
      <CardContent className="p-0">
        <div className="flex flex-col">
          {items.map((thread) => (
            <InboxThreadRow key={thread.contact.id} thread={thread} />
          ))}
        </div>
      </CardContent>
      <PaginationControls
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        basePath="/dashboard/outreach/inbox"
        params={{ view: "threads" }}
      />
    </Card>
  );
}

async function AiGeneratedView({
  organizationId,
  canApprove,
  page,
}: {
  organizationId: string;
  canApprove: boolean;
  page: number;
}) {
  const { items, totalCount, pageSize } = await getAiGeneratedEmails(organizationId, { page });

  if (totalCount === 0) {
    return <EmptyState icon={Bot} message="No AI-generated drafts yet." />;
  }

  return (
    <Card glass>
      <CardContent className="flex flex-col gap-3 p-4">
        {items.map((draft) => (
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
      </CardContent>
      <PaginationControls
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        basePath="/dashboard/outreach/inbox"
        params={{ view: "ai" }}
      />
    </Card>
  );
}

async function CampaignEmailsView({
  organizationId,
  canApprove,
  page,
}: {
  organizationId: string;
  canApprove: boolean;
  page: number;
}) {
  const { items, totalCount, pageSize } = await getCampaignEmails(organizationId, { page });

  if (totalCount === 0) {
    return <EmptyState icon={Megaphone} message="No drafts attached to a campaign yet." />;
  }

  return (
    <Card glass>
      <CardContent className="flex flex-col gap-3 p-4">
        {items.map((draft) => (
          <div key={draft.id} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={`/dashboard/outreach/inbox/${draft.contact.id}`}
                className="w-fit text-xs text-muted-foreground transition-colors hover:text-primary"
              >
                To: {draft.contact.firstName} {draft.contact.lastName ?? ""} ({draft.contact.email})
              </Link>
              {draft.campaign && (
                <Badge variant="outline" className="text-[10px]">
                  {draft.campaign.name}
                </Badge>
              )}
            </div>
            <DraftCard draft={draft} canApprove={canApprove} />
          </div>
        ))}
      </CardContent>
      <PaginationControls
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        basePath="/dashboard/outreach/inbox"
        params={{ view: "campaign" }}
      />
    </Card>
  );
}

function searchResultKey(result: EmailCenterSearchResult): string {
  return result.type === "DRAFT" ? `draft-${result.draft.id}` : `reply-${result.reply.id}`;
}

async function SearchResultsView({
  organizationId,
  query,
  page,
  view,
}: {
  organizationId: string;
  query: string;
  page: number;
  view: InboxView;
}) {
  const { items, totalCount, pageSize } = await searchEmailCenter(organizationId, query, { page });

  if (totalCount === 0) {
    return (
      <EmptyState
        icon={SearchIcon}
        message={`No real matches for "${query}" across subjects, replies, contacts, companies, or campaigns.`}
      />
    );
  }

  return (
    <Card glass>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Preview</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((result) => {
              const contact = result.type === "DRAFT" ? result.draft.contact : result.reply.contact;
              const preview =
                result.type === "DRAFT" ? result.draft.subject ?? result.draft.body : result.reply.content;
              return (
                <TableRow key={searchResultKey(result)}>
                  <TableCell>
                    <Badge variant={result.type === "REPLY" ? "accent" : "outline"} className="text-[10px]">
                      {result.type === "REPLY" ? "Reply" : "Sent / Draft"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/outreach/inbox/${contact.id}`}
                      className="font-medium text-foreground transition-colors hover:text-primary"
                    >
                      {contact.firstName} {contact.lastName ?? ""}
                    </Link>
                    <p className="text-xs text-muted-foreground">{contact.email}</p>
                  </TableCell>
                  <TableCell className="max-w-sm">
                    <p className="line-clamp-1 text-sm text-foreground">{preview}</p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {new Date(result.at).toLocaleString()}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
      <PaginationControls
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        basePath="/dashboard/outreach/inbox"
        params={{ view, q: query }}
      />
    </Card>
  );
}
