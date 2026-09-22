"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ArrowUpRight, Flag, Handshake, Loader2, Sparkles, Target, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { formatCurrency } from "@/app/dashboard/_lib/format";
import { KVL_SERVICES, type KVLServiceId } from "@/lib/business-development/kvl-service-catalog";
import {
  PRIORITY_BADGE_CLASSNAME,
  PRIORITY_LABEL,
  confidenceBadgeClassName,
  recommendedNextAction,
} from "@/app/dashboard/opportunities/_lib/opportunity-display";
import { addOpportunityToCrm, dismissOpportunity, markOpportunityForReview } from "@/app/dashboard/opportunities/_lib/opportunity-actions";
import { generateProposalFromOpportunity } from "@/app/dashboard/opportunities/_lib/proposal-generation-actions";
import { ScoreBreakdownMenu } from "@/app/dashboard/priority-queue/_components/score-breakdown-menu";
import type { OpportunityPriority, OpportunityStatus } from "@/generated/prisma/client";
import type { OpportunityScoreBreakdown } from "@/lib/business-development/opportunity-priority";

const KVL_SERVICE_BY_ID = new Map<string, (typeof KVL_SERVICES)[number]>(KVL_SERVICES.map((s) => [s.id, s]));

export interface CompanyOpportunityRow {
  id: string;
  title: string;
  description: string;
  estimatedValue: number | null;
  opportunityScore: number | null;
  opportunityScoreBreakdown: OpportunityScoreBreakdown | null;
  priority: OpportunityPriority | null;
  priorityReasoning: string | null;
  status: OpportunityStatus;
  recommendedService: string | null;
  nextStep: string | null;
  createdAt: string;
}

/**
 * AI Opportunities for this one company — the same real LeadOpportunity
 * data /dashboard/priority-queue triages, scoped down to a vertical card
 * list. Reuses ScoreBreakdownMenu (explainability) and the exact triage
 * server actions the Opportunities list/detail pages already call, so
 * acting from a company's own page can never diverge from acting anywhere
 * else — there is only one set of triage rules for a LeadOpportunity.
 */
export function CompanyOpportunitiesPanel({ opportunities }: { opportunities: CompanyOpportunityRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(successMessage);
      router.refresh();
    });
  }

  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="size-4" /> AI Opportunities ({opportunities.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {opportunities.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Sparkles className="size-6 text-muted-foreground" strokeWidth={1.5} />
            <p className="max-w-xs text-xs text-muted-foreground">
              No AI opportunities detected yet for this company — run the AI Opportunity Engine from Company Discovery
              to generate some.
            </p>
          </div>
        ) : (
          opportunities.map((o) => {
            const service = o.recommendedService ? KVL_SERVICE_BY_ID.get(o.recommendedService as KVLServiceId) : null;
            const nextAction = recommendedNextAction({ status: o.status, nextStep: o.nextStep, recommendedServiceLabel: service?.label ?? null });
            const isAddedToCrm = o.status === "ADDED_TO_CRM";
            const isDismissed = o.status === "DISMISSED";
            const isReviewed = o.status === "REVIEWED";

            return (
              <div key={o.id} className="flex flex-col gap-2 rounded-xl border border-border p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{o.title}</p>
                  {o.estimatedValue != null && (
                    <span className="shrink-0 text-xs text-muted-foreground">{formatCurrency(o.estimatedValue)}</span>
                  )}
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{o.description}</p>

                <div className="flex flex-wrap items-center gap-1.5">
                  {o.priority && (
                    <Badge variant="outline" className={PRIORITY_BADGE_CLASSNAME[o.priority]}>
                      {PRIORITY_LABEL[o.priority]}
                    </Badge>
                  )}
                  {o.opportunityScore !== null && o.opportunityScoreBreakdown ? (
                    <ScoreBreakdownMenu breakdown={o.opportunityScoreBreakdown} priorityReasoning={o.priorityReasoning}>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${confidenceBadgeClassName(o.opportunityScore)}`}>
                        Score {o.opportunityScore}
                      </span>
                    </ScoreBreakdownMenu>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not scored yet</span>
                  )}
                  {service && <Badge variant="accent">{service.label}</Badge>}
                </div>

                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Next: </span>
                  {nextAction}
                </p>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || isAddedToCrm}
                    onClick={() => run(() => addOpportunityToCrm(o.id), "Added to CRM.")}
                  >
                    {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Handshake className="size-3.5" />}
                    {isAddedToCrm ? "Added to CRM" : "Add to CRM"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || isReviewed || isDismissed}
                    onClick={() => run(() => markOpportunityForReview(o.id), "Marked for review.")}
                  >
                    <Flag className="size-3.5" /> {isReviewed ? "Reviewed" : "Mark for review"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || isDismissed}
                    onClick={() => run(() => generateProposalFromOpportunity(o.id), "Proposal drafted.")}
                  >
                    <Sparkles className="size-3.5" /> Generate proposal
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || isDismissed}
                    onClick={() => run(() => dismissOpportunity(o.id), "Dismissed.")}
                  >
                    <XCircle className="size-3.5" /> {isDismissed ? "Dismissed" : "Dismiss"}
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/dashboard/opportunities/${o.id}`}>
                      <ArrowUpRight className="size-3.5" /> View full brief
                    </Link>
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
