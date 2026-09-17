import { FileCheck2, Sparkles, Link2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { EvidenceKind, EvidenceSource } from "@/generated/prisma/client";

const SOURCE_LABEL: Record<EvidenceSource, string> = {
  WEBSITE_SCAN: "Website scan",
  WEB_SEARCH: "Web search",
  MANUAL: "Manual entry",
  CSV_IMPORT: "CSV import",
  COMPANY_INTELLIGENCE: "Company intelligence",
};

export interface CompanyEvidenceView {
  id: string;
  kind: EvidenceKind;
  fact: string;
  source: EvidenceSource;
  sourceUrl: string | null;
  confidence: number;
  discoveredAt: string;
}

/**
 * Evidence backing this Company's intelligence/opportunity output, grouped
 * by kind with a deliberately different visual treatment per group —
 * RAW_FACT (a directly observed fact, e.g. straight off a WebsiteScan) never
 * renders identically to AI_INTERPRETATION (an AI's inference from that
 * fact), so nobody mistakes an inference for a verified observation.
 */
export function CompanyEvidencePanel({ evidence }: { evidence: CompanyEvidenceView[] }) {
  const rawFacts = evidence.filter((e) => e.kind === "RAW_FACT");
  const interpretations = evidence.filter((e) => e.kind === "AI_INTERPRETATION");

  if (evidence.length === 0) {
    return (
      <Card glass>
        <CardHeader>
          <CardTitle className="text-base">Evidence</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            No evidence recorded yet. Evidence rows are populated by the discovery/enrichment pipeline (website
            scans, web search, company intelligence) — none here means nothing has been recorded for this
            company yet, not that a check ran and found nothing.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card glass>
      <CardHeader>
        <CardTitle className="text-base">Evidence ({evidence.length})</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-0">
        {rawFacts.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <FileCheck2 className="size-3.5" /> Raw facts — directly observed ({rawFacts.length})
            </p>
            <div className="flex flex-col gap-2">
              {rawFacts.map((item) => (
                <EvidenceRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}
        {interpretations.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" /> AI interpretations — inferred, not verified ({interpretations.length})
            </p>
            <div className="flex flex-col gap-2">
              {interpretations.map((item) => (
                <EvidenceRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EvidenceRow({ item }: { item: CompanyEvidenceView }) {
  const isRawFact = item.kind === "RAW_FACT";
  return (
    <div
      className={`rounded-lg border p-3 ${
        isRawFact ? "border-emerald-500/20 bg-emerald-500/5" : "border-primary/20 bg-primary/5"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant={isRawFact ? "outline" : "accent"}>{isRawFact ? "Verified fact" : "AI interpretation"}</Badge>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{SOURCE_LABEL[item.source]}</Badge>
          <span>{Math.round(item.confidence * 100)}% confidence</span>
        </div>
      </div>
      <p className="mt-2 text-sm text-foreground">{item.fact}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{new Date(item.discoveredAt).toLocaleString()}</span>
        {item.sourceUrl && (
          <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
            <Link2 className="size-3" /> Source
          </a>
        )}
      </div>
    </div>
  );
}
