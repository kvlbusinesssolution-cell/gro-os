import { prisma } from "@/lib/prisma";
import type { IntentBand, Prisma } from "@/generated/prisma/client";

/**
 * Intent Score — Phase 4, factor #2 of 3 ("How strong is the evidence the
 * company may need something NOW?"). Deliberately SEPARATE from LeadScore
 * (relevance/fit — src/lib/lead-scoring.ts, reused as-is, never recomputed
 * here) and from LeadOpportunity.opportunityScore
 * (src/lib/business-development/opportunity-priority.ts).
 *
 * PURE DETERMINISTIC COMPUTATION — no AI call. The inputs are already real,
 * already-AI-generated/measured data: CompanyIntelligence's growthSignals /
 * hiringSignals / expansionIndicators arrays (Phase 1, always labeled
 * "AI-generated" in the UI, never presented as verified fact upstream — we
 * simply count what's already there) plus CompanyEvidence RAW_FACT rows
 * that indicate a real, measured website problem (Phase 1's
 * website-intelligence.ts — e.g. "Performance score: 42/100").
 *
 * "No signal should be treated as intent without evidence": a company with
 * no CompanyIntelligence run and no CompanyEvidence rows scores exactly 0,
 * band NONE, with an honest reasoning sentence saying so — never padded.
 */

export interface IntentSignal {
  signal: string;
  source: "growthSignals" | "hiringSignals" | "expansionIndicators" | "companyEvidence";
  detail: string;
  points: number;
}

export interface IntentScoreComputation {
  score: number;
  band: IntentBand;
  signals: IntentSignal[];
  reasoning: string;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

// ----- Documented point weights -----
// Each entry in a CompanyIntelligence signal list represents one real,
// already-AI-extracted observation. Weighted by how directly each signal
// type implies imminent buying intent (hiring/expansion are closer to "may
// need something now" than a general growth mention), and capped per
// category so one long, repetitive AI list can't dominate the whole score.
const GROWTH_SIGNAL_POINTS = 8;
const GROWTH_SIGNAL_CAP = 32; // max 4 signals counted
const HIRING_SIGNAL_POINTS = 10;
const HIRING_SIGNAL_CAP = 30; // max 3 signals counted
const EXPANSION_SIGNAL_POINTS = 12;
const EXPANSION_SIGNAL_CAP = 36; // max 3 signals counted
const EVIDENCE_PROBLEM_POINTS = 6;
const EVIDENCE_PROBLEM_CAP = 24; // max 4 facts counted

// A website-intelligence RAW_FACT audit sub-score below this threshold
// counts as a real, measured problem (not a guess — the score itself is a
// deterministic measurement from src/lib/scanner/).
const POOR_SCORE_THRESHOLD = 50;

// Recency bonus/decay: a signal tied to intelligence/evidence gathered very
// recently (last 14 days) is more likely to still reflect the company's
// CURRENT situation than one from months ago — hiring pages get filled,
// website issues get fixed. Documented as a flat +10 bonus on top of the
// summed signal points when the *latest* CompanyIntelligence run (or, if
// none, the most recent CompanyEvidence row) is within the window; no
// penalty is applied for older data beyond simply not getting the bonus
// (we still trust older-but-real signals, just slightly less).
const RECENCY_WINDOW_DAYS = 14;
const RECENCY_BONUS = 10;

const THRESHOLDS = { HIGH: 70, MEDIUM: 40, LOW: 15 } as const;

function bandFor(score: number): IntentBand {
  if (score >= THRESHOLDS.HIGH) return "HIGH";
  if (score >= THRESHOLDS.MEDIUM) return "MEDIUM";
  if (score >= THRESHOLDS.LOW) return "LOW";
  return "NONE";
}

function extractAuditScore(fact: string): number | null {
  const match = fact.match(/^(SEO|Performance|UX|Security) score: (\d+)\/100$/);
  if (!match) return null;
  return Number(match[2]);
}

function isDaysAgo(date: Date, days: number): boolean {
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

export async function computeIntentScore(companyId: string): Promise<IntentScoreComputation | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) return null;

  const latestIntel = await prisma.companyIntelligence.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  });
  const evidenceRows = await prisma.companyEvidence.findMany({
    where: { companyId, kind: "RAW_FACT" },
    orderBy: { discoveredAt: "desc" },
  });

  const signals: IntentSignal[] = [];

  if (latestIntel) {
    let growthPoints = 0;
    for (const s of latestIntel.growthSignals) {
      if (growthPoints >= GROWTH_SIGNAL_CAP) break;
      const points = Math.min(GROWTH_SIGNAL_POINTS, GROWTH_SIGNAL_CAP - growthPoints);
      growthPoints += points;
      signals.push({ signal: "Growth signal", source: "growthSignals", detail: s, points });
    }

    let hiringPoints = 0;
    for (const s of latestIntel.hiringSignals) {
      if (hiringPoints >= HIRING_SIGNAL_CAP) break;
      const points = Math.min(HIRING_SIGNAL_POINTS, HIRING_SIGNAL_CAP - hiringPoints);
      hiringPoints += points;
      signals.push({ signal: "Hiring signal", source: "hiringSignals", detail: s, points });
    }

    let expansionPoints = 0;
    for (const s of latestIntel.expansionIndicators) {
      if (expansionPoints >= EXPANSION_SIGNAL_CAP) break;
      const points = Math.min(EXPANSION_SIGNAL_POINTS, EXPANSION_SIGNAL_CAP - expansionPoints);
      expansionPoints += points;
      signals.push({ signal: "Expansion indicator", source: "expansionIndicators", detail: s, points });
    }
  }

  let evidencePoints = 0;
  for (const e of evidenceRows) {
    if (evidencePoints >= EVIDENCE_PROBLEM_CAP) break;
    const auditScore = extractAuditScore(e.fact);
    if (auditScore === null || auditScore >= POOR_SCORE_THRESHOLD) continue;
    const points = Math.min(EVIDENCE_PROBLEM_POINTS, EVIDENCE_PROBLEM_CAP - evidencePoints);
    evidencePoints += points;
    signals.push({ signal: "Website problem evidence", source: "companyEvidence", detail: e.fact, points });
  }

  let subtotal = signals.reduce((sum, s) => sum + s.points, 0);

  // Recency bonus — only applied (once) when there's at least one real
  // signal to begin with, and only when the freshest source of those
  // signals falls inside the recency window.
  let recencyApplied = false;
  if (subtotal > 0) {
    const freshDates = [latestIntel?.createdAt, evidenceRows[0]?.discoveredAt].filter((d): d is Date => Boolean(d));
    const isFresh = freshDates.some((d) => isDaysAgo(d, RECENCY_WINDOW_DAYS));
    if (isFresh) {
      recencyApplied = true;
      subtotal += RECENCY_BONUS;
      signals.push({
        signal: "Recency bonus",
        source: latestIntel && isDaysAgo(latestIntel.createdAt, RECENCY_WINDOW_DAYS) ? "growthSignals" : "companyEvidence",
        detail: `Underlying signal data is within the last ${RECENCY_WINDOW_DAYS} days`,
        points: RECENCY_BONUS,
      });
    }
  }

  const score = clamp(subtotal);
  const band = bandFor(score);

  const reasoning =
    signals.length === 0
      ? "No buying-intent signals found — no growth/hiring/expansion signals in the latest company intelligence, and no website-problem evidence on record. Intent score is 0 (NONE)."
      : `Intent score ${score} (${band}), based on ${signals.length} real signal${signals.length === 1 ? "" : "s"}: ${signals
          .filter((s) => s.signal !== "Recency bonus")
          .map((s) => `${s.signal.toLowerCase()} ("${s.detail}", +${s.points})`)
          .join("; ")}${recencyApplied ? `; plus a +${RECENCY_BONUS} recency bonus since the underlying data is within the last ${RECENCY_WINDOW_DAYS} days.` : "."}`;

  const result: IntentScoreComputation = { score, band, signals, reasoning };

  await prisma.intentScore.upsert({
    where: { companyId },
    create: { companyId, score, band, signals: signals as unknown as Prisma.InputJsonValue, reasoning },
    update: { score, band, signals: signals as unknown as Prisma.InputJsonValue, reasoning, scoredAt: new Date() },
  });

  return result;
}
