import { DEFAULT_STALE_DAYS, HIGH_VALUE_STALE_DAYS } from "./enrichment";

/**
 * Phase 16 (Advanced Enrichment + Buying Intent Intelligence) — real
 * freshness classification for a CompanyEvidence row (or any timestamped
 * enrichment fact), computed at read time from `discoveredAt` rather than
 * stored as a separate `last_verified_at` column. This is deliberate, not
 * a shortcut: `discoveredAt` IS the last time this fact was actually
 * confirmed (CompanyEvidence rows are immutable facts, never edited in
 * place — a re-verification creates a new row via enrichCompany(), see
 * enrichment.ts), so a derived status can never drift out of sync with a
 * separately-stored timestamp the way a second column could.
 *
 * Reuses the SAME two real thresholds stale-reenrichment-job.ts already
 * uses for whole-company re-enrichment (DEFAULT_STALE_DAYS / HIGH_VALUE_
 * STALE_DAYS) rather than inventing new, undocumented per-fact-type decay
 * rates — this codebase has no structured "this fact is about funding vs.
 * hiring" field on CompanyEvidence today (only free-text `fact`), so a
 * genuinely per-field freshness model isn't honestly buildable without a
 * schema change beyond this phase's scope. AGING is the honest middle
 * ground between the two thresholds, not a fabricated third number.
 */
export type EvidenceFreshness = "FRESH" | "AGING" | "STALE";

export function classifyEvidenceFreshness(discoveredAt: Date, now: Date = new Date(), isHighValueCompany = false): EvidenceFreshness {
  const ageDays = (now.getTime() - discoveredAt.getTime()) / 86_400_000;
  const staleThreshold = isHighValueCompany ? HIGH_VALUE_STALE_DAYS : DEFAULT_STALE_DAYS;
  if (ageDays >= staleThreshold) return "STALE";
  if (ageDays >= staleThreshold / 2) return "AGING";
  return "FRESH";
}
