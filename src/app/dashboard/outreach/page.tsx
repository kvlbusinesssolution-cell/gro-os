import Link from "next/link";
import { Inbox, Megaphone, Users } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../_lib/require-membership";
import { getOutreachDashboardStats } from "@/lib/outreach/campaign-analytics";
import { getKvlOutreachSummary } from "@/lib/business-development/kvl-sector-discovery-job";
import { OutreachStatsStrip } from "./_components/outreach-stats-strip";
import { KvlOutreachSummaryCard } from "./_components/kvl-outreach-summary";
import { CampaignForm } from "./_components/campaign-form";
import { OutreachExportMenu } from "./_components/outreach-export-menu";

const CAMPAIGN_STATUS_VARIANT: Record<string, "outline" | "accent" | "default" | "secondary"> = {
  DRAFT: "outline",
  ACTIVE: "default",
  PAUSED: "secondary",
  COMPLETED: "accent",
  ARCHIVED: "outline",
};

export default async function OutreachPage() {
  const { membership } = await requireActiveMembership("/dashboard/outreach");

  const [stats, campaigns, kvlSummary] = await Promise.all([
    getOutreachDashboardStats(membership.organizationId),
    prisma.campaign.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: { createdAt: "desc" },
      take: 24,
      include: { _count: { select: { contacts: true, emailDrafts: true } } },
    }),
    getKvlOutreachSummary(membership.organizationId),
  ]);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
              <Megaphone className="size-6 text-primary" /> Outreach Assistant
            </h1>
            <p className="text-sm text-muted-foreground">
              AI-drafted cold email and LinkedIn outreach — every draft is reviewed through your approval workflow
              before anything real goes out.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/outreach/contacts" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
              <Users className="size-4" /> Contacts
            </Link>
            <Link href="/dashboard/outreach/inbox" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
              <Inbox className="size-4" /> Inbox
            </Link>
            <OutreachExportMenu />
            <CampaignForm />
          </div>
        </div>

        {kvlSummary && <KvlOutreachSummaryCard summary={kvlSummary} />}

        <OutreachStatsStrip stats={stats} />

        {campaigns.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <Megaphone className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">No campaigns yet. Create one to start drafting real outreach.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((campaign) => (
              <Link key={campaign.id} href={`/dashboard/outreach/campaigns/${campaign.id}`}>
                <Card glass className="h-full transition-transform duration-150 hover:-translate-y-0.5">
                  <CardContent className="flex flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-foreground">{campaign.name}</p>
                        <p className="text-xs text-muted-foreground">{campaign.type.replace(/_/g, " ")}</p>
                      </div>
                      <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status]}>{campaign.status}</Badge>
                    </div>
                    <div className="flex items-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
                      <span>{campaign._count.contacts} contacts</span>
                      <span>{campaign._count.emailDrafts} drafts</span>
                      {campaign.estimatedSuccessPotential != null && <span>{campaign.estimatedSuccessPotential}% potential</span>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Container>
    </main>
  );
}
