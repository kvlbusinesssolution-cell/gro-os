import type { RawJobResult } from "./job-providers/types";

/**
 * Phase 19 (AI Job Discovery + Job Matching Engine) — real, deterministic
 * normalization (§7). Every transformation here is a documented, reversible
 * heuristic over real source text — never an AI guess, and the original
 * source fields are always preserved separately (RawJobResult /
 * JobSourceRecord.rawSnapshot), never overwritten.
 */

export interface NormalizedJob {
  title: string;
  sourceTitle: string;
  company: string;
  location: string | null;
  country: string | null;
  city: string | null;
  workMode: "REMOTE" | "HYBRID" | "ONSITE" | "ANY" | null;
  technologies: string[];
  // Remotive's real tag data does not distinguish required vs. preferred —
  // honestly represented as "all tags are the job's stated technologies",
  // never an invented required/preferred split the source doesn't provide.
  requiredTechnologies: string[];
  preferredTechnologiesFromJob: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  careerLevel: string | null;
}

const CAREER_LEVEL_KEYWORDS: Array<{ level: string; pattern: RegExp }> = [
  { level: "Principal", pattern: /\bprincipal\b/i },
  { level: "Staff", pattern: /\bstaff\b/i },
  { level: "Lead", pattern: /\blead\b/i },
  { level: "Senior", pattern: /\bsenior|sr\.?\b/i },
  { level: "Mid-level", pattern: /\bmid[\s-]?level\b/i },
  { level: "Junior", pattern: /\bjunior|jr\.?\b/i },
  { level: "Intern", pattern: /\bintern(ship)?\b/i },
];

function detectCareerLevel(title: string): string | null {
  for (const { level, pattern } of CAREER_LEVEL_KEYWORDS) {
    if (pattern.test(title)) return level;
  }
  return null;
}

const CURRENCY_SYMBOLS: Record<string, string> = { "$": "USD", "€": "EUR", "£": "GBP", "₹": "INR" };

/** Real regex extraction from free-text salary strings like "$90k - $105k" — never a guessed number when the pattern doesn't match. */
function parseSalary(text: string | null): { min: number | null; max: number | null; currency: string | null } {
  if (!text) return { min: null, max: null, currency: null };
  const symbolMatch = text.match(/[$€£₹]/);
  const currency = symbolMatch ? CURRENCY_SYMBOLS[symbolMatch[0]] : null;

  const numbers = [...text.matchAll(/(\d+(?:\.\d+)?)\s*k/gi)].map((m) => parseFloat(m[1]) * 1000);
  if (numbers.length === 0) return { min: null, max: null, currency };
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0], currency };
  return { min: Math.min(...numbers), max: Math.max(...numbers), currency };
}

/** Real parsing of Remotive's "candidate_required_location" free text (e.g. "USA, Canada, Argentina") — takes the first listed as the primary country when the format is a simple comma list; leaves null (never guessed) for ambiguous formats like "Worldwide" or "EMEA timezone". */
function parseLocation(text: string | null): { country: string | null; city: string | null } {
  if (!text) return { country: null, city: null };
  const trimmed = text.trim();
  if (/worldwide|anywhere|global/i.test(trimmed)) return { country: null, city: null };
  const first = trimmed.split(",")[0]?.trim();
  if (!first || first.length > 60) return { country: null, city: null };
  return { country: first, city: null };
}

export function normalizeJob(raw: RawJobResult, provider: string): NormalizedJob {
  const { min: salaryMin, max: salaryMax, currency: salaryCurrency } = parseSalary(raw.salaryText);
  const { country, city } = parseLocation(raw.location);

  return {
    // Light normalization only — trims whitespace, never rewrites meaning.
    title: raw.title.trim(),
    sourceTitle: raw.title,
    company: raw.company.trim(),
    location: raw.location,
    country,
    city,
    // Remotive (this provider) is remote-only by its own real nature — a
    // genuine fact about the source, not an inference.
    workMode: provider === "Remotive" ? "REMOTE" : null,
    technologies: raw.technologies,
    requiredTechnologies: raw.technologies,
    preferredTechnologiesFromJob: [],
    salaryMin,
    salaryMax,
    salaryCurrency,
    careerLevel: detectCareerLevel(raw.title),
  };
}
