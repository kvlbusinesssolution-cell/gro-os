import Link from "next/link";
import { Handshake, RotateCcw, Users } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { formatCurrency } from "@/app/dashboard/_lib/format";
import {
  aggregateReferralPartnerStats,
  formatCommissionRate,
  PARTNER_STATUS_BADGE_CLASSNAME,
  PARTNER_STATUS_LABEL,
  PARTNER_STATUS_OPTIONS,
  PARTNER_TYPE_OPTIONS,
  partnerTypeLabel,
} from "./_lib/referral-partner-display";
import { ActivatePartnerButton } from "./_components/activate-partner-button";
import { AddPartnerDialog } from "./_components/add-partner-dialog";
import type { PartnerType, Prisma, ReferralPartnerStatus } from "@/generated/prisma/client";

function isPartnerStatus(value: string | undefined): value is ReferralPartnerStatus {
  return !!value && (PARTNER_STATUS_OPTIONS as readonly string[]).includes(value);
}

function isPartnerType(value: string | undefined): value is PartnerType {
  return !!value && (PARTNER_TYPE_OPTIONS as readonly string[]).includes(value);
}

interface ReferralPartnersPageSearchParams {
  status?: string;
  type?: string;
}

export default async function ReferralPartnersPage({
  searchParams,
}: {
  searchParams: Promise<ReferralPartnersPageSearchParams>;
}) {
  const params = await searchParams;
  const { membership } = await requireActiveMembership("/dashboard/referral-partners");
  const organizationId = membership.organizationId;
  const canManage = membership.role === "OWNER" || membership.role === "ADMIN";

  const statusFilter = isPartnerStatus(params.status) ? params.status : undefined;
  const typeFilter = isPartnerType(params.type) ? params.type : undefined;

  const where: Prisma.ReferralPartnerWhereInput = {
    organizationId,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(typeFilter ? { type: typeFilter } : {}),
  };

  const [partners, statusCounts] = await Promise.all([
    prisma.referralPartner.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        // The real "Partner -> Referral -> Lead -> Deal" attribution chain
        // (see ReferralPartner's schema doc): every Company this partner
        // referred, each carrying its own real leads/deals so the
        // aggregate below never fabricates a number.
        referredCompanies: {
          select: {
            id: true,
            leads: { select: { id: true } },
            deals: { select: { value: true } },
          },
        },
        commissions: { select: { amount: true, status: true } },
      },
    }),
    Promise.all(
      PARTNER_STATUS_OPTIONS.map(async (status) => ({
        status,
        count: await prisma.referralPartner.count({ where: { organizationId, status } }),
      })),
    ),
  ]);

  const rows = partners.map((partner) => ({
    partner,
    stats: aggregateReferralPartnerStats({ companies: partner.referredCompanies, commissions: partner.commissions }),
  }));

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Referral Partners</h1>
            <p className="text-sm text-muted-foreground">
              Freelancers, agencies, and consultants who refer companies into your CRM — the Partner Portal for
              Phase 8&apos;s Partner &amp; Referral Client Acquisition Engine. Every stat below is computed from real
              referred Companies, Leads, Deals, and PartnerCommission rows — nothing here is estimated.
            </p>
          </div>
          {canManage && <AddPartnerDialog />}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {statusCounts.map(({ status, count }) => (
            <Link
              key={status}
              href={statusFilter === status ? "/dashboard/referral-partners" : `/dashboard/referral-partners?status=${status}`}
              className={`glass-panel flex flex-col gap-1.5 rounded-xl p-3.5 transition-colors ${
                statusFilter === status ? "ring-2 ring-primary" : ""
              }`}
            >
              <span className="text-[11px] text-muted-foreground">{PARTNER_STATUS_LABEL[status]}</span>
              <span className="text-xl font-semibold tracking-tight text-foreground">
                <AnimatedCounter value={count} />
              </span>
            </Link>
          ))}
        </div>

        <Card glass>
          <CardContent className="p-4">
            <form className="flex flex-wrap items-end gap-3" action="/dashboard/referral-partners" method="GET">
              <div className="flex flex-col gap-1">
                <label htmlFor="status" className="text-xs text-muted-foreground">
                  Status
                </label>
                <Select id="status" name="status" defaultValue={statusFilter ?? ""} className="w-44">
                  <option value="">All statuses</option>
                  {PARTNER_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {PARTNER_STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="type" className="text-xs text-muted-foreground">
                  Type
                </label>
                <Select id="type" name="type" defaultValue={typeFilter ?? ""} className="w-56">
                  <option value="">All types</option>
                  {PARTNER_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {partnerTypeLabel(t)}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="submit"
                className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Apply filters
              </button>
              <Link
                href="/dashboard/referral-partners"
                className="flex h-11 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="size-3.5" /> Reset
              </Link>
            </form>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <Users className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                No referral partners match these filters. Partners are added manually or surfaced as CANDIDATE rows
                by the AI Partner Discovery job — widen the filters above, or add one first.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card glass>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead className="text-right">Companies</TableHead>
                    <TableHead className="text-right">Deals</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead className="text-right">Pending payout</TableHead>
                    <TableHead className="text-right">Paid payout</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ partner, stats }) => (
                    <TableRow key={partner.id}>
                      <TableCell>
                        <Link href={`/dashboard/referral-partners/${partner.id}`} className="font-medium text-foreground hover:underline">
                          {partner.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{partner.email || partner.website || "No contact on file"}</p>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{partnerTypeLabel(partner.type)}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${PARTNER_STATUS_BADGE_CLASSNAME[partner.status]}`}
                        >
                          {PARTNER_STATUS_LABEL[partner.status]}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatCommissionRate(partner.commissionRatePercent)}</TableCell>
                      <TableCell className="text-right text-foreground">{stats.companiesReferred}</TableCell>
                      <TableCell className="text-right text-foreground">{stats.dealsCount}</TableCell>
                      <TableCell className="text-right text-foreground">{formatCurrency(stats.revenue)}</TableCell>
                      <TableCell className="text-right text-foreground">{formatCurrency(stats.commissionTotal)}</TableCell>
                      <TableCell className="text-right text-amber-600 dark:text-amber-400">{formatCurrency(stats.pendingPayout)}</TableCell>
                      <TableCell className="text-right text-emerald-600 dark:text-emerald-400">{formatCurrency(stats.paidPayout)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {canManage && partner.status === "CANDIDATE" && <ActivatePartnerButton partnerId={partner.id} />}
                          <Link
                            href={`/dashboard/referral-partners/${partner.id}`}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Handshake className="size-3.5" /> View
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </Container>
    </main>
  );
}
