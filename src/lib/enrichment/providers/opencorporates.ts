/**
 * OpenCorporates — the world's largest open database of real, legally-filed
 * company registrations (https://api.opencorporates.com). Platform-level,
 * env-var-configured (OPENCORPORATES_API_TOKEN) — unauthenticated requests
 * are real but so rate-limited (a small shared global pool) that this
 * codebase never calls the API without a real registered token, per this
 * codebase's own "do not claim a provider is active unless real
 * configuration/evidence exists" discipline.
 *
 * Every fact returned here is a real government/registry filing — never an
 * AI guess — so callers (company-registry-waterfall.ts) always write it as
 * CompanyEvidence at confidence 1.0.
 */

const OC_BASE = "https://api.opencorporates.com/v0.4";

export function isOpenCorporatesConfigured(): boolean {
  return Boolean(process.env.OPENCORPORATES_API_TOKEN?.trim());
}

export interface OpenCorporatesCompany {
  name: string;
  companyNumber: string;
  jurisdictionCode: string;
  incorporationDate: string | null;
  currentStatus: string | null;
  registeredAddress: string | null;
  companyType: string | null;
  sourceUrl: string;
}

export interface OpenCorporatesSearchResult {
  ok: boolean;
  companies?: OpenCorporatesCompany[];
  error?: string;
}

interface OCApiCompany {
  name: string;
  company_number: string;
  jurisdiction_code: string;
  incorporation_date: string | null;
  current_status: string | null;
  registered_address_in_full: string | null;
  company_type: string | null;
  opencorporates_url: string;
}

/**
 * Searches by company name (optionally narrowed to a jurisdiction, e.g.
 * "gb" for the UK, "us_de" for Delaware) — real search results only, never
 * a fuzzy/invented match. Returns up to 5 candidates; the caller decides
 * which (if any) genuinely matches the target company.
 */
export async function openCorporatesSearch(name: string, jurisdictionCode?: string): Promise<OpenCorporatesSearchResult> {
  const token = process.env.OPENCORPORATES_API_TOKEN;
  if (!token) return { ok: false, error: "OPENCORPORATES_API_TOKEN not configured" };

  try {
    const params = new URLSearchParams({ q: name, api_token: token, per_page: "5" });
    if (jurisdictionCode) params.set("jurisdiction_code", jurisdictionCode);
    const response = await fetch(`${OC_BASE}/companies/search?${params.toString()}`);
    const body = (await response.json().catch(() => ({}))) as {
      results?: { companies?: Array<{ company: OCApiCompany }> };
      error?: { message?: string };
    };
    if (!response.ok) return { ok: false, error: body.error?.message ?? `HTTP ${response.status}` };

    const companies = (body.results?.companies ?? []).map(({ company }) => ({
      name: company.name,
      companyNumber: company.company_number,
      jurisdictionCode: company.jurisdiction_code,
      incorporationDate: company.incorporation_date,
      currentStatus: company.current_status,
      registeredAddress: company.registered_address_in_full,
      companyType: company.company_type,
      sourceUrl: company.opencorporates_url,
    }));
    return { ok: true, companies };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
