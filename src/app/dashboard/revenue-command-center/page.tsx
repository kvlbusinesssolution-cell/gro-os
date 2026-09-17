import Link from "next/link";
import {
  Gauge,
  Building2,
  ShieldCheck,
  Flame,
  Rocket,
  Mail,
  MessageSquare,
  CalendarCheck,
  FileText,
  Trophy,
  Wallet,
  HelpCircle,
  Bot,
  PenSquare,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Users,
} from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { requireActiveMembership } from "../_lib/require-membership";
import { formatCurrency as formatOrgCurrency } from "../_lib/format";
import {
  computeRevenueCommandCenterToday,
  computeRevenueCommandCenterFunnel,
  emailCenterLinkForTile,
} from "@/lib/business-development/revenue-command-center";
import { getTodaysClientConversations } from "@/lib/business-development/todays-client-conversations";

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatRate(rate: number | null): string {
  if (rate === null) return "No data yet";
  return `${Math.round(rate * 100)}%`;
}

const TODAY_TILES = [
  { key: "companiesFound", label: "Companies Found", icon: Building2 },
  { key: "qualified", label: "Qualified", icon: ShieldCheck },
  { key: "highIntent", label: "High Intent", icon: Flame },
  { key: "readyForOutreach", label: "Ready for Outreach", icon: Rocket },
  { key: "emailsSent", label: "Emails Sent", icon: Mail },
  { key: "replies", label: "Replies", icon: MessageSquare },
  { key: "meetings", label: "Meetings", icon: CalendarCheck },
  { key: "proposals", label: "Proposals", icon: FileText },
  { key: "won", label: "Won", icon: Trophy },
  { key: "aiDraftsCreated", label: "AI Drafts", icon: Bot },
  { key: "humanDraftsCreated", label: "Human Drafts", icon: PenSquare },
  { key: "pendingApproval", label: "Pending Approval", icon: Clock },
  { key: "delivered", label: "Delivered", icon: CheckCircle2 },
  { key: "failedEmails", label: "Failed", icon: AlertTriangle },
] as const;

export default async function RevenueCommandCenterPage() {
  const { membership } = await requireActiveMembership("/dashboard/revenue-command-center");
  const organizationId = membership.organizationId;

  const [today, funnel, conversations] = await Promise.all([
    computeRevenueCommandCenterToday(organizationId),
    computeRevenueCommandCenterFunnel(organizationId),
    getTodaysClientConversations(organizationId),
  ]);
  const currency = membership.organization.currency;

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <Gauge className="size-6 text-primary" /> Revenue Command Center
          </h1>
          <p className="text-sm text-muted-foreground">
            One real, live screen across the whole Company Discovery → Opportunity → Decision Maker → Outreach →
            Reply → Meeting → Proposal → Deal pipeline — every number below is a real database count as of{" "}
            {today.asOf.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}, nothing estimated.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Today</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {TODAY_TILES.map(({ key, label, icon: Icon }) => {
              const href = emailCenterLinkForTile(key);
              const tile = (
                <Card glass className={href ? "transition-colors hover:border-primary/40" : undefined}>
                  <CardContent className="flex flex-col gap-1.5 p-4">
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Icon className="size-3.5" /> {label}
                    </span>
                    <span className="text-2xl font-semibold tracking-tight text-foreground">
                      <AnimatedCounter value={today[key]} />
                    </span>
                  </CardContent>
                </Card>
              );
              return href ? (
                <Link key={key} href={href} className="block">
                  {tile}
                </Link>
              ) : (
                <div key={key}>{tile}</div>
              );
            })}
            {(() => {
              const pipelineHref = emailCenterLinkForTile("pipelineValue");
              const pipelineTile = (
                <Card glass className={pipelineHref ? "transition-colors hover:border-primary/40" : undefined}>
                  <CardContent className="flex flex-col gap-1.5 p-4">
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Wallet className="size-3.5" /> Open Pipeline Value
                    </span>
                    <span className="text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(today.pipelineValue)}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {today.pipelineDealCount} open deal{today.pipelineDealCount === 1 ? "" : "s"} sourced from this pipeline — a
                      running total, not a today-only figure.
                    </span>
                  </CardContent>
                </Card>
              );
              return pipelineHref ? (
                <Link href={pipelineHref} className="block">
                  {pipelineTile}
                </Link>
              ) : (
                pipelineTile
              );
            })()}
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <HelpCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong className="text-foreground">Qualified</strong> = has at least one AI-detected Opportunity.{" "}
              <strong className="text-foreground">Ready for Outreach</strong> = qualified AND has a public Decision Maker identified
              (the two real preconditions the one-click &quot;Convert to Outreach&quot; action needs).{" "}
              <strong className="text-foreground">Won</strong> = deals currently in the Won stage last updated today — a best-effort
              proxy, not an exact &quot;moved to Won today&quot; count.{" "}
              <strong className="text-foreground">Delivered</strong> = sent today and not bounced — this app has no
              webhook-confirmed delivery event, so this is the closest honest proxy, not a true delivery receipt.
            </span>
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Lifetime Conversion Funnel
          </h2>
          <Card glass>
            <CardContent className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Reply → Meeting</p>
                <p className="text-xl font-semibold text-foreground">{formatRate(funnel.replyToMeetingRate)}</p>
                <p className="text-xs text-muted-foreground">
                  {funnel.totalMeetings} meeting{funnel.totalMeetings === 1 ? "" : "s"} from {funnel.totalReplies} repl
                  {funnel.totalReplies === 1 ? "y" : "ies"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Meeting → Proposal</p>
                <p className="text-xl font-semibold text-foreground">{formatRate(funnel.meetingToProposalRate)}</p>
                <p className="text-xs text-muted-foreground">
                  {funnel.totalProposals} proposal{funnel.totalProposals === 1 ? "" : "s"} from {funnel.totalMeetings} meeting
                  {funnel.totalMeetings === 1 ? "" : "s"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Proposal → Won Deal</p>
                <p className="text-xl font-semibold text-foreground">{formatRate(funnel.proposalToDealRate)}</p>
                <p className="text-xs text-muted-foreground">
                  {funnel.totalWonDeals} won from {funnel.totalProposals} proposal{funnel.totalProposals === 1 ? "" : "s"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Today&apos;s Client Conversations
          </h2>
          {conversations.length === 0 ? (
            <Card glass>
              <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
                <Users className="size-8 text-muted-foreground" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">
                  No client activity yet today — once an email is sent or a reply comes in today, it&apos;ll show up
                  here.
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
                      <TableHead>Last Email</TableHead>
                      <TableHead>Last Reply</TableHead>
                      <TableHead>Intent</TableHead>
                      <TableHead>Opportunity</TableHead>
                      <TableHead>Deal</TableHead>
                      <TableHead>Next Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conversations.map((row) => (
                      <TableRow key={row.contact.id}>
                        <TableCell>
                          <Link
                            href={`/dashboard/outreach/inbox/${row.contact.id}`}
                            className="font-medium text-foreground transition-colors hover:text-primary"
                          >
                            {row.contact.firstName} {row.contact.lastName ?? ""}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {row.company ? (
                            <Link
                              href={`/dashboard/companies/${row.company.id}`}
                              className="text-sm text-foreground transition-colors hover:text-primary"
                            >
                              {row.company.name}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">No company on file</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {row.lastEmailAt ? row.lastEmailAt.toLocaleString() : "—"}
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
                            <span className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium text-foreground">
                              {row.intent}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.opportunity ? (
                            <Link
                              href={`/dashboard/opportunities/${row.opportunity.id}`}
                              className="text-sm text-foreground transition-colors hover:text-primary"
                            >
                              {row.opportunity.title}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">None yet</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.deal ? (
                            <Link
                              href={`/dashboard/crm/deals/${row.deal.id}`}
                              className="text-sm text-foreground transition-colors hover:text-primary"
                            >
                              {row.deal.name}
                              {row.deal.value !== null && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  ({formatOrgCurrency(row.deal.value, currency)})
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
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </Container>
    </main>
  );
}
