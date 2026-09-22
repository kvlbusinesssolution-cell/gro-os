import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireActiveMembership } from "../../_lib/require-membership";
import { listPatterns } from "@/lib/learning/queries";
import type { LearningPatternType } from "@/generated/prisma/client";

const CONFIDENCE_BADGE: Record<string, "accent" | "secondary" | "outline"> = { HIGH: "accent", MEDIUM: "secondary", LOW: "outline" };

const PATTERN_TYPES: LearningPatternType[] = [
  "WINNING_PATTERN",
  "LOSING_PATTERN",
  "SIGNAL",
  "MESSAGE_ANGLE",
  "SERVICE",
  "CHANNEL",
  "DECISION_MAKER",
  "HIGH_VALUE",
  "LONG_SALES_CYCLE",
  "SHORT_SALES_CYCLE",
  "OBJECTION",
];

export default async function LearningPatternsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { membership } = await requireActiveMembership("/dashboard/learning/patterns");
  const { type } = await searchParams;
  const patternType = type && (PATTERN_TYPES as string[]).includes(type) ? (type as LearningPatternType) : undefined;

  const { patterns } = await listPatterns(membership.organizationId, { patternType, limit: 100 });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <Sparkles className="size-6 text-primary" /> Patterns
          </h1>
          <p className="text-sm text-muted-foreground">Every card shows real sample size, conversion, confidence and evidence — never causation.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/learning/patterns">
            <Badge variant={!patternType ? "accent" : "outline"}>All</Badge>
          </Link>
          {PATTERN_TYPES.map((t) => (
            <Link key={t} href={`/dashboard/learning/patterns?type=${t}`}>
              <Badge variant={patternType === t ? "accent" : "outline"}>{t.replace(/_/g, " ")}</Badge>
            </Link>
          ))}
        </div>

        {patterns.length === 0 ? (
          <Card glass>
            <CardContent className="p-4 text-sm text-muted-foreground">
              No patterns in this category yet — either the learning engine hasn&apos;t run, or there isn&apos;t enough real data to persist a pattern here (minimum {2} observations to even store one).
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {patterns.map((p) => (
              <Link key={p.id} href={`/dashboard/learning/patterns/${p.id}`}>
                <Card glass className="h-full transition-colors hover:border-primary/40">
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline">{p.patternType.replace(/_/g, " ")}</Badge>
                      <Badge variant={CONFIDENCE_BADGE[p.confidence] ?? "outline"}>{p.confidence}</Badge>
                    </div>
                    <span className="text-sm font-medium text-foreground">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.description}</span>
                    <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
                      <span>n={p.sampleSize}</span>
                      <span>{p.conversionRate !== null ? `${Math.round(p.conversionRate * 100)}% conversion` : "no decided outcomes yet"}</span>
                      <Badge variant="outline">{p.sampleClassification.replace(/_/g, " ")}</Badge>
                      <Badge variant="outline">Causality: {p.causality}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Container>
    </main>
  );
}
