import type { JobProvider, JobProviderSearchQuery, JobProviderSearchResult, JobProviderStatus, RawJobResult } from "./types";

/**
 * Phase 19 (AI Job Discovery + Job Matching Engine) — REAL provider adapter
 * for Remotive (remotive.com/api/remote-jobs). Verified this session via a
 * direct, real HTTP call (see Phase 19 report for the exact response):
 * public, free, no API key required, explicitly documented for
 * programmatic/developer use.
 *
 * §42 Source Compliance — Remotive's own API response includes a real
 * "0-legal-notice" field (read verbatim during this integration) requiring:
 *   1. Attribution — link back to the real Remotive job URL, credit
 *      Remotive as the source. Enforced structurally: `sourceUrl` below is
 *      always the real remotive.com URL, never rewritten, and every UI
 *      surface that shows a Job sourced from this provider must render
 *      "via Remotive" next to that link (see job detail/list pages).
 *   2. Rate limits — Remotive "advise[s] max. 4 times a day" and warns
 *      "excessive requests will be blocked". This adapter makes exactly
 *      ONE real HTTP request per search() call; the ORCHESTRATION layer
 *      (job-discovery.ts) is responsible for never calling search() more
 *      than once per real cooldown window — enforced there via
 *      JobDiscoveryRun history, not duplicated here.
 *   3. Not for "collecting signups/email addresses to show a listing" —
 *      this integration shows jobs only to the authenticated user they
 *      were matched for, inside their own real account, never as a public
 *      marketing listing.
 */
const REMOTIVE_API_URL = "https://remotive.com/api/remote-jobs";
const MAX_JOBS_PER_SEARCH = 30;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

interface RemotiveApiJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  tags: string[];
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
}

export function createRemotiveProvider(): JobProvider {
  return {
    name: "Remotive",

    getStatus(): JobProviderStatus {
      // No API key/config required — this provider is always ACTIVE unless
      // a real search() call reports otherwise (network/HTTP failure).
      return "ACTIVE";
    },

    async search(query: JobProviderSearchQuery): Promise<JobProviderSearchResult> {
      const searchTerm = query.roles[0] ?? query.technologies[0] ?? "";
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);

      let response: Response;
      try {
        response = await fetch(`${REMOTIVE_API_URL}${params.toString() ? `?${params.toString()}` : ""}`, {
          headers: { "User-Agent": "KVL-GrowthOS/1.0 (Phase 19 Career Agent; real, attributed, low-frequency use per Remotive API terms)" },
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        return { status: "FAILED", jobs: [], error: error instanceof Error ? error.message : "Network error contacting Remotive." };
      }

      if (response.status === 429) {
        return { status: "RATE_LIMITED", jobs: [], rateLimited: true, error: "Remotive returned 429 — rate limited." };
      }
      if (!response.ok) {
        return { status: "FAILED", jobs: [], error: `Remotive returned HTTP ${response.status}.` };
      }

      let data: { jobs?: RemotiveApiJob[] };
      try {
        data = await response.json();
      } catch {
        return { status: "FAILED", jobs: [], error: "Malformed JSON response from Remotive." };
      }

      const rawJobs = Array.isArray(data.jobs) ? data.jobs.slice(0, MAX_JOBS_PER_SEARCH) : [];

      const jobs: RawJobResult[] = rawJobs.map((j) => ({
        sourceJobId: String(j.id),
        sourceUrl: j.url,
        canonicalUrl: j.url,
        title: j.title,
        company: j.company_name,
        location: j.candidate_required_location || null,
        description: stripHtml(j.description ?? ""),
        technologies: Array.isArray(j.tags) ? j.tags : [],
        salaryText: j.salary || null,
        postingDate: j.publication_date ? new Date(j.publication_date) : null,
        rawSnapshot: {
          id: j.id,
          url: j.url,
          title: j.title,
          company_name: j.company_name,
          tags: j.tags,
          publication_date: j.publication_date,
          candidate_required_location: j.candidate_required_location,
          salary: j.salary,
        },
      }));

      return { status: "ACTIVE", jobs };
    },
  };
}
