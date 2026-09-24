import Link from "next/link";
import { CreditCard, AlertTriangle, Users, Receipt, Repeat, Calculator } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../_lib/require-membership";
import { PlanSelector } from "./_components/plan-selector";
import { TokenPurchasePanel } from "./_components/token-purchase-panel";
import { getGrowthTokenAvailability } from "@/lib/billing/growth-tokens";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function BillingPage() {
  const { membership } = await requireActiveMembership("/dashboard/billing");
  const organizationId = membership.organizationId;
  const canManage = membership.role === "OWNER";

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [billingAccount, seatsUsed, aiCallsThisMonth, tokenAvailability] = await Promise.all([
    prisma.billingAccount.upsert({
      where: { organizationId },
      create: { organizationId },
      update: {},
    }),
    prisma.membership.count({ where: { organizationId, status: "ACTIVE" } }),
    prisma.activity.count({
      where: { organizationId, type: { in: ["AGENT_MESSAGE", "COMPLETED_WORK"] }, createdAt: { gte: monthStart } },
    }),
    getGrowthTokenAvailability(organizationId),
  ]);

  const seatsPct = Math.min(100, Math.round((seatsUsed / billingAccount.seatsIncluded) * 100));
  const daysInMonth = Math.ceil((Date.now() - monthStart.getTime()) / DAY_MS) + 1;

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Real plan and usage tracking, stored in your organization&rsquo;s own record.
          </p>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            Real payment processing (Stripe, Razorpay, Paddle, LemonSqueezy, or bank transfer) now exists at{" "}
            <Link href="/dashboard/billing/subscription" className="font-medium underline underline-offset-2">
              Subscription &amp; Payment
            </Link>{" "}
            — whether it&rsquo;s active depends on which gateway credentials this deployment has configured. The free
            plan switcher below still works exactly as before: it updates your organization&rsquo;s billing record and
            seat limit immediately without ever charging a card.
          </p>
        </div>

        <TokenPurchasePanel
          unlimited={tokenAvailability.unlimited}
          remainingTokens={tokenAvailability.unlimited ? 0 : tokenAvailability.remainingTokens}
          monthlyTokensGranted={tokenAvailability.monthlyTokensGranted}
          monthlyTokensUsed={tokenAvailability.monthlyTokensUsed}
          purchasedTokensRemaining={tokenAvailability.purchasedTokensRemaining}
        />

        <Card glass>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="size-4" /> Subscription &amp; Payment
              </CardTitle>
              <CardDescription>
                Real checkout, invoices, payment methods, AI credit balance, and usage limits for your organization&rsquo;s
                actual GrowthOS plan.
              </CardDescription>
            </div>
            <Button asChild size="sm">
              <Link href="/dashboard/billing/subscription">Open</Link>
            </Button>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card glass>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Usage</CardTitle>
                <CardDescription>Real per-metric usage against your plan&rsquo;s limits.</CardDescription>
              </div>
              <Button asChild variant="secondary" size="sm">
                <Link href="/dashboard/billing/usage">View</Link>
              </Button>
            </CardHeader>
          </Card>
          <Card glass>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">AI Credits</CardTitle>
                <CardDescription>Real Claude/OpenAI/Gemini/Groq/embedding usage and balance.</CardDescription>
              </div>
              <Button asChild variant="secondary" size="sm">
                <Link href="/dashboard/billing/ai-credits">View</Link>
              </Button>
            </CardHeader>
          </Card>
        </div>

        {membership.organization.isOwnerOrg ? (
          <Card glass>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Calculator className="size-4" /> Token Pricing Calculator
                </CardTitle>
                <CardDescription>
                  Owner-only: the real reference-cost-to-token-price methodology behind every Growth Token charge.
                </CardDescription>
              </div>
              <Button asChild variant="secondary" size="sm">
                <Link href="/dashboard/billing/token-pricing">Open</Link>
              </Button>
            </CardHeader>
          </Card>
        ) : null}

        <PlanSelector currentPlan={billingAccount.plan} canManage={canManage} />

        <Card glass>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="size-4" /> Expenses
              </CardTitle>
              <CardDescription>Log marketing and sales spend — the real input behind CAC on the Analytics page.</CardDescription>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard/billing/expenses">Manage expenses</Link>
            </Button>
          </CardHeader>
        </Card>

        <Card glass>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Repeat className="size-4" /> Subscriptions
              </CardTitle>
              <CardDescription>
                Log your customers&rsquo; recurring revenue — the real input behind MRR/ARR/churn on the Analytics page.
              </CardDescription>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard/billing/subscriptions">Manage subscriptions</Link>
            </Button>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4" /> Seats
              </CardTitle>
              <CardDescription>
                {seatsUsed} of {billingAccount.seatsIncluded} used
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(seatsPct, seatsUsed > 0 ? 4 : 0)}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="size-4" /> AI activity this month
              </CardTitle>
              <CardDescription>
                {aiCallsThisMonth} agent message{aiCallsThisMonth === 1 ? "" : "s"}/completions over {daysInMonth} day
                {daysInMonth === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tracking-tight text-foreground">{aiCallsThisMonth}</p>
            </CardContent>
          </Card>
        </div>
      </Container>
    </main>
  );
}
