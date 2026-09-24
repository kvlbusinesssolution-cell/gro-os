/**
 * Wappalyzer — real website technology-detection API
 * (https://www.wappalyzer.com/docs/api/v2/lookup/). Platform-level,
 * env-var-configured (WAPPALYZER_API_KEY) — same convention as
 * hunter-io.ts. Real free tier: 50 lookups/month (verified via Wappalyzer's
 * own public pricing, 2026-09).
 *
 * This codebase's own Website Scanner (src/lib/scanner/) already detects
 * technology from a full page render when a scan actually runs — this
 * provider is a lighter, independent signal used only when NO scan exists
 * yet for a company (see enrichCompanyTechnology in
 * src/lib/business-development/enrichment.ts), so a company can still get
 * a real, measured technology-change signal for intent-scoring.ts's
 * `technologyChange` source before its first full scan.
 */

const WAPPALYZER_BASE = "https://api.wappalyzer.com/v2";

export function isWappalyzerConfigured(): boolean {
  return Boolean(process.env.WAPPALYZER_API_KEY?.trim());
}

export interface WappalyzerTechnology {
  name: string;
  categories: string[];
}

export interface WappalyzerLookupResult {
  ok: boolean;
  technologies?: WappalyzerTechnology[];
  error?: string;
}

interface WappalyzerLookupResponseItem {
  url?: string;
  technologies?: Array<{ name?: string; categories?: Array<{ name?: string }> }>;
}

/** Real, live technology detection for one domain — never a cached/guessed stack. */
export async function wappalyzerLookup(domain: string): Promise<WappalyzerLookupResult> {
  const apiKey = process.env.WAPPALYZER_API_KEY;
  if (!apiKey) return { ok: false, error: "WAPPALYZER_API_KEY not configured" };

  const url = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;

  try {
    const response = await fetch(`${WAPPALYZER_BASE}/lookup/?urls=${encodeURIComponent(url)}`, {
      headers: { "x-api-key": apiKey },
    });
    const body = (await response.json().catch(() => ({}))) as WappalyzerLookupResponseItem[] | { error?: string };
    if (!response.ok) {
      const message = Array.isArray(body) ? `HTTP ${response.status}` : (body.error ?? `HTTP ${response.status}`);
      return { ok: false, error: message };
    }
    if (!Array.isArray(body) || body.length === 0) return { ok: false, error: "No result for this domain" };

    const technologies = (body[0].technologies ?? [])
      .filter((t): t is { name: string; categories?: Array<{ name?: string }> } => Boolean(t.name))
      .map((t) => ({ name: t.name, categories: (t.categories ?? []).map((c) => c.name).filter((n): n is string => Boolean(n)) }));

    return { ok: true, technologies };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
