/**
 * Phase 25 (decision-maker classification) — real, deterministic
 * buying-influence classification from job-title keywords, same
 * "documented lookup table, not an AI call" discipline as
 * enrichment.ts's SENIORITY_SIGNALS. Ordered most-specific-signal-first;
 * the first matching keyword wins. A title that matches nothing returns
 * UNKNOWN — never a guessed default.
 *
 * Distinct from DecisionMakerRole (a job-title taxonomy on the separate
 * DecisionMaker model, e.g. CEO/CTO/DIRECTOR) — this classifies real
 * *buying influence* (who actually controls/influences a purchase
 * decision), which several different job titles can map to the same way
 * (e.g. both a CFO and a Founder are commonly the real economic buyer).
 */
import type { ContactBuyerRole } from "@/generated/prisma/client";

const BUYER_ROLE_SIGNALS: Array<{ keywords: string[]; role: ContactBuyerRole }> = [
  { keywords: ["founder", "co-founder", "cofounder", "ceo", "chief executive", "owner", "president", "cfo", "chief financial"], role: "ECONOMIC_BUYER" },
  { keywords: ["cto", "chief technology", "vp engineering", "vp of engineering", "engineering head", "head of engineering", "technical director", "it director", "it head", "head of it"], role: "TECHNICAL_BUYER" },
  { keywords: ["coo", "chief operating", "vp operations", "operations director", "vp sales", "sales director", "vp marketing", "marketing director", "head of sales", "head of marketing", "head of operations"], role: "BUSINESS_BUYER" },
  { keywords: ["director", "vp", "vice president", "head of", "head", "principal"], role: "EXECUTIVE" },
  { keywords: ["manager", "lead", "senior"], role: "INFLUENCER" },
];

/**
 * Real word-boundary match, not a bare substring check — a bare `includes`
 * check on a short acronym like "cto" would falsely match inside an
 * unrelated word (e.g. "Director" literally contains the substring "cto"),
 * a real false-positive bug caught by this phase's own test suite. Every
 * keyword, short or long, is matched as a whole word/phrase only.
 */
export function matchesWholeWord(haystack: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, "i").test(haystack);
}

/**
 * Distinct, narrower signal for CHAMPION — someone actively engaged
 * (replied/booked a meeting) rather than a title-only inference. Callers
 * that have real engagement signal should prefer this over the title-only
 * classifier below; this module only exposes the deterministic title-based
 * path, since engagement-based CHAMPION detection depends on real
 * interaction history the caller (not this pure function) owns.
 */
export function classifyBuyerRole(jobTitle: string | null | undefined): ContactBuyerRole {
  if (!jobTitle || !jobTitle.trim()) return "UNKNOWN";
  const padded = ` ${jobTitle.toLowerCase()} `;
  for (const row of BUYER_ROLE_SIGNALS) {
    if (row.keywords.some((kw) => matchesWholeWord(padded, kw))) return row.role;
  }
  return "UNKNOWN";
}
