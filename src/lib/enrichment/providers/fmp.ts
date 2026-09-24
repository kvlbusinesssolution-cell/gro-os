/**
 * Financial Modeling Prep (https://financialmodelingprep.com/developer/docs)
 * — real employee-count lookup. Platform-level, env-var-configured
 * (FMP_API_KEY) — same convention as wappalyzer.ts. Real free tier: 250
 * requests/day, free signup required (verified via FMP's own pricing
 * page, 2026-09).
 *
 * Coverage is genuinely limited to publicly-traded/SEC-reporting companies
 * (FMP's own symbol-based data model) — a private company simply has no
 * FMP symbol, which is treated as a real "not found," never a guess.
 */

const FMP_BASE = "https://financialmodelingprep.com/api/v3";

export function isFmpConfigured(): boolean {
  return Boolean(process.env.FMP_API_KEY?.trim());
}

interface FmpSearchResult {
  ok: boolean;
  symbol?: string | null;
  error?: string;
}

interface FmpSearchResponseItem {
  symbol?: string;
  name?: string;
}

/** Real company-name -> stock ticker symbol lookup — the first step before a profile lookup, since FMP's profile endpoint is keyed by symbol, not name. */
export async function fmpSearchSymbol(companyName: string): Promise<FmpSearchResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { ok: false, error: "FMP_API_KEY not configured" };

  try {
    const response = await fetch(`${FMP_BASE}/search?query=${encodeURIComponent(companyName)}&limit=1&apikey=${apiKey}`);
    const body = (await response.json().catch(() => ({}))) as FmpSearchResponseItem[] | { "Error Message"?: string };
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    if (!Array.isArray(body)) return { ok: false, error: body["Error Message"] ?? "Unexpected response shape" };
    if (body.length === 0 || !body[0].symbol) return { ok: false, error: "No matching symbol found" };

    return { ok: true, symbol: body[0].symbol };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface FmpCompanyProfileResult {
  ok: boolean;
  fullTimeEmployees?: number | null;
  error?: string;
}

interface FmpProfileResponseItem {
  symbol?: string;
  fullTimeEmployees?: string | number | null;
}

/** Real, reported full-time-employee count for a known symbol — never a range/estimate, the exact figure FMP itself has on file. */
export async function fmpCompanyProfile(symbol: string): Promise<FmpCompanyProfileResult> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return { ok: false, error: "FMP_API_KEY not configured" };

  try {
    const response = await fetch(`${FMP_BASE}/profile/${encodeURIComponent(symbol)}?apikey=${apiKey}`);
    const body = (await response.json().catch(() => ({}))) as FmpProfileResponseItem[] | { "Error Message"?: string };
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    if (!Array.isArray(body)) return { ok: false, error: body["Error Message"] ?? "Unexpected response shape" };
    if (body.length === 0) return { ok: false, error: "No profile found for this symbol" };

    const raw = body[0].fullTimeEmployees;
    const fullTimeEmployees = raw === null || raw === undefined || raw === "" ? null : Number(raw);
    if (fullTimeEmployees === null || Number.isNaN(fullTimeEmployees)) return { ok: false, error: "No employee count reported" };

    return { ok: true, fullTimeEmployees };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
