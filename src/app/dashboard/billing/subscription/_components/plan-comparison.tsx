"use client";

import { useTransition } from "react";
import { Check, Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { changePlanAction, startCheckoutAction } from "../actions";
import type { PaymentGatewayProvider } from "@/generated/prisma/client";

export interface PlanRowData {
  id: string;
  tier: string;
  interval: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  userLimit: number | null;
  workspaceLimit: number | null;
  aiCreditsMonthly: number | null;
  storageMbLimit: number | null;
  projectLimit: number | null;
  automationRunsMonthly: number | null;
  whiteLabelAccess: boolean;
  ssoAccess: boolean;
  prioritySupport: boolean;
  advancedAnalytics: boolean;
}

export interface PlanComparisonProps {
  plans: PlanRowData[];
  currentPlanId: string | null;
  canManage: boolean;
}

function formatLimit(value: number | null, unit = ""): string {
  return value === null ? "Unlimited" : `${value.toLocaleString()}${unit}`;
}

function formatPrice(cents: number, currency: string): string {
  if (cents === 0) return "Free";
  try {
    return (cents / 100).toLocaleString(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
  } catch {
    return `${(cents / 100).toLocaleString()} ${currency}`;
  }
}

/** Simple default gateway per currency until an operator configures more than one — Razorpay reads better for INR/Gulf tenants, Stripe covers everything else. Either can be reconfigured per plan via `Plan.gatewayPriceIds` once real gateway credentials exist. */
function defaultGatewayFor(currency: string): PaymentGatewayProvider {
  return currency === "INR" || currency === "AED" || currency === "SAR" ? "RAZORPAY" : "STRIPE";
}

/**
 * Real multi-tier plan comparison — FREE through ENTERPRISE, priced in the
 * org's own currency (CUSTOM is deliberately excluded: it's a manually
 * negotiated, never-self-service tier per plan-catalog.ts). Monthly rows
 * only are shown side by side here; a yearly toggle isn't built yet, so
 * each card's own price reflects whichever interval was passed in.
 */
export function PlanComparison({ plans, currentPlanId, canManage }: PlanComparisonProps) {
  const monthlyPlans = plans.filter((p) => p.interval === "MONTHLY" && p.tier !== "CUSTOM");

  if (monthlyPlans.length === 0) {
    return (
      <Card glass>
        <CardHeader>
          <CardTitle className="text-base">Plan</CardTitle>
          <CardDescription>No plan catalog row found yet — the platform plan seed hasn&rsquo;t run in this environment.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Plans</h2>
        <p className="text-sm text-muted-foreground">Pick the tier that matches your team&rsquo;s size and usage — upgrade or downgrade any time.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {monthlyPlans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} isCurrent={plan.id === currentPlanId} canManage={canManage} />
        ))}
      </div>
    </div>
  );
}

function PlanCard({ plan, isCurrent, canManage }: { plan: PlanRowData; isCurrent: boolean; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const isFree = plan.priceCents === 0;

  function handleActivateFree() {
    startTransition(async () => {
      const result = await changePlanAction(plan.id);
      if (!result.ok) {
        toast.error(result.error ?? "Could not activate this plan.");
        return;
      }
      toast.success(`${plan.name} activated.`);
    });
  }

  function handleSubscribe() {
    startTransition(async () => {
      const provider = defaultGatewayFor(plan.currency);
      const result = await startCheckoutAction(plan.id, provider);
      if (!result.ok) {
        toast.error(result.error ?? "Could not start checkout.");
        return;
      }
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      }
    });
  }

  return (
    <Card glass className={isCurrent ? "border-primary/40 shadow-elevated shadow-glow-primary" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{plan.name}</CardTitle>
          {isFree && <Badge variant="accent">Free</Badge>}
        </div>
        <CardDescription className="line-clamp-2">{plan.description ?? " "}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-baseline gap-1">
          <p className="text-2xl font-semibold tracking-tight text-foreground">{formatPrice(plan.priceCents, plan.currency)}</p>
          {!isFree && <span className="text-xs text-muted-foreground">/mo</span>}
        </div>

        <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <Check className="size-3.5 shrink-0 text-primary" /> {formatLimit(plan.userLimit)} users
          </li>
          <li className="flex items-center gap-1.5">
            <Check className="size-3.5 shrink-0 text-primary" /> {formatLimit(plan.workspaceLimit)} workspaces
          </li>
          <li className="flex items-center gap-1.5">
            <Check className="size-3.5 shrink-0 text-primary" /> {formatLimit(plan.aiCreditsMonthly)} AI credits/mo
          </li>
          <li className="flex items-center gap-1.5">
            <Check className="size-3.5 shrink-0 text-primary" /> {formatLimit(plan.storageMbLimit, " MB")} storage
          </li>
          <li className="flex items-center gap-1.5">
            <Check className="size-3.5 shrink-0 text-primary" /> {formatLimit(plan.projectLimit)} projects
          </li>
          <li className="flex items-center gap-1.5">
            <Check className="size-3.5 shrink-0 text-primary" /> {formatLimit(plan.automationRunsMonthly)} automation runs/mo
          </li>
          {plan.ssoAccess && (
            <li className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 shrink-0 text-primary" /> SSO
            </li>
          )}
          {plan.whiteLabelAccess && (
            <li className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 shrink-0 text-primary" /> White-label
            </li>
          )}
          {plan.advancedAnalytics && (
            <li className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 shrink-0 text-primary" /> Advanced analytics
            </li>
          )}
          {plan.prioritySupport && (
            <li className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 shrink-0 text-primary" /> Priority support
            </li>
          )}
        </ul>

        <div className="mt-auto pt-2">
          {!canManage ? (
            <p className="text-xs text-muted-foreground">Only owners and admins can change plans.</p>
          ) : isCurrent ? (
            <Badge variant="accent" className="w-fit">
              Current plan
            </Badge>
          ) : isFree ? (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={handleActivateFree}>
              {pending ? "Switching…" : "Downgrade to Free"}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={pending} onClick={handleSubscribe}>
              {pending ? "Starting checkout…" : `Subscribe to ${plan.name}`}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
