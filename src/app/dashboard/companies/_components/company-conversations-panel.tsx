import Link from "next/link";
import {
  Mail,
  Send,
  Inbox,
  Clock,
  Eye,
  MessageSquareReply,
  Sparkles,
  ArrowRight,
  CheckSquare,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AskAiBox } from "./ask-ai-box";
import type { ConversationSummary } from "@/lib/business-development/company-conversation-summary";

export interface EmailStatsView {
  totalEmails: number;
  sent: number;
  received: number;
  lastContactAt: string | null;
  lastReplyAt: string | null;
  /** Percent (0-100), or null when there's no real denominator to compute one from — never a fabricated 0%. */
  openRate: number | null;
  clickRate: number | null;
  replyRate: number | null;
}

export interface ConversationThreadView {
  contactId: string;
  contactName: string;
  contactEmail: string;
  lastActivityAt: string;
  emailCount: number;
  replyCount: number;
  lastSubject: string | null;
}

export interface TimelineEntryView {
  type: string;
  label: string;
  occurredAt: string;
  recordId: string;
  recordType: string;
  linkHref: string | null;
}

export interface NextActionView {
  action: string;
  taskId: string | null;
}

function StatTile({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value ?? "—"}</p>
    </div>
  );
}

function formatDateTime(value: string | null): string | null {
  return value ? new Date(value).toLocaleString() : null;
}

function formatPercent(value: number | null): string | null {
  return value == null ? null : `${value}%`;
}

export function CompanyConversationsPanel({
  companyId,
  stats,
  threads,
  timeline,
  summary,
  nextAction,
}: {
  companyId: string;
  stats: EmailStatsView;
  threads: ConversationThreadView[];
  timeline: TimelineEntryView[];
  summary: ConversationSummary | null;
  nextAction: NextActionView;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card glass>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="size-4" /> Email &amp; conversations
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Total emails" value={stats.totalEmails} />
            <StatTile label="Sent" value={stats.sent} />
            <StatTile label="Received" value={stats.received} />
            <StatTile label="Last contact" value={formatDateTime(stats.lastContactAt)} />
            <StatTile label="Last client reply" value={formatDateTime(stats.lastReplyAt)} />
            <StatTile label="Open rate" value={formatPercent(stats.openRate)} />
            <StatTile label="Click rate" value={formatPercent(stats.clickRate)} />
            <StatTile label="Reply rate" value={formatPercent(stats.replyRate)} />
          </div>
        </CardContent>
      </Card>

      <Card glass>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowRight className="size-4" /> Next action
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-foreground">{nextAction.action}</p>
            {nextAction.taskId && (
              <Link href="/dashboard/crm/tasks" className="flex items-center gap-1 text-xs text-primary hover:underline">
                <CheckSquare className="size-3.5" /> View task
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      <Card glass>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" /> AI conversation summary
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {!summary ? (
            <p className="text-sm text-muted-foreground">
              Not enough real conversation yet — once there&apos;s at least one sent email or client reply on file, an
              AI-grounded summary will appear here.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <Badge variant="accent" className="w-fit">AI-generated — grounded only in real emails/replies on file</Badge>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold text-foreground">Current status</p>
                  <p className="mt-1 text-sm text-muted-foreground">{summary.currentStatus}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">Next action (AI view)</p>
                  <p className="mt-1 text-sm text-muted-foreground">{summary.nextAction}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">Pricing discussion</p>
                  <p className="mt-1 text-sm text-muted-foreground">{summary.pricingDiscussion || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">Timeline discussion</p>
                  <p className="mt-1 text-sm text-muted-foreground">{summary.timelineDiscussion || "—"}</p>
                </div>
              </div>

              {summary.clientRequirements.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground">Client requirements</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {summary.clientRequirements.map((r, i) => (
                      <li key={i} className="text-sm text-muted-foreground before:mr-1.5 before:text-primary before:content-['•']">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {summary.requirementsConfirmed.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground">Confirmed</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {summary.requirementsConfirmed.map((r, i) => (
                      <li key={i} className="text-sm text-muted-foreground before:mr-1.5 before:text-primary before:content-['•']">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {summary.requirementsUnknown.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground">Still unknown</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {summary.requirementsUnknown.map((r, i) => (
                      <li key={i} className="text-sm text-muted-foreground before:mr-1.5 before:text-amber-500 before:content-['•']">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {summary.objections.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-foreground">Objections</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {summary.objections.map((r, i) => (
                      <li key={i} className="text-sm text-muted-foreground before:mr-1.5 before:text-primary before:content-['•']">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(summary.questionsAsked.length > 0 || summary.questionsAnswered.length > 0) && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {summary.questionsAsked.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground">Questions asked</p>
                      <ul className="mt-1 flex flex-col gap-1">
                        {summary.questionsAsked.map((q, i) => (
                          <li key={i} className="text-sm text-muted-foreground before:mr-1.5 before:text-primary before:content-['•']">
                            {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {summary.questionsAnswered.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground">Questions answered</p>
                      <ul className="mt-1 flex flex-col gap-1">
                        {summary.questionsAnswered.map((q, i) => (
                          <li key={i} className="text-sm text-muted-foreground before:mr-1.5 before:text-primary before:content-['•']">
                            {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AskAiBox companyId={companyId} />

      <Card glass>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="size-4" /> All conversations
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {threads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No email activity yet for this company&apos;s contacts.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {threads.map((thread) => (
                <Link
                  key={thread.contactId}
                  href={`/dashboard/outreach/inbox/${thread.contactId}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0 hover:text-primary"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{thread.contactName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {thread.contactEmail}
                      {thread.lastSubject ? ` — ${thread.lastSubject}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Send className="size-3.5" /> {thread.emailCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquareReply className="size-3.5" /> {thread.replyCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" /> {new Date(thread.lastActivityAt).toLocaleDateString()}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card glass>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="size-4" /> Complete timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No timeline activity yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {timeline.map((entry, index) => {
                const content = (
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="text-sm text-foreground">{entry.label}</p>
                    <p className="text-xs text-muted-foreground">{new Date(entry.occurredAt).toLocaleString()}</p>
                  </div>
                );
                return (
                  <li key={`${entry.recordType}-${entry.recordId}-${index}`} className="flex items-start gap-3">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    {entry.linkHref ? (
                      <Link href={entry.linkHref} className="min-w-0 flex-1 hover:text-primary">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
