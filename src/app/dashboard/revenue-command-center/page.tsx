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
  GitBranch,
  ShieldQuestion,
  Lightbulb,
  MessageCircle,
  Phone,
  Handshake,
  XCircle,
} from "lucide-react";
import { LinkedInIcon } from "@/components/icons/oauth-icons";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { requireActiveMembership } from "../_lib/require-membership";
import { formatCurrency as formatOrgCurrency } from "../_lib/format";
import {
  computeRevenueCommandCenterToday,
  computeRevenueCommandCenterFunnel,
  emailCenterLinkForTile,
} from "@/lib/business-development/revenue-command-center";
import { getTodaysClientConversations } from "@/lib/business-development/todays-client-conversations";
import {
  getAttributionOverview,
  getFinancialConsistencyCheck,
  getRevenueBySource,
  getRevenueByCampaign,
  getRevenueByAiCampaign,
  getRevenueBySector,
  getRevenueByCountry,
  getRevenueByService,
  getRevenueByDecisionMakerRole,
  getRevenueByOutreachChannel,
  getRevenueByLeadSource,
  getFunnelMetrics,
  getAttributionDataQualityReport,
  listRevenueAttributions,
} from "@/lib/analytics/revenue-attribution";
import { RecomputeAttributionButton } from "./_components/recompute-attribution-button";
import { getLearningInsightsSummary } from "@/lib/learning/queries";
import { getForecastOverview } from "@/lib/forecast/queries";

const TYPE_BADGE: Record<string, "accent" | "secondary" | "outline"> = { DIRECT: "accent", ASSISTED: "secondary", UNKNOWN: "outline" };

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatRate(rate: number | null): string {
  if (rate === null) return "No data yet";
  return `${Math.round(rate * 100)}%`;
}

/** Shared render for the Sector/Country/Service/Decision-Maker-Role/Channel breakdowns — same {label, revenue, deals} shape. */
function DimensionTable({ rows, currency }: { rows: Array<{ label: string; revenue: number; deals: number }>; currency: string | null }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No attributed revenue in this dimension yet.</p>;
  return (
    <Card glass>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Deals</TableHead>
              <TableHead>Revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="font-medium text-foreground">{row.label}</TableCell>
                <TableCell>{row.deals}</TableCell>
                <TableCell className="font-medium text-foreground">{formatOrgCurrency(row.revenue, currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const TODAY_TILES = [
  { key: "companiesFound", label: "Companies Found", icon: Building2 },
  { key: "qualified", label: "Qualified", icon: ShieldCheck },
  { key: "highIntent", label: "High Intent", icon: Flame },
  { key: "readyForOutreach", label: "Ready for Outreach", icon: Rocket },
  { key: "emailsSent", label: "Emails Sent", icon: Mail },
  { key: "whatsappSent", label: "WhatsApp Sent", icon: MessageCircle },
  { key: "linkedinActivity", label: "LinkedIn Activity", icon: LinkedInIcon },
  { key: "calls", label: "Calls", icon: Phone },
  { key: "replies", label: "Replies", icon: MessageSquare },
  { key: "interestedReplies", label: "Interested Replies", icon: Flame },
  { key: "meetings", label: "Meetings", icon: CalendarCheck },
  { key: "proposals", label: "Proposals", icon: FileText },
  { key: "negotiations", label: "Negotiations", icon: Handshake },
  { key: "won", label: "Won", icon: Trophy },
  { key: "lost", label: "Lost", icon: XCircle },
  { key: "aiDraftsCreated", label: "AI Drafts", icon: Bot },
  { key: "humanDraftsCreated", label: "Human Drafts", icon: PenSquare },
  { key: "pendingApproval", label: "Pending Approval", icon: Clock },
  { key: "delivered", label: "Delivered", icon: CheckCircle2 },
  { key: "failedEmails", label: "Failed", icon: AlertTriangle },
] as const;

export default async function RevenueCommandCenterPage() {
  const { membership } = await requireActiveMembership("/dashboard/revenue-command-center");
  const organizationId = membership.organizationId;

  const [today, funnel, conversations, learningInsights, forecastOverview] = await Promise.all([
    computeRevenueCommandCenterToday(organizationId),
    computeRevenueCommandCenterFunnel(organizationId),
    getTodaysClientConversations(organizationId),
    getLearningInsightsSummary(organizationId),
    getForecastOverview(organizationId),
  ]);
  const currency = membership.organization.currency;

  const [
    attributionOverview,
    financialConsistency,
    revenueBySource,
    revenueByCampaign,
    revenueByAiCampaign,
    revenueBySector,
    revenueByCountry,
    revenueByService,
    revenueByDecisionMakerRole,
    revenueByOutreachChannel,
    revenueByLeadSource,
    attributionFunnel,
    dataQuality,
    attributionRows,
  ] = await Promise.all([
    getAttributionOverview(organizationId),
    getFinancialConsistencyCheck(organizationId),
    getRevenueBySource(organizationId),
    getRevenueByCampaign(organizationId),
    getRevenueByAiCampaign(organizationId),
    getRevenueBySector(organizationId),
    getRevenueByCountry(organizationId),
    getRevenueByService(organizationId),
    getRevenueByDecisionMakerRole(organizationId),
    getRevenueByOutreachChannel(organizationId),
    getRevenueByLeadSource(organizationId),
    getFunnelMetrics(organizationId),
    getAttributionDataQualityReport(organizationId),
    listRevenueAttributions(organizationId),
  ]);

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
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Predictive Revenue</h2>
          <Card glass>
            <CardContent className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Pipeline (ACTUAL)</p>
                <p className="text-xl font-semibold text-foreground">{formatCurrency(forecastOverview.pipelineSnapshot?.predictionValue ?? null)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Weighted Pipeline (PREDICTED)</p>
                <p className="text-xl font-semibold text-foreground">{formatCurrency(forecastOverview.weightedSnapshot?.predictionValue ?? null)}</p>
                {forecastOverview.weightedSnapshot && <p className="text-xs text-muted-foreground">{forecastOverview.weightedSnapshot.confidence} confidence</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">This Month Forecast</p>
                <p className="text-xl font-semibold text-foreground">{formatCurrency(forecastOverview.monthly.forecastTotal)}</p>
                <p className="text-xs text-muted-foreground">{forecastOverview.monthly.rangeAvailable ? `${formatCurrency(forecastOverview.monthly.lowerBound)}–${formatCurrency(forecastOverview.monthly.upperBound)}` : "Range not available"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">High Risk / Stalled Deals</p>
                <p className="text-xl font-semibold text-foreground">
                  {forecastOverview.highRiskDealsCount} / {forecastOverview.stalledCount}
                </p>
              </div>
            </CardContent>
          </Card>
          <Link href="/dashboard/forecast" className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
            <Wallet className="size-3.5" /> Full predictive revenue breakdown →
          </Link>
        </div>

        {learningInsights.length > 0 && (
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Learning Insights</h2>
            <Card glass>
              <CardContent className="flex flex-col gap-2 p-4">
                {learningInsights.map((insight, i) => (
                  <Link key={i} href={insight.href} className="flex items-start gap-2 text-sm text-foreground hover:underline">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-primary" /> {insight.text}
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

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

        {/* ===== Phase 7: Revenue Attribution Engine ===== */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Revenue Attribution — Paid Revenue Only
            </h2>
            <RecomputeAttributionButton />
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Every figure below is real <strong className="text-foreground">paid</strong> revenue
            (Invoice.amountPaid — the same definition Client 360 uses), not deal/pipeline value shown elsewhere on
            this app. {attributionOverview.unattributedInvoiceCount > 0 && (
              <span className="text-amber-500">
                {attributionOverview.unattributedInvoiceCount} paid invoice(s) not yet attributed — click Recompute.
              </span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card glass>
              <CardContent className="flex flex-col gap-1.5 p-4">
                <span className="text-[11px] text-muted-foreground">Total Paid Revenue</span>
                <span className="text-2xl font-semibold tracking-tight text-foreground">
                  {formatOrgCurrency(attributionOverview.totalPaidRevenue, currency)}
                </span>
              </CardContent>
            </Card>
            <Card glass>
              <CardContent className="flex flex-col gap-1.5 p-4">
                <span className="text-[11px] text-muted-foreground">Direct Attributed</span>
                <span className="text-2xl font-semibold tracking-tight text-foreground">
                  {formatOrgCurrency(attributionOverview.directRevenue, currency)}
                </span>
                <span className="text-[11px] text-muted-foreground">{attributionOverview.directCount} invoice(s)</span>
              </CardContent>
            </Card>
            <Card glass>
              <CardContent className="flex flex-col gap-1.5 p-4">
                <span className="text-[11px] text-muted-foreground">Assisted</span>
                <span className="text-2xl font-semibold tracking-tight text-foreground">
                  {formatOrgCurrency(attributionOverview.assistedRevenue, currency)}
                </span>
                <span className="text-[11px] text-muted-foreground">{attributionOverview.assistedCount} invoice(s)</span>
              </CardContent>
            </Card>
            <Card glass>
              <CardContent className="flex flex-col gap-1.5 p-4">
                <span className="text-[11px] text-muted-foreground">Unknown</span>
                <span className="text-2xl font-semibold tracking-tight text-foreground">
                  {formatOrgCurrency(attributionOverview.unknownRevenue, currency)}
                </span>
                <span className="text-[11px] text-muted-foreground">{attributionOverview.unknownCount} invoice(s)</span>
              </CardContent>
            </Card>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {financialConsistency.explanation}
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Funnel &amp; Conversion Rates</h2>
          <Card glass>
            <CardContent className="flex flex-col gap-4 p-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                {attributionFunnel.stages.map((s) => (
                  <div key={s.stage}>
                    <p className="text-xs text-muted-foreground">{s.stage}</p>
                    <p className="text-lg font-semibold text-foreground">{s.count}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {attributionFunnel.conversions.map((c) => (
                  <div key={`${c.from}-${c.to}`} className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">
                      {c.from} → {c.to}
                    </p>
                    <p className="text-lg font-semibold text-foreground">
                      {c.rate === null ? "NOT AVAILABLE" : `${Math.round(c.rate * 100)}%`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {c.numerator} / {c.denominator}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue by Source</h2>
          <Card glass>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Companies</TableHead>
                    <TableHead>Contacted</TableHead>
                    <TableHead>Replies</TableHead>
                    <TableHead>Meetings</TableHead>
                    <TableHead>Deals</TableHead>
                    <TableHead>Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revenueBySource.map((row) => (
                    <TableRow key={row.source}>
                      <TableCell className="font-medium text-foreground">{row.source}</TableCell>
                      <TableCell>{row.companies}</TableCell>
                      <TableCell>{row.contacted}</TableCell>
                      <TableCell>{row.replies}</TableCell>
                      <TableCell>{row.meetings}</TableCell>
                      <TableCell>{row.deals}</TableCell>
                      <TableCell className="font-medium text-foreground">{formatOrgCurrency(row.revenue, currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue by Lead Source</h2>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Scoped to revenue whose Deal was converted from a real Lead-pipeline record — a smaller, distinct set from
            Revenue by Source above (§14).
          </p>
          {revenueByLeadSource.length === 0 ? (
            <p className="text-xs text-muted-foreground">No real Lead-pipeline-originated revenue yet.</p>
          ) : (
            <Card glass>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lead Source</TableHead>
                      <TableHead>Deals</TableHead>
                      <TableHead>Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueByLeadSource.map((row) => (
                      <TableRow key={row.source}>
                        <TableCell className="font-medium text-foreground">{row.source}</TableCell>
                        <TableCell>{row.deals}</TableCell>
                        <TableCell className="font-medium text-foreground">{formatOrgCurrency(row.revenue, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue by Campaign</h2>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Only campaigns with a proven Send+Reply engagement chain to this revenue appear — never a campaign
            credited merely for audience enrollment (§13).
          </p>
          {revenueByCampaign.length === 0 ? (
            <p className="text-xs text-muted-foreground">No campaign has a proven attribution link to paid revenue yet.</p>
          ) : (
            <Card glass>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>AI Campaign</TableHead>
                      <TableHead>Direct</TableHead>
                      <TableHead>Assisted</TableHead>
                      <TableHead>Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueByCampaign.map((row) => (
                      <TableRow key={row.campaignId}>
                        <TableCell className="font-medium text-foreground">{row.campaignName}</TableCell>
                        <TableCell>{row.isAiCampaign ? <Badge variant="accent">AI</Badge> : "—"}</TableCell>
                        <TableCell>{row.direct}</TableCell>
                        <TableCell>{row.assisted}</TableCell>
                        <TableCell className="font-medium text-foreground">{formatOrgCurrency(row.revenue, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue by AI Campaign</h2>
          {revenueByAiCampaign.length === 0 ? (
            <p className="text-xs text-muted-foreground">No AI-run campaign (approvalMode: AUTOMATIC) has a proven attribution link yet.</p>
          ) : (
            <Card glass>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Direct</TableHead>
                      <TableHead>Assisted</TableHead>
                      <TableHead>Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueByAiCampaign.map((row) => (
                      <TableRow key={row.campaignId}>
                        <TableCell className="font-medium text-foreground">{row.campaignName}</TableCell>
                        <TableCell>{row.direct}</TableCell>
                        <TableCell>{row.assisted}</TableCell>
                        <TableCell className="font-medium text-foreground">{formatOrgCurrency(row.revenue, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue by Sector</h2>
            <DimensionTable rows={revenueBySector} currency={currency} />
          </div>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue by Country</h2>
            <DimensionTable rows={revenueByCountry} currency={currency} />
          </div>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue by Service</h2>
            <DimensionTable rows={revenueByService} currency={currency} />
          </div>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue by Decision Maker Role</h2>
            <DimensionTable rows={revenueByDecisionMakerRole} currency={currency} />
          </div>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue by Outreach Channel</h2>
            <DimensionTable rows={revenueByOutreachChannel} currency={currency} />
          </div>
          <div>
            <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldQuestion className="size-3.5" /> Attribution Data Quality
            </h2>
            <Card glass>
              <CardContent className="flex flex-col gap-1.5 p-4 text-xs text-muted-foreground">
                <p>Orphan paid invoices (no deal): <span className="text-foreground">{dataQuality.orphanInvoicesNoDeal}</span></p>
                <p>Orphan paid invoices (no company at all): <span className="text-foreground">{dataQuality.orphanInvoicesNoCompany}</span></p>
                <p>Won deals with no company: <span className="text-foreground">{dataQuality.orphanDealsNoCompany}</span></p>
                <p>Accepted proposals not linked to a deal: <span className="text-foreground">{dataQuality.proposalsNotLinkedToDeal}</span></p>
                <p>CRM opportunities whose company has zero deals: <span className="text-foreground">{dataQuality.opportunitiesWithNoDealAtAllForCompany}</span></p>
              </CardContent>
            </Card>
          </div>
        </div>

        <div>
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <GitBranch className="size-3.5" /> Attribution Table — click Invoice to trace the full chain
          </h2>
          {attributionRows.length === 0 ? (
            <Card glass>
              <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
                <GitBranch className="size-8 text-muted-foreground" strokeWidth={1.5} />
                <p className="text-sm text-muted-foreground">
                  No attribution computed yet — click &quot;Recompute Attribution&quot; above once a real invoice has
                  been paid.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card glass>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Revenue</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Deal</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Attribution</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attributionRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium text-foreground">{formatOrgCurrency(row.revenue, currency)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.source ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.campaignName ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.companyName ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{row.dealName ?? "—"}</TableCell>
                        <TableCell>
                          <Link href={`/dashboard/revenue-command-center/attribution/${row.invoiceId}`} className="text-sm text-primary hover:underline">
                            {row.invoiceNumber}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant={TYPE_BADGE[row.attributionType]}>{row.attributionType}</Badge>
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
