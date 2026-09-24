/**
 * Prospeo — real person/email enrichment API (https://prospeo.io/api-docs/).
 * Platform-level, env-var-configured (PROSPEO_API_KEY) — same convention as
 * hunter-io.ts. Real free tier: 100 credits/month, no time limit
 * (verified via Prospeo's own public pricing page, 2026-09).
 *
 * Wired as a fallback for findRealEmailForPerson (email-waterfall.ts) — a
 * genuinely different capability from Hunter/Abstract's job of VERIFYING an
 * email that's already on file: this finds a real work email from a
 * person's full name + company website when Hunter can't (unconfigured or
 * its own quota is exhausted), never invented from a locally-guessed
 * pattern.
 *
 * Response-shape note: Prospeo's public docs (2026-09) confirm the request
 * body and the general `{ error: boolean, ... }` envelope, and that a
 * "person object" is nested under the response for /enrich endpoints, but
 * do not publish a complete field-by-field JSON example. Parsing below is
 * therefore deliberately defensive — any response shape that doesn't
 * clearly contain a real email string returns `ok: false`, exactly like an
 * unconfigured/failed call, never a guessed or fabricated result.
 */

const PROSPEO_BASE = "https://api.prospeo.io";

export function isProspeoConfigured(): boolean {
  return Boolean(process.env.PROSPEO_API_KEY?.trim());
}

export interface ProspeoFindEmailResult {
  ok: boolean;
  email?: string | null;
  emailStatus?: string | null;
  error?: string;
}

interface ProspeoEnrichPersonResponse {
  error?: boolean;
  message?: string;
  response?: {
    email?: string | null;
    email_status?: string | null;
  } | null;
}

/** Real name+company-website -> most-likely-real-work-email lookup. `onlyVerified` (default true) restricts results to emails Prospeo itself has already confirmed deliverable, never an unverified guess. */
export async function prospeoFindEmail(fullName: string, companyWebsite: string, onlyVerified = true): Promise<ProspeoFindEmailResult> {
  const apiKey = process.env.PROSPEO_API_KEY;
  if (!apiKey) return { ok: false, error: "PROSPEO_API_KEY not configured" };

  try {
    const response = await fetch(`${PROSPEO_BASE}/enrich-person`, {
      method: "POST",
      headers: { "X-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ only_verified_email: onlyVerified, data: { full_name: fullName, company_website: companyWebsite } }),
    });
    const body = (await response.json().catch(() => ({}))) as ProspeoEnrichPersonResponse;
    if (!response.ok || body.error) return { ok: false, error: body.message ?? `HTTP ${response.status}` };

    const email = body.response?.email;
    if (!email) return { ok: false, error: "No email found" };

    return { ok: true, email, emailStatus: body.response?.email_status ?? null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface ProspeoEnrichPersonFullResult {
  ok: boolean;
  mobile?: string | null;
  linkedinUrl?: string | null;
  error?: string;
}

interface ProspeoEnrichPersonFullResponse {
  error?: boolean;
  message?: string;
  response?: {
    mobile?: string | null;
    linkedin_url?: string | null;
  } | null;
}

/**
 * Real name+company-website -> mobile number + LinkedIn profile URL lookup.
 * Kept as a SEPARATE call from prospeoFindEmail (not a shared/combined
 * request) — Prospeo's own pricing charges more credits for a mobile match
 * than for an email-only lookup, so email-only callers (email-waterfall.ts)
 * must never pay this higher cost just because this function exists.
 * Response-shape parsing is defensive for the same reason as
 * prospeoFindEmail: no clearly-real value returned means `ok: false`,
 * never a guessed result.
 */
export async function prospeoEnrichPersonFull(fullName: string, companyWebsite: string): Promise<ProspeoEnrichPersonFullResult> {
  const apiKey = process.env.PROSPEO_API_KEY;
  if (!apiKey) return { ok: false, error: "PROSPEO_API_KEY not configured" };

  try {
    const response = await fetch(`${PROSPEO_BASE}/enrich-person`, {
      method: "POST",
      headers: { "X-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ data: { full_name: fullName, company_website: companyWebsite } }),
    });
    const body = (await response.json().catch(() => ({}))) as ProspeoEnrichPersonFullResponse;
    if (!response.ok || body.error) return { ok: false, error: body.message ?? `HTTP ${response.status}` };

    const mobile = body.response?.mobile ?? null;
    const linkedinUrl = body.response?.linkedin_url ?? null;
    if (!mobile && !linkedinUrl) return { ok: false, error: "No mobile or LinkedIn URL found" };

    return { ok: true, mobile, linkedinUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
