"use client";

import { useMemo, useState } from "react";
import { FileCheck2, Sparkles, Link2, Search, X } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EvidenceKind, EvidenceSource } from "@/generated/prisma/client";

const BATCH_SIZE = 10;

const SOURCE_LABEL: Record<EvidenceSource, string> = {
  WEBSITE_SCAN: "Website scan",
  WEB_SEARCH: "Web search",
  MANUAL: "Manual entry",
  CSV_IMPORT: "CSV import",
  COMPANY_INTELLIGENCE: "Company intelligence",
};

export type EvidenceFreshness = "FRESH" | "AGING" | "STALE";

const FRESHNESS_LABEL: Record<EvidenceFreshness, string> = {
  FRESH: "Fresh",
  AGING: "Aging",
  STALE: "Stale",
};

const FRESHNESS_VARIANT: Record<EvidenceFreshness, "default" | "secondary" | "outline"> = {
  FRESH: "default",
  AGING: "secondary",
  STALE: "outline",
};

export interface CompanyEvidenceView {
  id: string;
  kind: EvidenceKind;
  fact: string;
  source: EvidenceSource;
  sourceUrl: string | null;
  confidence: number;
  discoveredAt: string;
  /** Phase 16 — computed server-side from discoveredAt (see evidence-freshness.ts), never guessed client-side. */
  freshness: EvidenceFreshness;
}

/**
 * Evidence backing this Company's intelligence/opportunity output, grouped
 * by kind with a deliberately different visual treatment per group —
 * RAW_FACT (a directly observed fact, e.g. straight off a WebsiteScan) never
 * renders identically to AI_INTERPRETATION (an AI's inference from that
 * fact), so nobody mistakes an inference for a verified observation.
 */
export function CompanyEvidencePanel({ evidence }: { evidence: CompanyEvidenceView[] }) {
  const [query, setQuery] = useState("");
  const [rawVisible, setRawVisible] = useState(BATCH_SIZE);
  const [interpVisible, setInterpVisible] = useState(BATCH_SIZE);

  const isFiltering = query.trim().length > 0;
  const filtered = useMemo(() => {
    if (!isFiltering) return evidence;
    const needle = query.trim().toLowerCase();
    return evidence.filter((e) => e.fact.toLowerCase().includes(needle));
  }, [evidence, query, isFiltering]);

  const rawFacts = filtered.filter((e) => e.kind === "RAW_FACT");
  const interpretations = filtered.filter((e) => e.kind === "AI_INTERPRETATION");
  const visibleRawFacts = isFiltering ? rawFacts : rawFacts.slice(0, rawVisible);
  const visibleInterpretations = isFiltering ? interpretations : interpretations.slice(0, interpVisible);

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
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search evidence..."
              className="pl-9 pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {isFiltering && (
            <p className="text-xs text-muted-foreground">
              {filtered.length} of {evidence.length} match{evidence.length === 1 ? "" : "es"}
            </p>
          )}
        </div>

        {isFiltering && filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches for &quot;{query.trim()}&quot;.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {rawFacts.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <FileCheck2 className="size-3.5" /> Raw facts — directly observed ({rawFacts.length})
                </p>
                <div className="flex flex-col gap-2">
                  {visibleRawFacts.map((item) => (
                    <EvidenceRow key={item.id} item={item} />
                  ))}
                </div>
                {!isFiltering && rawFacts.length > rawVisible && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    onClick={() => setRawVisible((v) => v + BATCH_SIZE)}
                  >
                    Show more ({rawFacts.length - rawVisible} remaining)
                  </Button>
                )}
              </div>
            )}
            {interpretations.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <Sparkles className="size-3.5" /> AI interpretations — inferred, not verified ({interpretations.length})
                </p>
                <div className="flex flex-col gap-2">
                  {visibleInterpretations.map((item) => (
                    <EvidenceRow key={item.id} item={item} />
                  ))}
                </div>
                {!isFiltering && interpretations.length > interpVisible && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    onClick={() => setInterpVisible((v) => v + BATCH_SIZE)}
                  >
                    Show more ({interpretations.length - interpVisible} remaining)
                  </Button>
                )}
              </div>
            )}
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
          <Badge variant={FRESHNESS_VARIANT[item.freshness]}>{FRESHNESS_LABEL[item.freshness]}</Badge>
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
