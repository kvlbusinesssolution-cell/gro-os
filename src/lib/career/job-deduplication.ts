/**
 * Phase 19 (AI Job Discovery + Job Matching Engine) — real, deterministic
 * job deduplication (§8). Deliberately conservative: only merges when a
 * real, strong identity signal matches — never "titles look similar" alone
 * (§8 explicitly forbids that; different locations/companies with the same
 * title must stay distinct jobs).
 *
 * Identity hierarchy, checked in order — the FIRST one that matches wins:
 *   1. Same provider + same source job ID (the strongest possible signal —
 *      the source itself is telling us this is the same posting).
 *   2. Same canonicalUrl.
 *   3. Same normalized company + normalized title + normalized location.
 *   4. Strong description-similarity (Jaccard token overlap >= 0.85) AND
 *      same company AND posting dates within 14 real days of each other.
 */

export interface DedupCandidate {
  jobId: string;
  provider: string;
  sourceJobId: string;
  canonicalUrl: string | null;
  company: string;
  title: string;
  location: string | null;
  description: string;
  postingDate: Date | null;
}

export interface DedupInput {
  provider: string;
  sourceJobId: string;
  canonicalUrl: string | null;
  company: string;
  title: string;
  location: string | null;
  description: string;
  postingDate: Date | null;
}

function normalize(s: string | null): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z][a-z0-9+.#]{2,}/g) ?? []);
}

/** Real Jaccard similarity — intersection over union, a well-known, deterministic, non-ML similarity measure. */
function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const DESCRIPTION_SIMILARITY_THRESHOLD = 0.85;
const POSTING_DATE_WINDOW_DAYS = 14;

export interface DedupResult {
  duplicateOfJobId: string | null;
  matchedBy: "SOURCE_ID" | "CANONICAL_URL" | "COMPANY_TITLE_LOCATION" | "DESCRIPTION_SIMILARITY" | null;
}

export function findDuplicateJob(input: DedupInput, candidates: DedupCandidate[]): DedupResult {
  // 1. Same provider + same source job ID.
  const bySourceId = candidates.find((c) => c.provider === input.provider && c.sourceJobId === input.sourceJobId);
  if (bySourceId) return { duplicateOfJobId: bySourceId.jobId, matchedBy: "SOURCE_ID" };

  // 2. Same canonical URL.
  if (input.canonicalUrl) {
    const byUrl = candidates.find((c) => c.canonicalUrl === input.canonicalUrl);
    if (byUrl) return { duplicateOfJobId: byUrl.jobId, matchedBy: "CANONICAL_URL" };
  }

  // 3. Same normalized company + title + location.
  const byIdentity = candidates.find(
    (c) => normalize(c.company) === normalize(input.company) && normalize(c.title) === normalize(input.title) && normalize(c.location) === normalize(input.location),
  );
  if (byIdentity) return { duplicateOfJobId: byIdentity.jobId, matchedBy: "COMPANY_TITLE_LOCATION" };

  // 4. Strong description similarity + same company + nearby posting date.
  // Real location guard: "different locations may represent different
  // jobs" (§8) applies here too, not just to stage 3 — two DIFFERENT,
  // explicitly-stated locations must never be merged just because the
  // description text is similar (e.g. the same company posting the same
  // role in two real, different offices).
  for (const candidate of candidates) {
    if (normalize(candidate.company) !== normalize(input.company)) continue;
    const bothLocationsKnown = input.location && candidate.location;
    if (bothLocationsKnown && normalize(candidate.location) !== normalize(input.location)) continue;
    if (input.postingDate && candidate.postingDate) {
      const diffDays = Math.abs(input.postingDate.getTime() - candidate.postingDate.getTime()) / 86_400_000;
      if (diffDays > POSTING_DATE_WINDOW_DAYS) continue;
    }
    const similarity = jaccardSimilarity(input.description, candidate.description);
    if (similarity >= DESCRIPTION_SIMILARITY_THRESHOLD) {
      return { duplicateOfJobId: candidate.jobId, matchedBy: "DESCRIPTION_SIMILARITY" };
    }
  }

  return { duplicateOfJobId: null, matchedBy: null };
}
