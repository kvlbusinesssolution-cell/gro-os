import { Gauge, Building2, ShieldCheck, Flame, Rocket, Mail, MessageSquare, CalendarCheck, FileText, Trophy, Wallet, HelpCircle } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { requireActiveMembership } from "../_lib/require-membership";
import { computeRevenueCommandCenterToday, computeRevenueCommandCenterFunnel } from "@/lib/business-development/revenue-command-center";

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
] as const;

export default async function RevenueCommandCenterPage() {
  const { membership } = await requireActiveMembership("/dashboard/revenue-command-center");
  const organizationId = membership.organizationId;

  const [today, funnel] = await Promise.all([
    computeRevenueCommandCenterToday(organizationId),
    computeRevenueCommandCenterFunnel(organizationId),
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
            {TODAY_TILES.map(({ key, label, icon: Icon }) => (
              <Card key={key} glass>
                <CardContent className="flex flex-col gap-1.5 p-4">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Icon className="size-3.5" /> {label}
                  </span>
                  <span className="text-2xl font-semibold tracking-tight text-foreground">
                    <AnimatedCounter value={today[key]} />
                  </span>
                </CardContent>
              </Card>
            ))}
            <Card glass>
              <CardContent className="flex flex-col gap-1.5 p-4">
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Wallet className="size-3.5" /> Open Pipeline Value
                </span>
                <span className="text-2xl font-semibold tracking-tight text-foreground">{formatCurrency(today.pipelineValue)}</span>
                <span className="text-[11px] text-muted-foreground">
                  {today.pipelineDealCount} open deal{today.pipelineDealCount === 1 ? "" : "s"} sourced from this pipeline — a running
                  total, not a today-only figure.
                </span>
              </CardContent>
            </Card>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <HelpCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong className="text-foreground">Qualified</strong> = has at least one AI-detected Opportunity.{" "}
              <strong className="text-foreground">Ready for Outreach</strong> = qualified AND has a public Decision Maker identified
              (the two real preconditions the one-click &quot;Convert to Outreach&quot; action needs).{" "}
              <strong className="text-foreground">Won</strong> = deals currently in the Won stage last updated today — a best-effort
              proxy, not an exact &quot;moved to Won today&quot; count.
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
      </Container>
    </main>
  );
}
