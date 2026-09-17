"use client";

import { useTransition } from "react";
import { Check, Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { changePlanAction } from "../actions";

export interface PlanRowData {
  id: string;
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

/**
 * KVL Business Solutions runs a single free plan (see plan-catalog.ts) — no
 * tiers to compare, no checkout, no gateway. This just confirms Full Access
 * and, if the org hasn't been switched onto it yet, activates it in one
 * click via changePlanAction (which sets currentPlanId directly with no
 * payment involved whenever there's no live gateway subscription).
 */
export function PlanComparison({ plans, currentPlanId, canManage }: PlanComparisonProps) {
  const plan = plans[0];

  if (!plan) {
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
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Plan</h2>
        <p className="text-sm text-muted-foreground">KVL Business Solutions has no subscriptions or paid tiers — this is the only plan, and it&rsquo;s free.</p>
      </div>

      <div className="mx-auto w-full max-w-md">
        <PlanCard plan={plan} isCurrent={plan.id === currentPlanId} canManage={canManage} />
      </div>
    </div>
  );
}

function PlanCard({ plan, isCurrent, canManage }: { plan: PlanRowData; isCurrent: boolean; canManage: boolean }) {
  const [pending, startTransition] = useTransition();

  function handleActivate() {
    startTransition(async () => {
      const result = await changePlanAction(plan.id);
      if (!result.ok) {
        toast.error(result.error ?? "Could not activate Full Access.");
        return;
      }
      toast.success("Full Access activated — free, no card needed.");
    });
  }

  return (
    <Card glass className="border-primary/40 shadow-elevated shadow-glow-primary">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{plan.name}</CardTitle>
          <Badge variant="accent">Free</Badge>
        </div>
        <CardDescription>{plan.description ?? " "}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-3xl font-semibold tracking-tight text-foreground">Free</p>

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
            <p className="text-xs text-muted-foreground">Only owners and admins can activate the plan.</p>
          ) : isCurrent ? (
            <Badge variant="accent" className="w-fit">
              Current plan
            </Badge>
          ) : (
            <Button type="button" size="sm" disabled={pending} onClick={handleActivate}>
              {pending ? "Activating..." : "Activate — it's free"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
