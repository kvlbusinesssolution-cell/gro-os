import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Globe, Mail, Receipt } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/app/dashboard/_lib/format";
import { requireActiveMembership } from "@/app/dashboard/_lib/require-membership";
import {
  aggregateReferralPartnerStats,
  formatCommissionRate,
  PARTNER_STATUS_BADGE_CLASSNAME,
  PARTNER_STATUS_LABEL,
  partnerTypeLabel,
} from "../_lib/referral-partner-display";
import { ActivatePartnerButton } from "../_components/activate-partner-button";
import { MarkCommissionPaidButton } from "../_components/mark-commission-paid-button";

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function ReferralPartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/referral-partners/${id}`);
  const canManage = membership.role === "OWNER" || membership.role === "ADMIN";

  const partner = await prisma.referralPartner.findUnique({
    where: { id },
    include: {
      // Real "Partner -> Referral -> Lead -> Qualification -> Opportunity ->
      // Deal" chain (see ReferralPartner's schema doc comment) — every
      // referred Company, each carrying its own real leads/deals so nothing
      // below is estimated.
      referredCompanies: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          industry: true,
          status: true,
          leads: { select: { id: true } },
          deals: {
            orderBy: { createdAt: "desc" },
            select: { id: true, name: true, value: true, dealStage: { select: { name: true } } },
          },
        },
      },
      commissions: {
        orderBy: { createdAt: "desc" },
        include: { deal: { select: { id: true, name: true } } },
      },
    },
  });

  if (!partner || partner.organizationId !== membership.organizationId) {
    notFound();
  }

  const stats = aggregateReferralPartnerStats({ companies: partner.referredCompanies, commissions: partner.commissions });
  const deals = partner.referredCompanies.flatMap((company) =>
    company.deals.map((deal) => ({ ...deal, companyId: company.id, companyName: company.name })),
  );

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <Link
            href="/dashboard/referral-partners"
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to Referral Partners
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{partner.name}</h1>
              <p className="text-sm text-muted-foreground">
                {partnerTypeLabel(partner.type)} · {formatCommissionRate(partner.commissionRatePercent)} commission rate
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${PARTNER_STATUS_BADGE_CLASSNAME[partner.status]}`}
              >
                {PARTNER_STATUS_LABEL[partner.status]}
              </span>
              {canManage && partner.status === "CANDIDATE" && <ActivatePartnerButton partnerId={partner.id} />}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {[
            { label: "Companies referred", value: String(stats.companiesReferred) },
            { label: "Leads referred", value: String(stats.leadsReferred) },
            { label: "Deals", value: String(stats.dealsCount) },
            { label: "Revenue", value: formatCurrency(stats.revenue) },
            { label: "Commission", value: formatCurrency(stats.commissionTotal) },
            { label: "Pending payout", value: formatCurrency(stats.pendingPayout) },
            { label: "Paid payout", value: formatCurrency(stats.paidPayout) },
          ].map((tile) => (
            <div key={tile.label} className="glass-panel flex flex-col gap-1.5 rounded-xl p-3.5">
              <span className="text-[11px] text-muted-foreground">{tile.label}</span>
              <span className="text-lg font-semibold tracking-tight text-foreground">{tile.value}</span>
            </div>
          ))}
        </div>

        <Card glass>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-2 text-sm">
              <Mail className="size-4 text-muted-foreground" />
              <span className="text-foreground">{partner.email || "No email on file"}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Globe className="size-4 text-muted-foreground" />
              {partner.website ? (
                <a href={partner.website} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  {partner.website}
                </a>
              ) : (
                <span className="text-foreground">No website on file</span>
              )}
            </div>
            {partner.notes && (
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm text-foreground">{partner.notes}</p>
              </div>
            )}
            {partner.discoverySource && (
              <div className="sm:col-span-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  AI Partner Discovery evidence: {partner.discoverySource}
                  {partner.discoveryUrl && (
                    <>
                      {" "}
                      —{" "}
                      <a href={partner.discoveryUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        source
                      </a>
                    </>
                  )}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card glass>
          <CardHeader>
            <CardTitle>Referred Companies ({stats.companiesReferred})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {partner.referredCompanies.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No companies attributed to this partner yet — attribution is set via Company.referralPartnerId,
                either manually on the company record or by the AI Partner Discovery job.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Deals</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partner.referredCompanies.map((company) => (
                    <TableRow key={company.id}>
                      <TableCell>
                        <Link href={`/dashboard/companies/${company.id}`} className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline">
                          <Building2 className="size-3.5 text-muted-foreground" /> {company.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{company.industry || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{company.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-foreground">{company.leads.length}</TableCell>
                      <TableCell className="text-right text-foreground">{company.deals.length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card glass>
          <CardHeader>
            <CardTitle>Deals ({deals.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {deals.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No deals under this partner&apos;s referred companies yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deals.map((deal) => (
                    <TableRow key={deal.id}>
                      <TableCell className="font-medium text-foreground">{deal.name}</TableCell>
                      <TableCell>
                        <Link href={`/dashboard/companies/${deal.companyId}`} className="text-muted-foreground hover:underline">
                          {deal.companyName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={deal.dealStage.name === "Won" ? "accent" : "outline"}>{deal.dealStage.name}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-foreground">
                        {deal.value != null ? formatCurrency(deal.value) : "Value not set"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card glass>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="size-4" /> Commissions ({partner.commissions.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {partner.commissions.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No commissions yet — a PartnerCommission row is generated automatically when a deal under this
                partner&apos;s referred companies reaches the &quot;Won&quot; stage while the partner is ACTIVE.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Paid</TableHead>
                    {canManage && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partner.commissions.map((commission) => (
                    <TableRow key={commission.id}>
                      <TableCell>
                        <Link href={`/dashboard/crm/deals/${commission.dealId}`} className="text-foreground hover:underline">
                          {commission.deal.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right text-foreground">{formatCurrency(commission.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={commission.status === "PAID" ? "accent" : "outline"}>{commission.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(commission.createdAt)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(commission.paidAt)}</TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          {commission.status === "PENDING" && <MarkCommissionPaidButton commissionId={commission.id} />}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
