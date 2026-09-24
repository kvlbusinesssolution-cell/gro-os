import { Coins, TrendingDown, TrendingUp, Wallet, Gift, Ban, Bot } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requirePlatformOwner } from "@/lib/billing/platform-admin";
import { formatRelativeTime } from "@/lib/utils";
import type { GrowthTokenAction, GrowthTokenEventStatus, GrowthTokenPurchaseStatus } from "@/generated/prisma/client";
import { AdjustTokensDialog } from "./_components/adjust-tokens-dialog";

const ACTION_LABEL: Record<GrowthTokenAction, string> = {
  LISTING_PUBLISH: "Listing published",
  DEAL_POST: "Deal posted",
  LISTING_FEATURE: "Listing featured",
  CATALOG_ITEM_PUBLISH: "Catalog item published",
  LANDING_PAGE_PUBLISH: "Landing page published",
  REPUTATION_CERTIFICATE_DOWNLOAD: "Reputation certificate downloaded",
  AD_PLACEMENT_PURCHASE: "Ad placement purchased",
  MICROSITE_PUBLISH: "Microsite published",
  AI_API_USAGE: "Real AI usage (metered)",
  SIGNUP_BONUS: "Signup welcome bonus",
  MANUAL_ADJUSTMENT: "Manual admin adjustment",
};

const EVENT_STATUS_VARIANT: Record<GrowthTokenEventStatus, "default" | "secondary" | "outline"> = {
  SUCCESS: "default",
  BLOCKED: "outline",
};

const PURCHASE_STATUS_VARIANT: Record<GrowthTokenPurchaseStatus, "default" | "secondary" | "outline"> = {
  PAID: "default",
  PENDING: "secondary",
  FAILED: "outline",
  REFUNDED: "outline",
};

function formatTokens(n: number): string {
  return Math.round(n).toLocaleString();
}

function formatInr(amountCents: number): string {
  return `₹${(amountCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Platform-wide Growth Token management — the piece that was missing from
 * Admin (every organization's own balance was only ever visible to that
 * organization itself, via the topbar badge/dashboard billing page). Real
 * cross-tenant view: every org's balance, the platform's real token revenue
 * and consumption breakdown, and a manual grant/deduct tool for support
 * cases a real spend/purchase/signup-bonus flow can't cover.
 */
export default async function AdminGrowthTokensPage() {
  await requirePlatformOwner("/admin/growth-tokens");

  const [accounts, purchaseAgg, spendByAction, blockedCount, recentPurchases, recentEvents] = await Promise.all([
    prisma.billingAccount.findMany({
      where: { organization: { isOwnerOrg: false } },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        currentPlan: { select: { name: true, growthTokensMonthly: true } },
        growthTokenLedger: true,
      },
      orderBy: { organization: { name: "asc" } },
      take: 250,
    }),
    prisma.growthTokenPurchase.aggregate({
      where: { status: "PAID" },
      _sum: { amountCents: true, tokens: true, bonusTokens: true },
      _count: true,
    }),
    prisma.growthTokenUsageEvent.groupBy({
      by: ["action"],
      where: { status: "SUCCESS" },
      _sum: { tokensUsed: true },
      _count: true,
    }),
    prisma.growthTokenUsageEvent.count({ where: { status: "BLOCKED" } }),
    prisma.growthTokenPurchase.findMany({
      include: { organization: { select: { name: true } }, buyerUser: { select: { email: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.growthTokenUsageEvent.findMany({
      include: { organization: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const spendMap = new Map(spendByAction.map((row) => [row.action, { tokens: row._sum.tokensUsed ?? 0, count: row._count }]));
  const featureActionKeys: GrowthTokenAction[] = [
    "LISTING_PUBLISH",
    "DEAL_POST",
    "LISTING_FEATURE",
    "CATALOG_ITEM_PUBLISH",
    "LANDING_PAGE_PUBLISH",
    "REPUTATION_CERTIFICATE_DOWNLOAD",
    "AD_PLACEMENT_PURCHASE",
    "MICROSITE_PUBLISH",
  ];
  const featureTokensSpent = featureActionKeys.reduce((sum, key) => sum + (spendMap.get(key)?.tokens ?? 0), 0);
  const aiTokensRecovered = spendMap.get("AI_API_USAGE")?.tokens ?? 0;
  const signupBonusTokensGranted = -(spendMap.get("SIGNUP_BONUS")?.tokens ?? 0); // stored negative (a credit)
  const manualAdjustmentNet = spendMap.get("MANUAL_ADJUSTMENT")?.tokens ?? 0; // positive = net deducted, negative = net granted

  const rows = accounts.map((account) => {
    const ledger = account.growthTokenLedger;
    const unlimited = account.currentPlan ? account.currentPlan.growthTokensMonthly === null : false;
    const monthlyGranted = ledger?.monthlyTokensGranted ?? 0;
    const monthlyUsed = ledger?.monthlyTokensUsed ?? 0;
    const remainingMonthly = Math.max(0, monthlyGranted - monthlyUsed);
    const purchasedRemaining = ledger?.purchasedTokensRemaining ?? 0;
    return {
      organizationId: account.organization.id,
      organizationName: account.organization.name,
      planName: account.currentPlan?.name ?? "No plan",
      unlimited,
      monthlyGranted,
      monthlyUsed,
      purchasedRemaining,
      totalRemaining: unlimited ? Infinity : remainingMonthly + purchasedRemaining,
    };
  });

  const totalOutstandingTokens = rows.reduce((sum, row) => (row.unlimited ? sum : sum + row.totalRemaining), 0);

  return (
    <Container className="flex flex-col gap-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Growth Token Management</h1>
        <p className="text-sm text-muted-foreground">
          Real, cross-tenant view of the Growth Token economy — {rows.length} organization{rows.length === 1 ? "" : "s"} with a
          billing account, backed by real GrowthTokenLedger/GrowthTokenUsageEvent/GrowthTokenPurchase rows.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card glass>
          <CardContent className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Wallet className="size-3.5" /> Tokens outstanding
            </div>
            <p className="text-2xl font-semibold text-foreground">{formatTokens(totalOutstandingTokens)}</p>
            <p className="text-xs text-muted-foreground">Real balance across every non-owner organization right now.</p>
          </CardContent>
        </Card>
        <Card glass>
          <CardContent className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="size-3.5" /> Real ₹ collected
            </div>
            <p className="text-2xl font-semibold text-foreground">{formatInr(purchaseAgg._sum.amountCents ?? 0)}</p>
            <p className="text-xs text-muted-foreground">
              {purchaseAgg._count} paid purchase{purchaseAgg._count === 1 ? "" : "s"} · {formatTokens((purchaseAgg._sum.tokens ?? 0) + (purchaseAgg._sum.bonusTokens ?? 0))} tokens sold (incl. 20% bonus)
            </p>
          </CardContent>
        </Card>
        <Card glass>
          <CardContent className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <TrendingDown className="size-3.5" /> Feature tokens spent
            </div>
            <p className="text-2xl font-semibold text-foreground">{formatTokens(featureTokensSpent)}</p>
            <p className="text-xs text-muted-foreground">Listings, deals, catalog items, microsites, etc. — flat-fee actions.</p>
          </CardContent>
        </Card>
        <Card glass>
          <CardContent className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Bot className="size-3.5" /> AI-cost tokens recovered
            </div>
            <p className="text-2xl font-semibold text-foreground">{formatTokens(aiTokensRecovered)}</p>
            <p className="text-xs text-muted-foreground">Real metered AI spend, recovered via the ₹ x1.8 x4 tokens/₹1 formula.</p>
          </CardContent>
        </Card>
        <Card glass>
          <CardContent className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Gift className="size-3.5" /> Signup bonuses granted
            </div>
            <p className="text-2xl font-semibold text-foreground">{formatTokens(signupBonusTokensGranted)}</p>
            <p className="text-xs text-muted-foreground">300 tokens x every real first-time signup.</p>
          </CardContent>
        </Card>
        <Card glass>
          <CardContent className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Coins className="size-3.5" /> Manual adjustments (net)
            </div>
            <p className="text-2xl font-semibold text-foreground">
              {manualAdjustmentNet > 0 ? "−" : manualAdjustmentNet < 0 ? "+" : ""}
              {formatTokens(Math.abs(manualAdjustmentNet))}
            </p>
            <p className="text-xs text-muted-foreground">Net effect of every admin-initiated grant/deduct, all-time.</p>
          </CardContent>
        </Card>
        <Card glass>
          <CardContent className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Ban className="size-3.5" /> Blocked spend attempts
            </div>
            <p className="text-2xl font-semibold text-foreground">{blockedCount}</p>
            <p className="text-xs text-muted-foreground">Real attempts refused for insufficient balance — a real upsell signal.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organizations</CardTitle>
          <CardDescription>Every non-owner organization with a billing account. Sorted alphabetically.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No organizations yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Monthly (used/granted)</TableHead>
                  <TableHead>Purchased remaining</TableHead>
                  <TableHead>Total remaining</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.organizationId}>
                    <TableCell className="font-medium text-foreground">{row.organizationName}</TableCell>
                    <TableCell>{row.planName}</TableCell>
                    <TableCell>
                      {row.unlimited ? <Badge variant="secondary">Unlimited</Badge> : `${formatTokens(row.monthlyUsed)} / ${formatTokens(row.monthlyGranted)}`}
                    </TableCell>
                    <TableCell>{formatTokens(row.purchasedRemaining)}</TableCell>
                    <TableCell className="font-medium text-foreground">{row.unlimited ? "Unlimited" : formatTokens(row.totalRemaining)}</TableCell>
                    <TableCell>
                      <AdjustTokensDialog organizationId={row.organizationId} organizationName={row.organizationName} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent token purchases</CardTitle>
            <CardDescription>Most recent 20, real gateway-confirmed or manual purchases.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentPurchases.length === 0 ? (
              <p className="text-sm text-muted-foreground">No purchases yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentPurchases.map((purchase) => (
                    <TableRow key={purchase.id}>
                      <TableCell>{purchase.organization.name}</TableCell>
                      <TableCell>
                        {formatTokens(purchase.tokens)}
                        {purchase.bonusTokens > 0 && <span className="text-muted-foreground"> +{formatTokens(purchase.bonusTokens)} bonus</span>}
                      </TableCell>
                      <TableCell>{formatInr(purchase.amountCents)}</TableCell>
                      <TableCell>
                        <Badge variant={PURCHASE_STATUS_VARIANT[purchase.status]}>{purchase.status}</Badge>
                      </TableCell>
                      <TableCell>{formatRelativeTime(purchase.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent token activity</CardTitle>
            <CardDescription>Most recent 30 events across every organization — spends, bonuses, and admin adjustments.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentEvents.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>{event.organization.name}</TableCell>
                      <TableCell>{ACTION_LABEL[event.action]}</TableCell>
                      <TableCell className={event.tokensUsed < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}>
                        {event.tokensUsed < 0 ? "+" : "−"}
                        {formatTokens(Math.abs(event.tokensUsed))}
                      </TableCell>
                      <TableCell>
                        <Badge variant={EVENT_STATUS_VARIANT[event.status]}>{event.status}</Badge>
                      </TableCell>
                      <TableCell>{formatRelativeTime(event.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
