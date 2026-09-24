/**
 * UK Companies House — the UK government's own public register of companies
 * and their officers (https://developer.company-information.service.gov.uk).
 * Free, real, requires a free registered API key. Platform-level,
 * env-var-configured (UK_COMPANIES_HOUSE_API_KEY).
 *
 * This is the strongest "real decision-maker" data source in this codebase:
 * a Companies House officer is a legally-filed fact (a director a company
 * was required by UK law to register), not an AI web-search inference —
 * genuinely higher-confidence than decision-maker-discovery.ts's AI-search
 * pass. company-registry-waterfall.ts only ever calls this for a company
 * whose headquartersCountry is genuinely the United Kingdom.
 */

const CH_BASE = "https://api.company-information.service.gov.uk";

export function isCompaniesHouseConfigured(): boolean {
  return Boolean(process.env.UK_COMPANIES_HOUSE_API_KEY?.trim());
}

function authHeader(): string {
  // Companies House uses HTTP Basic Auth with the API key as the username
  // and an empty password — not a bearer token.
  const key = process.env.UK_COMPANIES_HOUSE_API_KEY ?? "";
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

export interface CompaniesHouseCompany {
  name: string;
  companyNumber: string;
  status: string | null;
  incorporationDate: string | null;
  registeredAddress: string | null;
  sourceUrl: string;
}

export interface CompaniesHouseSearchResult {
  ok: boolean;
  companies?: CompaniesHouseCompany[];
  error?: string;
}

export async function companiesHouseSearch(name: string): Promise<CompaniesHouseSearchResult> {
  if (!isCompaniesHouseConfigured()) return { ok: false, error: "UK_COMPANIES_HOUSE_API_KEY not configured" };

  try {
    const response = await fetch(`${CH_BASE}/search/companies?q=${encodeURIComponent(name)}&items_per_page=5`, {
      headers: { Authorization: authHeader() },
    });
    const body = (await response.json().catch(() => ({}))) as {
      items?: Array<{
        title: string;
        company_number: string;
        company_status?: string;
        date_of_creation?: string;
        address_snippet?: string;
      }>;
      error?: string;
    };
    if (!response.ok) return { ok: false, error: body.error ?? `HTTP ${response.status}` };

    const companies = (body.items ?? []).map((item) => ({
      name: item.title,
      companyNumber: item.company_number,
      status: item.company_status ?? null,
      incorporationDate: item.date_of_creation ?? null,
      registeredAddress: item.address_snippet ?? null,
      sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${item.company_number}`,
    }));
    return { ok: true, companies };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface CompaniesHouseOfficer {
  name: string;
  role: string;
  appointedOn: string | null;
  resignedOn: string | null;
  isCurrentlyActive: boolean;
}

export interface CompaniesHouseOfficersResult {
  ok: boolean;
  officers?: CompaniesHouseOfficer[];
  error?: string;
}

/** Real, legally-filed officer list for a company number — never invented, never a guessed role. */
export async function companiesHouseOfficers(companyNumber: string): Promise<CompaniesHouseOfficersResult> {
  if (!isCompaniesHouseConfigured()) return { ok: false, error: "UK_COMPANIES_HOUSE_API_KEY not configured" };

  try {
    const response = await fetch(`${CH_BASE}/company/${encodeURIComponent(companyNumber)}/officers?items_per_page=35`, {
      headers: { Authorization: authHeader() },
    });
    const body = (await response.json().catch(() => ({}))) as {
      items?: Array<{ name: string; officer_role: string; appointed_on?: string; resigned_on?: string }>;
      error?: string;
    };
    if (!response.ok) return { ok: false, error: body.error ?? `HTTP ${response.status}` };

    const officers = (body.items ?? []).map((item) => ({
      name: item.name,
      role: item.officer_role,
      appointedOn: item.appointed_on ?? null,
      resignedOn: item.resigned_on ?? null,
      isCurrentlyActive: !item.resigned_on,
    }));
    return { ok: true, officers };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
