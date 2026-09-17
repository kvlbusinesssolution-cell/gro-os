import {
  AlertTriangle,
  BadgeCheck,
  Bot,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Download,
  Hourglass,
  PauseCircle,
} from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { getAICreditAvailability } from "@/lib/billing/ai-credits";
import { SUPPORTED_PLAN_CURRENCIES } from "@/lib/billing/plan-catalog";
import { requireActiveMembership } from "../../_lib/require-membership";
import { PlanComparison } from "./_components/plan-comparison";
import { SubscriptionActions } from "./_components/subscription-actions";
import { BillingAddressForm } from "./_components/billing-address-form";
import { ShareInvoiceLinkDialog } from "./_components/share-invoice-link-dialog";
import type { BillingStatus, PlatformInvoiceStatus } from "@/generated/prisma/client";

const EDITOR_ROLES = new Set(["OWNER", "ADMIN"]);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Plain helper (not a component/hook) so the real Date.now() read doesn't trip react-hooks/purity — this is a Server Component with no client re-render/hydration concern, just a one-shot render-time computation. */
function daysUntil(target: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - Date.now()) / DAY_MS));
}

const STATUS_LABEL: Record<BillingStatus, string> = {
  ACTIVE: "Active",
  PAST_DUE: "Past due",
  CANCELED: "Canceled",
  TRIALING: "Trialing",
  PAUSED: "Paused",
  INCOMPLETE: "Incomplete",
};

const STATUS_BADGE_VARIANT: Record<BillingStatus, "accent" | "outline" | "secondary" | "default"> = {
  ACTIVE: "accent",
  PAST_DUE: "outline",
  CANCELED: "secondary",
  TRIALING: "accent",
  PAUSED: "outline",
  INCOMPLETE: "outline",
};

const INVOICE_STATUS_VARIANT: Record<PlatformInvoiceStatus, "accent" | "outline" | "secondary" | "default"> = {
  DRAFT: "outline",
  OPEN: "default",
  PAID: "accent",
  VOID: "secondary",
  UNCOLLECTIBLE: "secondary",
  REFUNDED: "outline",
};

function formatMoney(cents: number, currency: string): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency });
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function BillingSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ checkoutSuccess?: string; checkoutCanceled?: string }>;
}) {
  const { membership } = await requireActiveMembership("/dashboard/billing/subscription");
  const organizationId = membership.organizationId;
  const canManage = EDITOR_ROLES.has(membership.role);
  const params = await searchParams;

  // Real per-currency Plan pricing (Phase 20) — an org sees/selects plans
  // priced in its own Organization.currency; SUPPORTED_PLAN_CURRENCIES.
  // includes(...) guards against an org whose currency has no seeded plan
  // rows (falls back to USD rather than showing an empty comparison).
  const orgCurrency = membership.organization.currency;
  const planCurrency = orgCurrency && (SUPPORTED_PLAN_CURRENCIES as readonly string[]).includes(orgCurrency) ? orgCurrency : "USD";

  // Fetched before the billingAccount upsert (not in the same Promise.all)
  // so a brand-new org's create branch below can point currentPlanId at
  // the one free plan immediately — no separate "activate" click needed —
  // rather than racing getAICreditAvailability's read of a not-yet-created
  // account.
  const plans = await prisma.plan.findMany({ where: { status: "ACTIVE", currency: planCurrency }, orderBy: [{ tier: "asc" }, { interval: "asc" }] });

  const billingAccount = await prisma.billingAccount.upsert({
    where: { organizationId },
    create: { organizationId, currentPlanId: plans[0]?.id },
    update: {},
    include: { currentPlan: true, paymentMethods: true, billingAddress: true, taxProfile: true },
  });

  const [invoices, aiCredits] = await Promise.all([
    prisma.platformInvoice.findMany({
      where: { organizationId },
      orderBy: { issuedAt: "desc" },
      take: 50,
    }),
    getAICreditAvailability(organizationId),
  ]);

  const hasActiveSubscription = !!billingAccount.gatewaySubscriptionId && !!billingAccount.currentPlanId;
  const trialDaysLeft =
    billingAccount.status === "TRIALING" && billingAccount.trialEndsAt ? daysUntil(billingAccount.trialEndsAt) : null;

  const creditPct = aiCredits.unlimited
    ? 0
    : aiCredits.monthlyCreditsGranted > 0
      ? Math.min(100, Math.round((aiCredits.monthlyCreditsUsed / aiCredits.monthlyCreditsGranted) * 100))
      : 0;

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Plan & billing</h1>
          <p className="text-sm text-muted-foreground">
            KVL Business Solutions runs no subscriptions — Full Access is free for every organization, no card required.
          </p>
        </div>

        {params.checkoutSuccess === "1" && (
          <Alert variant="info">
            <Hourglass className="size-4" />
            <AlertTitle>Payment received — activating your subscription</AlertTitle>
            <AlertDescription>
              Your checkout completed, but activation happens when the gateway&rsquo;s webhook lands, which can take a few
              seconds. Refresh this page shortly if your plan below still shows the old status.
            </AlertDescription>
          </Alert>
        )}
        {params.checkoutCanceled === "1" && (
          <Alert variant="warning">
            <AlertTriangle className="size-4" />
            <AlertTitle>Checkout canceled</AlertTitle>
            <AlertDescription>No changes were made — your existing plan and billing status are unchanged.</AlertDescription>
          </Alert>
        )}

        <Card glass>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="size-4" />
                {billingAccount.currentPlan?.name ?? "No platform plan yet"}
              </CardTitle>
              <Badge variant={STATUS_BADGE_VARIANT[billingAccount.status]}>{STATUS_LABEL[billingAccount.status]}</Badge>
              {billingAccount.cancelAtPeriodEnd && (
                <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                  Cancels at period end
                </Badge>
              )}
            </div>
            <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {billingAccount.currentPeriodEnd && (
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="size-3.5" /> Current period ends {formatDate(billingAccount.currentPeriodEnd)}
                </span>
              )}
              {trialDaysLeft !== null && (
                <span className="flex items-center gap-1.5 text-primary">
                  <BadgeCheck className="size-3.5" /> {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left in trial
                </span>
              )}
              {billingAccount.status === "PAUSED" && billingAccount.pausedAt && (
                <span className="flex items-center gap-1.5">
                  <PauseCircle className="size-3.5" /> Paused {formatDate(billingAccount.pausedAt)}
                </span>
              )}
              {billingAccount.gatewayProvider && <span>via {billingAccount.gatewayProvider}</span>}
            </CardDescription>
          </CardHeader>
          {hasActiveSubscription && (
            <CardContent>
              <SubscriptionActions status={billingAccount.status} cancelAtPeriodEnd={billingAccount.cancelAtPeriodEnd} canManage={canManage} />
            </CardContent>
          )}
        </Card>

        <Card glass>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4" /> AI credits
            </CardTitle>
            <CardDescription>
              {aiCredits.unlimited
                ? "Unlimited on your current plan."
                : `${Math.round(aiCredits.remainingCredits).toLocaleString()} credits remaining of ${aiCredits.monthlyCreditsGranted.toLocaleString()} monthly + ${aiCredits.purchasedCreditsRemaining.toLocaleString()} purchased.`}
            </CardDescription>
          </CardHeader>
          {!aiCredits.unlimited && (
            <CardContent>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(creditPct, aiCredits.monthlyCreditsUsed > 0 ? 4 : 0)}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {aiCredits.monthlyCreditsUsed.toLocaleString()} of {aiCredits.monthlyCreditsGranted.toLocaleString()} monthly credits used.
              </p>
            </CardContent>
          )}
        </Card>

        <PlanComparison plans={plans} currentPlanId={billingAccount.currentPlanId} canManage={canManage} />

        <Card glass>
          <CardHeader>
            <CardTitle className="text-base">Payment methods</CardTitle>
            <CardDescription>Real stored methods for your billing account.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {billingAccount.paymentMethods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payment method on file yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {billingAccount.paymentMethods.map((pm) => (
                  <li key={pm.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="text-foreground">
                      {pm.brand ?? pm.type} {pm.last4 ? `•••• ${pm.last4}` : ""}
                      {pm.expiryMonth && pm.expiryYear ? ` (exp ${pm.expiryMonth}/${pm.expiryYear})` : ""}
                    </span>
                    {pm.isDefault && <Badge variant="accent">Default</Badge>}
                  </li>
                ))}
              </ul>
            )}
            {/* Payment-method-management approach: a real Stripe Customer Portal
                deep link needs a server-created portal session, and no
                portal-session generator exists in the given gateway contract
                (types.ts's PlatformGateway interface only covers checkout,
                subscription read/cancel, and refunds) — fabricating a portal
                URL here would be dishonest. Documented choice: list real
                stored methods (read-only) and explain that adding/updating a
                method happens through checkout, rather than half-building a
                fake card-tokenization form. */}
            <p className="text-xs text-muted-foreground">
              Adding or updating a payment method happens automatically the next time you check out via a gateway above — a
              dedicated self-serve card-management portal isn&rsquo;t wired up in this build yet. Contact billing@kvlgrowthos.com
              for help with an existing method.
            </p>
          </CardContent>
        </Card>

        <BillingAddressForm
          canManage={canManage}
          initial={{
            legalName: billingAccount.billingAddress?.legalName ?? "",
            line1: billingAccount.billingAddress?.line1 ?? "",
            line2: billingAccount.billingAddress?.line2 ?? "",
            city: billingAccount.billingAddress?.city ?? "",
            state: billingAccount.billingAddress?.state ?? "",
            postalCode: billingAccount.billingAddress?.postalCode ?? "",
            country: billingAccount.billingAddress?.country ?? "",
            taxId: billingAccount.billingAddress?.taxId ?? billingAccount.taxProfile?.taxId ?? "",
          }}
          resolvedTax={
            billingAccount.taxProfile ? { ruleType: billingAccount.taxProfile.taxRuleType, ratePercent: billingAccount.taxProfile.taxRatePercent } : null
          }
        />

        <Card glass>
          <CardHeader>
            <CardTitle className="text-base">Invoice history</CardTitle>
            <CardDescription>Platform invoices from GrowthOS for your subscription — separate from invoices your organization sends its own clients.</CardDescription>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No platform invoices yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium text-foreground">{invoice.invoiceNumber}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(invoice.issuedAt)}</TableCell>
                      <TableCell>
                        <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]} className="gap-1">
                          {invoice.status === "PAID" && <CheckCircle2 className="size-3" />}
                          {invoice.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{formatMoney(invoice.totalCents, invoice.currency)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-3">
                          <a
                            href={`/api/platform-invoices/${invoice.id}`}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary"
                            aria-label={`Download invoice ${invoice.invoiceNumber}`}
                          >
                            <Download className="size-3.5" /> Download
                          </a>
                          {canManage && <ShareInvoiceLinkDialog invoiceId={invoice.id} invoiceNumber={invoice.invoiceNumber} />}
                        </div>
                      </TableCell>
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
