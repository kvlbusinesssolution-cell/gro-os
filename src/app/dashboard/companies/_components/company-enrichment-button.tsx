"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { enrichCompanyAction } from "../_lib/enrichment-actions";
import type { EnrichmentStatus } from "@/generated/prisma/client";

const STATUS_LABEL: Record<EnrichmentStatus, string> = {
  NEVER_ENRICHED: "Never enriched",
  QUEUED: "Queued",
  RUNNING: "Running…",
  PARTIAL: "Partially enriched",
  COMPLETED: "Enriched",
  FAILED: "Enrichment failed",
  STALE: "Stale",
};

const STATUS_VARIANT: Record<EnrichmentStatus, "outline" | "accent" | "secondary"> = {
  NEVER_ENRICHED: "outline",
  QUEUED: "secondary",
  RUNNING: "secondary",
  PARTIAL: "secondary",
  COMPLETED: "accent",
  FAILED: "outline",
  STALE: "outline",
};

export interface CompanyEnrichmentButtonProps {
  companyId: string;
  enrichmentStatus: EnrichmentStatus;
  lastEnrichedAt: string | null;
  enrichmentFailureReason: string | null;
}

/**
 * Phase 1 (GrowthOS Data & Enrichment Engine) — the "Manual Enrich" action
 * on a Company's existing detail page (Discovery & Evidence tab), running
 * the real enrichCompany() orchestration (Company Intelligence → Intent
 * Score → Decision Makers → Opportunities → Lead Score) and refreshing the
 * page to show the new CompanyEvidencePanel/CompanyIntelligencePanel/
 * CompanyDecisionMakersPanel/CompanyIntentScorePanel rows it produced — none
 * of those panels are new, only this trigger is.
 */
export function CompanyEnrichmentButton({ companyId, enrichmentStatus, lastEnrichedAt, enrichmentFailureReason }: CompanyEnrichmentButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<EnrichmentStatus | null>(null);
  const router = useRouter();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await enrichCompanyAction(companyId);
      if (!result.ok) {
        setError(result.error ?? "Enrichment failed.");
        return;
      }
      if (result.status) setLastStatus(result.status as EnrichmentStatus);
      router.refresh();
    });
  }

  return (
    <Card glass>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Enrichment</CardTitle>
        <Badge variant={STATUS_VARIANT[enrichmentStatus]}>{STATUS_LABEL[enrichmentStatus]}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <p className="text-sm text-muted-foreground">
          {lastEnrichedAt
            ? `Last enriched ${new Date(lastEnrichedAt).toLocaleString()}.`
            : "This company hasn't been through a full enrichment pass yet."}
        </p>
        {enrichmentFailureReason && enrichmentStatus === "FAILED" && (
          <p className="text-sm text-destructive">{enrichmentFailureReason}</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button size="sm" variant="outline" className="w-fit gap-1.5" onClick={handleClick} disabled={isPending}>
          {isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {isPending ? "Enriching…" : "Enrich now"}
        </Button>
        {lastStatus && !isPending && <p className="text-xs text-muted-foreground">Last run: {STATUS_LABEL[lastStatus]}.</p>}
      </CardContent>
    </Card>
  );
}
