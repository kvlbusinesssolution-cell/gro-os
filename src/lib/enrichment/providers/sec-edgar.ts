/**
 * SEC EDGAR full-text search (https://www.sec.gov/edgar/search/) — real,
 * free, no API key required, no signup. Searches for a real, government-
 * filed Form D (private placement / funding-round notice) mentioning the
 * company name. US-only coverage (SEC jurisdiction) — a genuine, disclosed
 * limitation, never worked around by guessing.
 *
 * SEC's own fair-access policy (https://www.sec.gov/os/webmaster-faq#developers)
 * requires every request to carry a real, identifying User-Agent — never a
 * default/fake browser string. Configured via SEC_EDGAR_USER_AGENT; this
 * provider treats an unset value the same as "not configured," matching
 * this codebase's existing convention for every other provider (never
 * silently violate a provider's stated terms, same discipline as the
 * Remotive attribution requirement elsewhere in this codebase).
 */

const EDGAR_FULL_TEXT_SEARCH = "https://efts.sec.gov/LATEST/search-index?q=%22{query}%22&forms=D";

export function isSecEdgarConfigured(): boolean {
  return Boolean(process.env.SEC_EDGAR_USER_AGENT?.trim());
}

export interface SecEdgarFormDFiling {
  filingDate: string;
  accessionNumber: string;
  formType: string;
  entityName: string;
}

export interface SecEdgarFindFormDResult {
  ok: boolean;
  filings?: SecEdgarFormDFiling[];
  error?: string;
}

interface EdgarFullTextSearchHit {
  _source?: {
    file_date?: string;
    adsh?: string;
    root_forms?: string[];
    display_names?: string[];
  };
}

interface EdgarFullTextSearchResponse {
  hits?: {
    hits?: EdgarFullTextSearchHit[];
  };
}

/** Real Form D (private placement) filings mentioning this exact company name — never an inferred/estimated funding amount, only the disclosed filing itself. */
export async function edgarFindFormDFilings(companyName: string): Promise<SecEdgarFindFormDResult> {
  const userAgent = process.env.SEC_EDGAR_USER_AGENT;
  if (!userAgent) return { ok: false, error: "SEC_EDGAR_USER_AGENT not configured" };

  try {
    const url = EDGAR_FULL_TEXT_SEARCH.replace("{query}", encodeURIComponent(companyName));
    const response = await fetch(url, { headers: { "User-Agent": userAgent } });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };

    const body = (await response.json().catch(() => ({}))) as EdgarFullTextSearchResponse;
    const hits = body.hits?.hits ?? [];
    if (hits.length === 0) return { ok: true, filings: [] };

    const filings: SecEdgarFormDFiling[] = hits
      .filter((hit): hit is EdgarFullTextSearchHit & { _source: NonNullable<EdgarFullTextSearchHit["_source"]> } => Boolean(hit._source?.adsh && hit._source?.file_date))
      .map((hit) => ({
        filingDate: hit._source.file_date!,
        accessionNumber: hit._source.adsh!,
        formType: hit._source.root_forms?.[0] ?? "D",
        entityName: hit._source.display_names?.[0] ?? companyName,
      }));

    return { ok: true, filings };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
