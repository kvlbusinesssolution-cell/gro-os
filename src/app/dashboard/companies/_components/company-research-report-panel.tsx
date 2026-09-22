"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles, Search } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { researchCompanyAction, refreshResearchAction } from "../_lib/research-actions";
import type { CompanyResearchReport } from "@/lib/business-development/company-research";

const STATUS_LABEL: Record<string, string> = {
  NEVER_ENRICHED: "Not yet researched",
  QUEUED: "Queued",
  RUNNING: "Researching…",
  PARTIAL: "Partially researched",
  COMPLETED: "Researched",
  FAILED: "Research failed",
  STALE: "Research stale",
};

/**
 * Phase 3 (AI Company Research Engine) — the ONE new panel this phase adds
 * to the existing Company detail page. Deliberately does NOT re-render
 * products/technology/growth-signals/decision-makers/evidence — those are
 * already shown by CompanyIntelligencePanel / CompanyDiscoveryPanel /
 * CompanyDecisionMakersPanel / CompanyEvidencePanel / CompanyIntentScorePanel
 * / CompanyRecommendedActionPanel (Phase 1/2). This panel surfaces only the
 * genuinely NEW synthesis: research status/quality, "Why now", the outreach
 * angle (a recommendation, never a sent message), and the explicit
 * unknowns list.
 */
export function CompanyResearchReportPanel({ companyId, report }: { companyId: string; report: CompanyResearchReport | null }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  function handleResearch() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await researchCompanyAction(companyId);
      if (!result.ok) return setError(result.error ?? "Research failed.");
      router.refresh();
    });
  }

  function handleRefresh() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await refreshResearchAction(companyId);
      if (!result.ok) return setError(result.error ?? "Refresh failed.");
      if (!result.data?.refreshed) setMessage(result.data?.reason ?? "No significant change.");
      router.refresh();
    });
  }

  return (
    <Card glass>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="size-4" /> Company research
          {report && <Badge variant="outline">{STATUS_LABEL[report.status] ?? report.status}</Badge>}
        </CardTitle>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleResearch} disabled={isPending}>
            {isPending ? <RefreshCw className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Research now
          </Button>
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={isPending}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
        {!report || report.status === "NEVER_ENRICHED" ? (
          <p className="text-xs text-muted-foreground">No research report yet — click &quot;Research now&quot;.</p>
        ) : (
          <>
            <div className="flex items-center gap-3 text-xs">
              <span>
                Research quality: <span className="font-medium text-foreground">{report.researchQuality}/100</span>
              </span>
              {report.lastResearchedAt && <span className="text-muted-foreground">Last researched {new Date(report.lastResearchedAt).toLocaleString()}</span>}
            </div>

            <div>
              <p className="text-xs font-semibold text-foreground">Why now?</p>
              <p className="text-xs text-muted-foreground">{report.whyNow}</p>
            </div>

            {report.outreachAngle?.angle && (
              <div>
                <p className="text-xs font-semibold text-foreground">Recommended outreach angle</p>
                <p className="text-xs text-muted-foreground">{report.outreachAngle.angle}</p>
              </div>
            )}

            {report.firstMessageContext && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                <Badge variant="accent" className="mb-1.5">
                  {report.firstMessageContext.label}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Opening: </span>
                  {report.firstMessageContext.openingObservation}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">KVL relevance: </span>
                  {report.firstMessageContext.kvlRelevance}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Suggested CTA: </span>
                  {report.firstMessageContext.ctaDirection}
                </p>
              </div>
            )}

            {report.painPoints.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground">Potential pain points</p>
                <ul className="flex flex-col gap-1">
                  {report.painPoints.map((p, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      <Badge variant="outline" className="mr-1.5">
                        {p.category.replaceAll("_", " ")}
                      </Badge>
                      {p.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.unknowns.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground">Unknown / not verified</p>
                <ul className="flex flex-col gap-0.5">
                  {report.unknowns.map((u, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      {u}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
