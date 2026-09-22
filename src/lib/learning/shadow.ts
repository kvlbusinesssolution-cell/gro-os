import { prisma } from "@/lib/prisma";

/**
 * §34 — Shadow Mode, point-in-time only (no automatic time-series tracking
 * yet — see the Phase 11 final report for that documented deferral). Never
 * writes to LeadOpportunity.opportunityScore; this is purely a parallel,
 * inspectable comparison. When no OBSERVED/STRONG_OBSERVATION pattern
 * applies to an opportunity's cohort, shadowScore intentionally equals
 * productionScore — never a fabricated alternative formula.
 */

const MAX_NUDGE = 10; // bounded adjustment — shadow mode informs, never wildly diverges from the real formula

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function computeShadowScoresForOrganization(organizationId: string): Promise<{ computed: number }> {
  const [opportunities, patterns] = await Promise.all([
    prisma.leadOpportunity.findMany({
      where: { company: { organizationId }, opportunityScore: { not: null } },
      select: { id: true, opportunityScore: true, recommendedService: true, company: { select: { industry: true } } },
    }),
    prisma.learningPattern.findMany({
      where: { organizationId, status: { in: ["ACTIVE", "EMERGING"] }, sampleClassification: { in: ["OBSERVED", "STRONG_OBSERVATION"] }, patternType: { in: ["WINNING_PATTERN", "LOSING_PATTERN", "SERVICE"] } },
    }),
  ]);

  let computed = 0;
  for (const opp of opportunities) {
    const cohort: Record<string, string | null> = { industry: opp.company.industry, service: opp.recommendedService };
    const matching = patterns.filter((p) => {
      const conditions = p.conditions as unknown as Array<{ dimension: string; value: string }>;
      return conditions.every((c) => cohort[c.dimension] === c.value);
    });

    let scoreDiff = 0;
    const basisPatternIds: string[] = [];
    for (const p of matching) {
      if (p.conversionRate === null) continue;
      // Nudge proportional to how far this pattern's conversion sits from a
      // neutral 50% baseline, scaled down by the pattern's own confidence —
      // a LOW-confidence pattern (shouldn't reach here given the filter
      // above, but defensive) contributes nothing.
      const weight = p.confidence === "HIGH" ? 1 : p.confidence === "MEDIUM" ? 0.6 : 0;
      const direction = p.patternType === "LOSING_PATTERN" ? -1 : 1;
      scoreDiff += direction * weight * MAX_NUDGE * Math.abs(p.conversionRate - 0.5) * 2;
      basisPatternIds.push(p.id);
    }
    scoreDiff = Math.round(Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, scoreDiff)));

    const productionScore = opp.opportunityScore!;
    const shadowScore = clamp(productionScore + scoreDiff);

    await prisma.learningShadowScore.create({
      data: {
        organizationId,
        leadOpportunityId: opp.id,
        productionScore,
        shadowScore,
        scoreDiff: shadowScore - productionScore,
        basisPatternIds,
      },
    });
    computed += 1;
  }
  return { computed };
}

export function getLatestShadowScore(organizationId: string, leadOpportunityId: string) {
  return prisma.learningShadowScore.findFirst({ where: { organizationId, leadOpportunityId }, orderBy: { computedAt: "desc" } });
}
