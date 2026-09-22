/**
 * Phase 19 (AI Job Discovery + Job Matching Engine) — real provider
 * abstraction (§4). A provider's `status` must only ever be ACTIVE when
 * there is genuine evidence it works (§4: "Do not claim a provider is
 * active unless actual configuration/evidence exists") — never a hopeful
 * default.
 */
export type JobProviderStatus = "ACTIVE" | "DEGRADED" | "RATE_LIMITED" | "FAILED" | "BLOCKED" | "DISABLED" | "NOT_CONFIGURED";

export interface JobProviderSearchQuery {
  roles: string[];
  technologies: string[];
  remoteOnly: boolean;
}

export interface RawJobResult {
  sourceJobId: string;
  sourceUrl: string;
  canonicalUrl: string | null;
  title: string;
  company: string;
  location: string | null;
  description: string;
  technologies: string[];
  salaryText: string | null;
  postingDate: Date | null;
  rawSnapshot: Record<string, unknown>;
}

export interface JobProviderSearchResult {
  status: JobProviderStatus;
  jobs: RawJobResult[];
  error?: string;
  rateLimited?: boolean;
}

export interface JobProvider {
  name: string;
  /** Real, current status — checked fresh, never cached as a hopeful assumption. */
  getStatus(): JobProviderStatus;
  search(query: JobProviderSearchQuery): Promise<JobProviderSearchResult>;
}
