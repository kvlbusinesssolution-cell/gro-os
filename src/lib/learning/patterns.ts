import { prisma } from "@/lib/prisma";
import type { LearningObservation, LearningPatternType, LearningConfidence, LearningSampleClassification, Prisma } from "@/generated/prisma/client";
import { LEARNING_CONFIG, CONFIDENCE_WEIGHTS } from "./config";
import type { CohortStats, ConfidenceFactors, DiscoveredPattern, ObjectionSnapshot } from "./types";

// ===== Shared math helpers (deterministic, documented — never LLM-generated, §10) =====

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function companySizeBand(n: number | null): string | null {
  if (n === null || n === undefined) return null;
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  if (n <= 200) return "51-200";
  if (n <= 1000) return "201-1000";
  return "1000+";
}

/**
 * Computes real, explicit-denominator cohort stats (§13). `conversionRate`
 * is positiveOutcomes / (positiveOutcomes + negativeOutcomes) — i.e. "of
 * decided (WON or LOST) observations in this cohort", NEVER of the full
 * cohort (which may still contain open, undecided opportunities). Null when
 * no observation in the cohort has reached a decided outcome yet.
 */
export function computeCohortStats(observations: LearningObservation[]): CohortStats {
  const won = observations.filter((o) => o.outcome === "WON");
  const lost = observations.filter((o) => o.outcome === "LOST");
  const decided = won.length + lost.length;

  const dealSizes = won.map((o) => o.dealSize).filter((v): v is number => v !== null);
  const cycles = won.map((o) => o.salesCycleDays).filter((v): v is number => v !== null);
  const revenues = observations.map((o) => o.revenue).filter((v): v is number => v !== null);

  const timestamps = observations.map((o) => o.predictionTimestamp ?? o.createdAt).sort((a, b) => a.getTime() - b.getTime());

  return {
    sampleSize: observations.length,
    positiveOutcomes: won.length,
    negativeOutcomes: lost.length,
    conversionRate: decided > 0 ? won.length / decided : null,
    revenue: revenues.length > 0 ? revenues.reduce((a, b) => a + b, 0) : null,
    avgDealSize: average(dealSizes),
    medianDealSize: median(dealSizes),
    avgSalesCycleDays: average(cycles),
    medianSalesCycleDays: median(cycles),
    observationIds: observations.map((o) => o.id),
    timePeriodStart: timestamps[0] ?? new Date(),
    timePeriodEnd: timestamps[timestamps.length - 1] ?? new Date(),
  };
}

export function sampleClassification(stats: CohortStats, timeStability: number): LearningSampleClassification {
  const n = stats.sampleSize;
  if (n < LEARNING_CONFIG.MIN_SAMPLE_INSUFFICIENT) return "INSUFFICIENT_DATA";
  if (n < LEARNING_CONFIG.MIN_SAMPLE_OBSERVED) return "LOW_SAMPLE";
  if (n < LEARNING_CONFIG.MIN_SAMPLE_STRONG) return "OBSERVED";
  // STRONG_OBSERVATION additionally requires real stability across multiple
  // time windows, not just raw volume — a single huge burst is not the same
  // as a pattern that holds up over time (§52).
  return timeStability >= 0.6 ? "STRONG_OBSERVATION" : "OBSERVED";
}

/** Splits a cohort's observations into up to N roughly-equal time buckets by predictionTimestamp and compares each bucket's conversion rate — the real §52 "stability across periods" check. */
function computeTimeStability(observations: LearningObservation[]): number {
  const decided = observations.filter((o) => o.outcome === "WON" || o.outcome === "LOST");
  if (decided.length < 4) return 0.5; // too few decided outcomes to judge stability either way — neutral, not zero
  const sorted = [...decided].sort((a, b) => (a.predictionTimestamp ?? a.createdAt).getTime() - (b.predictionTimestamp ?? b.createdAt).getTime());
  const windows = Math.min(LEARNING_CONFIG.STABILITY_WINDOWS_REQUIRED, Math.floor(sorted.length / 2));
  if (windows < 2) return 0.5;
  const size = Math.floor(sorted.length / windows);
  const rates: number[] = [];
  for (let i = 0; i < windows; i++) {
    const chunk = sorted.slice(i * size, i === windows - 1 ? sorted.length : (i + 1) * size);
    const won = chunk.filter((o) => o.outcome === "WON").length;
    if (chunk.length > 0) rates.push(won / chunk.length);
  }
  if (rates.length < 2) return 0.5;
  const spread = Math.max(...rates) - Math.min(...rates);
  return Math.max(0, 1 - spread);
}

/** Splits the cohort's decided observations in half chronologically and compares conversion rate — do the outcomes stay directionally consistent, or flip? */
function computeOutcomeConsistency(observations: LearningObservation[]): number {
  const decided = observations.filter((o) => o.outcome === "WON" || o.outcome === "LOST");
  if (decided.length < 4) return 0.5;
  const sorted = [...decided].sort((a, b) => (a.predictionTimestamp ?? a.createdAt).getTime() - (b.predictionTimestamp ?? b.createdAt).getTime());
  const mid = Math.floor(sorted.length / 2);
  const first = sorted.slice(0, mid);
  const second = sorted.slice(mid);
  const rate1 = first.filter((o) => o.outcome === "WON").length / first.length;
  const rate2 = second.filter((o) => o.outcome === "WON").length / second.length;
  return Math.max(0, 1 - Math.abs(rate1 - rate2));
}

function computeDataCompleteness(observations: LearningObservation[]): number {
  if (observations.length === 0) return 0;
  const keyFields: Array<(o: LearningObservation) => unknown> = [
    (o) => o.industry,
    (o) => o.country,
    (o) => o.companySize,
    (o) => o.service,
    (o) => o.channel,
    (o) => o.decisionMakerRole,
    (o) => o.intentBand,
  ];
  const perObservation = observations.map((o) => keyFields.filter((f) => f(o) !== null && f(o) !== undefined).length / keyFields.length);
  return average(perObservation) ?? 0;
}

/** Does the same direction (won-rate above/below org baseline) still hold in the largest secondary sub-group of this cohort? Neutral (0.5) when there isn't a large-enough secondary split to check. */
function computeCrossCohortStability(observations: LearningObservation[], baselineRate: number | null): number {
  if (baselineRate === null) return 0.5;
  const bySecondary = new Map<string, LearningObservation[]>();
  for (const o of observations) {
    const key = o.leadSource ?? "UNKNOWN";
    if (!bySecondary.has(key)) bySecondary.set(key, []);
    bySecondary.get(key)!.push(o);
  }
  const groups = [...bySecondary.values()].filter((g) => g.filter((o) => o.outcome === "WON" || o.outcome === "LOST").length >= 2);
  if (groups.length === 0) return 0.5;
  const largest = groups.sort((a, b) => b.length - a.length)[0]!;
  const stats = computeCohortStats(largest);
  if (stats.conversionRate === null) return 0.5;
  const overallStats = computeCohortStats(observations);
  if (overallStats.conversionRate === null) return 0.5;
  const sameDirection = (overallStats.conversionRate >= baselineRate) === (stats.conversionRate >= baselineRate);
  return sameDirection ? 1 : 0;
}

export function computeConfidenceFactors(observations: LearningObservation[], baselineRate: number | null): ConfidenceFactors {
  const stats = computeCohortStats(observations);
  const sampleSizeFactor = Math.min(1, stats.sampleSize / LEARNING_CONFIG.MIN_SAMPLE_OBSERVED);
  const outcomeConsistency = computeOutcomeConsistency(observations);
  const timeStability = computeTimeStability(observations);
  const dataCompleteness = computeDataCompleteness(observations);
  const crossCohortStability = computeCrossCohortStability(observations, baselineRate);

  const weightedScore =
    CONFIDENCE_WEIGHTS.sampleSize * sampleSizeFactor +
    CONFIDENCE_WEIGHTS.outcomeConsistency * outcomeConsistency +
    CONFIDENCE_WEIGHTS.timeStability * timeStability +
    CONFIDENCE_WEIGHTS.dataCompleteness * dataCompleteness +
    CONFIDENCE_WEIGHTS.crossCohortStability * crossCohortStability;

  return { sampleSize: sampleSizeFactor, outcomeConsistency, timeStability, dataCompleteness, crossCohortStability, weightedScore };
}

export function confidenceBucket(weightedScore: number, classification: LearningSampleClassification): LearningConfidence {
  // A cohort below the OBSERVED floor can never be called MEDIUM/HIGH
  // confidence regardless of how tidy its (tiny) numbers look — sample size
  // is a hard gate, not just one weighted factor among others (§9).
  if (classification === "INSUFFICIENT_DATA" || classification === "LOW_SAMPLE") return "LOW";
  if (weightedScore >= LEARNING_CONFIG.CONFIDENCE_HIGH_CUTOFF) return "HIGH";
  if (weightedScore >= LEARNING_CONFIG.CONFIDENCE_MEDIUM_CUTOFF) return "MEDIUM";
  return "LOW";
}

// ===== Dimension extraction — each observation can belong to 0 or more buckets per dimension =====

interface DimensionSpec {
  key: string;
  patternType: LearningPatternType;
  /** true = pick WINNING_PATTERN/LOSING_PATTERN based on direction vs baseline; false = always use `patternType` regardless of direction. */
  directional: boolean;
  extract: (o: LearningObservation) => string[];
}

const single = (fn: (o: LearningObservation) => string | null | undefined) => (o: LearningObservation): string[] => {
  const v = fn(o);
  return v ? [v] : [];
};

const DIMENSIONS: DimensionSpec[] = [
  { key: "industry", patternType: "WINNING_PATTERN", directional: true, extract: single((o) => o.industry) },
  { key: "country", patternType: "WINNING_PATTERN", directional: true, extract: single((o) => o.country) },
  { key: "companySize", patternType: "WINNING_PATTERN", directional: true, extract: single((o) => companySizeBand(o.companySize)) },
  { key: "leadSource", patternType: "WINNING_PATTERN", directional: true, extract: single((o) => o.leadSource) },
  { key: "service", patternType: "SERVICE", directional: false, extract: single((o) => o.service) },
  { key: "channel", patternType: "CHANNEL", directional: false, extract: single((o) => o.channel) },
  { key: "decisionMakerRole", patternType: "DECISION_MAKER", directional: false, extract: single((o) => o.decisionMakerRole) },
  { key: "intentBand", patternType: "SIGNAL", directional: false, extract: single((o) => o.intentBand) },
  { key: "messageAngle", patternType: "MESSAGE_ANGLE", directional: false, extract: single((o) => o.messageAngle) },
  {
    key: "objection",
    patternType: "OBJECTION",
    directional: false,
    extract: (o) => {
      const rows = (o.objections as unknown as ObjectionSnapshot[]) ?? [];
      return [...new Set(rows.map((r) => r.type ?? r.value?.slice(0, 60) ?? null).filter((v): v is string => !!v))];
    },
  },
];

function describePattern(dimensionKey: string, value: string, stats: CohortStats, direction: "above" | "below" | "neutral"): string {
  const rateText = stats.conversionRate === null ? "no decided (won/lost) outcomes yet" : `${Math.round(stats.conversionRate * 100)}% observed conversion of ${stats.positiveOutcomes + stats.negativeOutcomes} decided outcome(s)`;
  const directionText = direction === "above" ? "above this org's overall baseline" : direction === "below" ? "below this org's overall baseline" : "";
  return `${dimensionKey} = "${value}": ${stats.sampleSize} observation(s), ${rateText}${directionText ? ` — ${directionText}` : ""}. Correlation observed — causality not established.`;
}

export interface DiscoverPatternsResult {
  patternsCreated: number;
  patternsUpdated: number;
  patternsRetired: number;
  discovered: DiscoveredPattern[];
}

/**
 * The core cohort pattern-discovery pass (§6). Iterates the fixed dimension
 * list above (never an unbounded combinatorial cross-product — same
 * bounded-dimension-set convention `revenue-attribution.ts`'s
 * getRevenueBy*() functions already use) plus a small curated set of
 * two-dimension combinations for higher-signal "winning pattern" style
 * cohorts. Every emitted pattern is gated at MIN_SAMPLE_TO_PERSIST — below
 * that there is nothing meaningful to even store, per-cohort or otherwise.
 */
export async function discoverPatterns(organizationId: string, runId: string | null): Promise<DiscoverPatternsResult> {
  const observations = await prisma.learningObservation.findMany({ where: { organizationId } });
  const overallStats = computeCohortStats(observations);
  const baselineRate = overallStats.conversionRate;

  const discovered: DiscoveredPattern[] = [];

  for (const dim of DIMENSIONS) {
    const buckets = new Map<string, LearningObservation[]>();
    for (const o of observations) {
      for (const value of dim.extract(o)) {
        if (!buckets.has(value)) buckets.set(value, []);
        buckets.get(value)!.push(o);
      }
    }

    for (const [value, obs] of buckets) {
      if (obs.length < LEARNING_CONFIG.MIN_SAMPLE_TO_PERSIST) continue;
      const stats = computeCohortStats(obs);
      const factors = computeConfidenceFactors(obs, baselineRate);
      const classification = sampleClassification(stats, factors.timeStability);
      const confidence = confidenceBucket(factors.weightedScore, classification);

      let patternType = dim.patternType;
      let direction: "above" | "below" | "neutral" = "neutral";
      if (dim.directional) {
        if (stats.conversionRate !== null && baselineRate !== null) {
          direction = stats.conversionRate >= baselineRate ? "above" : "below";
          patternType = direction === "above" ? "WINNING_PATTERN" : "LOSING_PATTERN";
        } else {
          patternType = "WINNING_PATTERN"; // undecided direction — display leans on classification/confidence to convey "not yet meaningful"
        }
      }

      discovered.push({
        patternType,
        name: `${dim.key}: ${value}`,
        description: describePattern(dim.key, value, stats, direction),
        conditions: [{ dimension: dim.key, value }],
        cohort: { [dim.key]: value },
        stats,
        sampleClassification: classification,
        confidence,
        confidenceFactors: factors,
      });

      // A high-value / long-cycle / short-cycle pattern is emitted ADDITIONALLY
      // (not instead of) the primary pattern above, only when this cohort's
      // real numbers materially differ from the org baseline (§14, §52).
      if (overallStats.avgDealSize !== null && stats.avgDealSize !== null && stats.avgDealSize >= overallStats.avgDealSize * 1.25 && obs.length >= LEARNING_CONFIG.MIN_SAMPLE_TO_PERSIST) {
        discovered.push({
          patternType: "HIGH_VALUE",
          name: `${dim.key}: ${value} (high value)`,
          description: `${dim.key} = "${value}": average won deal size ₹${Math.round(stats.avgDealSize).toLocaleString("en-IN")} vs org baseline ₹${Math.round(overallStats.avgDealSize).toLocaleString("en-IN")}. Correlation observed — causality not established.`,
          conditions: [{ dimension: dim.key, value }],
          cohort: { [dim.key]: value },
          stats,
          sampleClassification: classification,
          confidence,
          confidenceFactors: factors,
        });
      }
      if (overallStats.avgSalesCycleDays !== null && stats.avgSalesCycleDays !== null) {
        if (stats.avgSalesCycleDays >= overallStats.avgSalesCycleDays * 1.5) {
          discovered.push({
            patternType: "LONG_SALES_CYCLE",
            name: `${dim.key}: ${value} (long cycle)`,
            description: `${dim.key} = "${value}": average sales cycle ${Math.round(stats.avgSalesCycleDays)} days vs org baseline ${Math.round(overallStats.avgSalesCycleDays)} days. Correlation observed — causality not established.`,
            conditions: [{ dimension: dim.key, value }],
            cohort: { [dim.key]: value },
            stats,
            sampleClassification: classification,
            confidence,
            confidenceFactors: factors,
          });
        } else if (stats.avgSalesCycleDays <= overallStats.avgSalesCycleDays * 0.6) {
          discovered.push({
            patternType: "SHORT_SALES_CYCLE",
            name: `${dim.key}: ${value} (short cycle)`,
            description: `${dim.key} = "${value}": average sales cycle ${Math.round(stats.avgSalesCycleDays)} days vs org baseline ${Math.round(overallStats.avgSalesCycleDays)} days. Correlation observed — causality not established.`,
            conditions: [{ dimension: dim.key, value }],
            cohort: { [dim.key]: value },
            stats,
            sampleClassification: classification,
            confidence,
            confidenceFactors: factors,
          });
        }
      }
    }
  }

  // ===== Curated 2-dimension combinations — the "SaaS + CTO" style pattern
  // the spec's own example describes. Kept to a small, fixed set (not a
  // full cross-product) so pattern count stays bounded as data grows. =====
  const combos: Array<[DimensionSpec, DimensionSpec]> = [
    [DIMENSIONS[0]!, DIMENSIONS[6]!], // industry + decisionMakerRole
    [DIMENSIONS[4]!, DIMENSIONS[5]!], // service + channel
    [DIMENSIONS[0]!, DIMENSIONS[8]!], // industry + messageAngle
  ];
  for (const [dimA, dimB] of combos) {
    const pairBuckets = new Map<string, { obs: LearningObservation[]; a: string; b: string }>();
    for (const o of observations) {
      for (const a of dimA.extract(o)) {
        for (const b of dimB.extract(o)) {
          const key = `${a}|||${b}`;
          if (!pairBuckets.has(key)) pairBuckets.set(key, { obs: [], a, b });
          pairBuckets.get(key)!.obs.push(o);
        }
      }
    }
    for (const { obs, a, b } of pairBuckets.values()) {
      if (obs.length < LEARNING_CONFIG.MIN_SAMPLE_TO_PERSIST) continue;
      const stats = computeCohortStats(obs);
      const factors = computeConfidenceFactors(obs, baselineRate);
      const classification = sampleClassification(stats, factors.timeStability);
      const confidence = confidenceBucket(factors.weightedScore, classification);
      const direction = stats.conversionRate !== null && baselineRate !== null ? (stats.conversionRate >= baselineRate ? "above" : "below") : "neutral";
      const patternType: LearningPatternType = direction === "below" ? "LOSING_PATTERN" : "WINNING_PATTERN";
      discovered.push({
        patternType,
        name: `${dimA.key}=${a} + ${dimB.key}=${b}`,
        description: `${dimA.key} = "${a}" AND ${dimB.key} = "${b}": ${describePattern("combination", `${a} + ${b}`, stats, direction as "above" | "below" | "neutral")}`,
        conditions: [
          { dimension: dimA.key, value: a },
          { dimension: dimB.key, value: b },
        ],
        cohort: { [dimA.key]: a, [dimB.key]: b },
        stats,
        sampleClassification: classification,
        confidence,
        confidenceFactors: factors,
      });
    }
  }

  const result = await persistPatterns(organizationId, discovered, runId);
  return { ...result, discovered };
}

async function persistPatterns(organizationId: string, discovered: DiscoveredPattern[], runId: string | null): Promise<{ patternsCreated: number; patternsUpdated: number; patternsRetired: number }> {
  const existing = await prisma.learningPattern.findMany({ where: { organizationId, status: { not: "RETIRED" } } });
  const existingByName = new Map(existing.map((p) => [p.name, p]));
  const seenNames = new Set<string>();

  let created = 0;
  let updated = 0;

  for (const p of discovered) {
    seenNames.add(p.name);
    const prior = existingByName.get(p.name);
    const data = {
      organizationId,
      patternType: p.patternType,
      name: p.name,
      description: p.description,
      conditions: p.conditions as unknown as Prisma.InputJsonValue,
      cohort: p.cohort as unknown as Prisma.InputJsonValue,
      sampleSize: p.stats.sampleSize,
      positiveOutcomes: p.stats.positiveOutcomes,
      negativeOutcomes: p.stats.negativeOutcomes,
      conversionRate: p.stats.conversionRate,
      revenue: p.stats.revenue,
      avgDealSize: p.stats.avgDealSize,
      medianDealSize: p.stats.medianDealSize,
      avgSalesCycleDays: p.stats.avgSalesCycleDays,
      medianSalesCycleDays: p.stats.medianSalesCycleDays,
      timePeriodStart: p.stats.timePeriodStart,
      timePeriodEnd: p.stats.timePeriodEnd,
      confidence: p.confidence,
      confidenceFactors: p.confidenceFactors as unknown as Prisma.InputJsonValue,
      sampleClassification: p.sampleClassification,
      minSampleThreshold: LEARNING_CONFIG.MIN_SAMPLE_OBSERVED,
      evidenceIds: p.stats.observationIds,
      computedByRunId: runId,
      lastObservedAt: new Date(),
    };

    if (prior) {
      // Trend: did the sample get bigger since last computed? A shrinking
      // sample means observations were reclassified/removed, not that the
      // pattern itself weakened — trend only ever compares raw counts.
      const trend = p.stats.sampleSize > prior.sampleSize ? "growing" : p.stats.sampleSize < prior.sampleSize ? "shrinking" : "stable";
      const status = p.sampleClassification === "INSUFFICIENT_DATA" && prior.status === "ACTIVE" ? "WEAKENING" : prior.status === "EMERGING" && p.sampleClassification !== "INSUFFICIENT_DATA" ? "ACTIVE" : prior.status;
      await prisma.learningPattern.update({ where: { id: prior.id }, data: { ...data, trend, status, lastConfirmedAt: new Date() } });
      updated += 1;
    } else {
      await prisma.learningPattern.create({ data: { ...data, status: "EMERGING", firstDetectedAt: new Date() } });
      created += 1;
    }
  }

  // Retire patterns that no longer meet the persistence floor at all (§51 —
  // a pattern must not remain permanently "winning" once its evidence dries up).
  const toRetire = existing.filter((p) => !seenNames.has(p.name));
  if (toRetire.length > 0) {
    await prisma.learningPattern.updateMany({ where: { id: { in: toRetire.map((p) => p.id) } }, data: { status: "RETIRED" } });
  }

  return { patternsCreated: created, patternsUpdated: updated, patternsRetired: toRetire.length };
}
