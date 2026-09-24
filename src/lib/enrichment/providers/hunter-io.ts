/**
 * Hunter.io — real email-finding/verification API (https://hunter.io/api-documentation/v2).
 * Platform-level, env-var-configured (HUNTER_IO_API_KEY) — same convention as
 * the AI provider files under src/lib/ai/providers/ (one shared key, not a
 * per-org Integration Hub connection), since this is infrastructure the
 * platform operator provisions once, not a customer-facing OAuth connection.
 *
 * Free tier is real but small (25 searches/month as of this integration) —
 * `hunterAccountStatus()` reads Hunter's own live quota from /v2/account
 * before every waterfall call so this codebase never blindly burns through
 * (or silently exceeds) that allowance; the waterfall orchestrator
 * (src/lib/enrichment/email-waterfall.ts) treats "quota exhausted" as a
 * real, honest reason to fall through to the next provider, never a
 * fabricated result.
 */

const HUNTER_BASE = "https://api.hunter.io/v2";

export function isHunterConfigured(): boolean {
  return Boolean(process.env.HUNTER_IO_API_KEY?.trim());
}

interface HunterAccountResponse {
  data?: {
    requests?: {
      searches?: { used: number; available: number };
      verifications?: { used: number; available: number };
    };
  };
  errors?: Array<{ details?: string }>;
}

export interface HunterAccountStatus {
  ok: boolean;
  searchesRemaining: number | null;
  verificationsRemaining: number | null;
  error?: string;
}

/** Real, live quota check — never a cached/guessed remaining count. */
export async function hunterAccountStatus(): Promise<HunterAccountStatus> {
  const apiKey = process.env.HUNTER_IO_API_KEY;
  if (!apiKey) return { ok: false, searchesRemaining: null, verificationsRemaining: null, error: "HUNTER_IO_API_KEY not configured" };

  try {
    const response = await fetch(`${HUNTER_BASE}/account?api_key=${encodeURIComponent(apiKey)}`);
    const body = (await response.json().catch(() => ({}))) as HunterAccountResponse;
    if (!response.ok) {
      return { ok: false, searchesRemaining: null, verificationsRemaining: null, error: body.errors?.[0]?.details ?? `HTTP ${response.status}` };
    }
    const searches = body.data?.requests?.searches;
    const verifications = body.data?.requests?.verifications;
    return {
      ok: true,
      searchesRemaining: searches ? searches.available - searches.used : null,
      verificationsRemaining: verifications ? verifications.available - verifications.used : null,
    };
  } catch (error) {
    return { ok: false, searchesRemaining: null, verificationsRemaining: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export type HunterVerifyResult = "deliverable" | "undeliverable" | "risky" | "unknown";

export interface HunterEmailVerification {
  ok: boolean;
  result?: HunterVerifyResult;
  score?: number;
  disposable?: boolean;
  webmail?: boolean;
  error?: string;
}

/** Real deliverability verification for one address — this is the first genuine (non-format-only) email verification this codebase has ever had. */
export async function hunterVerifyEmail(email: string): Promise<HunterEmailVerification> {
  const apiKey = process.env.HUNTER_IO_API_KEY;
  if (!apiKey) return { ok: false, error: "HUNTER_IO_API_KEY not configured" };

  try {
    const response = await fetch(`${HUNTER_BASE}/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(apiKey)}`);
    const body = (await response.json().catch(() => ({}))) as {
      data?: { result?: HunterVerifyResult; score?: number; disposable?: boolean; webmail?: boolean };
      errors?: Array<{ details?: string }>;
    };
    if (!response.ok) return { ok: false, error: body.errors?.[0]?.details ?? `HTTP ${response.status}` };
    return { ok: true, result: body.data?.result, score: body.data?.score, disposable: body.data?.disposable, webmail: body.data?.webmail };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface HunterDomainPerson {
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  confidence: number;
}

export interface HunterDomainSearchResult {
  ok: boolean;
  pattern?: string | null;
  people?: HunterDomainPerson[];
  error?: string;
}

/** Real domain-wide search — the company's actual email naming pattern plus any real named people Hunter has indexed for that domain (never invented). */
export async function hunterDomainSearch(domain: string): Promise<HunterDomainSearchResult> {
  const apiKey = process.env.HUNTER_IO_API_KEY;
  if (!apiKey) return { ok: false, error: "HUNTER_IO_API_KEY not configured" };

  try {
    const response = await fetch(`${HUNTER_BASE}/domain-search?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(apiKey)}`);
    const body = (await response.json().catch(() => ({}))) as {
      data?: { pattern?: string | null; emails?: Array<{ value: string; first_name: string | null; last_name: string | null; position: string | null; confidence: number }> };
      errors?: Array<{ details?: string }>;
    };
    if (!response.ok) return { ok: false, error: body.errors?.[0]?.details ?? `HTTP ${response.status}` };
    return {
      ok: true,
      pattern: body.data?.pattern ?? null,
      people: (body.data?.emails ?? []).map((e) => ({ email: e.value, firstName: e.first_name, lastName: e.last_name, position: e.position, confidence: e.confidence })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface HunterEmailFinderResult {
  ok: boolean;
  email?: string | null;
  score?: number;
  error?: string;
}

/** Real name+domain -> most-likely-real-email lookup, backed by Hunter's own pattern data — never a locally-guessed pattern. */
export async function hunterFindEmail(domain: string, firstName: string, lastName: string): Promise<HunterEmailFinderResult> {
  const apiKey = process.env.HUNTER_IO_API_KEY;
  if (!apiKey) return { ok: false, error: "HUNTER_IO_API_KEY not configured" };

  try {
    const params = new URLSearchParams({ domain, first_name: firstName, last_name: lastName, api_key: apiKey });
    const response = await fetch(`${HUNTER_BASE}/email-finder?${params.toString()}`);
    const body = (await response.json().catch(() => ({}))) as { data?: { email?: string | null; score?: number }; errors?: Array<{ details?: string }> };
    if (!response.ok) return { ok: false, error: body.errors?.[0]?.details ?? `HTTP ${response.status}` };
    return { ok: true, email: body.data?.email ?? null, score: body.data?.score };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
