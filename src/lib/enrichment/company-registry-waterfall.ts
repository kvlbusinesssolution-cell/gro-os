import { prisma } from "@/lib/prisma";
import { isOpenCorporatesConfigured, openCorporatesSearch } from "./providers/opencorporates";
import { isCompaniesHouseConfigured, companiesHouseSearch, companiesHouseOfficers } from "./providers/uk-companies-house";
import type { DataProvider } from "@/generated/prisma/client";

/**
 * Real legal-registry enrichment — the company-side half of the waterfall
 * (email-waterfall.ts is the contact-side half). Every fact written here is
 * a real government/registry filing, never an AI guess, so it's always
 * written at CompanyEvidence confidence 1.0.
 *
 * UK companies get the strongest treatment: Companies House officers are
 * real, legally-filed named individuals — written as real DecisionMaker
 * rows (source: "UK Companies House filing"), a genuinely higher-confidence
 * source than decision-maker-discovery.ts's AI web-search pass. Only
 * "director"-shaped roles become DecisionMaker rows (secretary/LLP-member
 * etc. are real officers but not meaningful sales decision-makers, so
 * creating a row for them would just be noise).
 */

export interface CompanyRegistryWaterfallResult {
  attempted: boolean;
  providerUsed: DataProvider | null;
  factsWritten: number;
  decisionMakersCreated: number;
}

async function logCall(organizationId: string, provider: DataProvider, target: string, succeeded: boolean, resultSummary: string): Promise<void> {
  try {
    await prisma.dataProviderCallLog.create({ data: { organizationId, provider, target, succeeded, resultSummary } });
  } catch (error) {
    console.error("[enrichment/company-registry-waterfall] failed to write call log:", error);
  }
}

function isUk(country: string | null): boolean {
  if (!country) return false;
  const normalized = country.trim().toLowerCase();
  return normalized === "united kingdom" || normalized === "uk" || normalized === "gb" || normalized === "great britain";
}

/** Idempotent — skip if an identical fact from this exact source already exists (a re-run shouldn't duplicate the same legal filing fact every time). Returns whether a new row was actually written, so callers' factsWritten counters reflect reality, not just how many facts were considered. */
async function writeEvidence(companyId: string, source: "OPENCORPORATES" | "UK_COMPANIES_HOUSE", fieldName: string, fact: string): Promise<boolean> {
  const existing = await prisma.companyEvidence.findFirst({ where: { companyId, source, fieldName, fact } });
  if (existing) return false;
  await prisma.companyEvidence.create({ data: { companyId, kind: "RAW_FACT", fact, source, confidence: 1.0, fieldName } });
  return true;
}

export async function enrichCompanyRegistry(companyId: string): Promise<CompanyRegistryWaterfallResult> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  let factsWritten = 0;
  let decisionMakersCreated = 0;

  if (isUk(company.headquartersCountry) && isCompaniesHouseConfigured()) {
    const search = await companiesHouseSearch(company.name);
    await logCall(company.organizationId, "UK_COMPANIES_HOUSE", company.name, search.ok, search.ok ? `${search.companies?.length ?? 0} match(es)` : (search.error ?? "unknown error"));

    const match = search.ok ? search.companies?.[0] : undefined;
    if (match) {
      if (await writeEvidence(companyId, "UK_COMPANIES_HOUSE", "legalName", `Registered legal name: "${match.name}" (Companies House #${match.companyNumber}).`)) factsWritten++;
      if (match.status) {
        if (await writeEvidence(companyId, "UK_COMPANIES_HOUSE", "registrationStatus", `Companies House registration status: ${match.status}.`)) factsWritten++;
      }
      if (match.incorporationDate) {
        if (await writeEvidence(companyId, "UK_COMPANIES_HOUSE", "incorporationDate", `Incorporated on ${match.incorporationDate} (Companies House filing).`)) factsWritten++;
      }
      if (match.registeredAddress) {
        if (await writeEvidence(companyId, "UK_COMPANIES_HOUSE", "registeredAddress", `Registered address: ${match.registeredAddress}.`)) factsWritten++;
      }

      const officersResult = await companiesHouseOfficers(match.companyNumber);
      await logCall(company.organizationId, "UK_COMPANIES_HOUSE", match.companyNumber, officersResult.ok, officersResult.ok ? `${officersResult.officers?.length ?? 0} officer(s)` : (officersResult.error ?? "unknown error"));

      if (officersResult.ok) {
        const activeDirectors = (officersResult.officers ?? []).filter((o) => o.isCurrentlyActive && o.role.toLowerCase().includes("director"));
        const existingDecisionMakers = await prisma.decisionMaker.findMany({ where: { companyId }, select: { id: true, name: true } });
        const existingByLowerName = new Map(existingDecisionMakers.map((row) => [row.name.trim().toLowerCase(), row.id]));

        for (const officer of activeDirectors) {
          const key = officer.name.trim().toLowerCase();
          const existingId = existingByLowerName.get(key);
          if (existingId) {
            // A real, higher-confidence legal filing corroborating an
            // already-known person — refresh confidence to 1.0 rather than
            // creating a duplicate row.
            await prisma.decisionMaker.update({
              where: { id: existingId },
              data: { confidence: 1.0, source: "UK Companies House filing", sourceUrl: match.sourceUrl, verifiedAt: new Date() },
            });
          } else {
            await prisma.decisionMaker.create({
              data: {
                companyId,
                name: officer.name,
                role: "DIRECTOR",
                source: "UK Companies House filing",
                sourceUrl: match.sourceUrl,
                confidence: 1.0,
              },
            });
            decisionMakersCreated++;
          }
        }
      }

      return { attempted: true, providerUsed: "UK_COMPANIES_HOUSE", factsWritten, decisionMakersCreated };
    }
  }

  if (isOpenCorporatesConfigured()) {
    const search = await openCorporatesSearch(company.name);
    await logCall(company.organizationId, "OPENCORPORATES", company.name, search.ok, search.ok ? `${search.companies?.length ?? 0} match(es)` : (search.error ?? "unknown error"));

    const match = search.ok ? search.companies?.[0] : undefined;
    if (match) {
      if (await writeEvidence(companyId, "OPENCORPORATES", "legalName", `Registered legal name: "${match.name}" (${match.jurisdictionCode.toUpperCase()} registry #${match.companyNumber}).`)) factsWritten++;
      if (match.currentStatus) {
        if (await writeEvidence(companyId, "OPENCORPORATES", "registrationStatus", `Registry status: ${match.currentStatus}.`)) factsWritten++;
      }
      if (match.incorporationDate) {
        if (await writeEvidence(companyId, "OPENCORPORATES", "incorporationDate", `Incorporated on ${match.incorporationDate} (${match.jurisdictionCode.toUpperCase()} company registry).`)) factsWritten++;
      }
      if (match.registeredAddress) {
        if (await writeEvidence(companyId, "OPENCORPORATES", "registeredAddress", `Registered address: ${match.registeredAddress}.`)) factsWritten++;
      }
      return { attempted: true, providerUsed: "OPENCORPORATES", factsWritten, decisionMakersCreated };
    }
  }

  return { attempted: false, providerUsed: null, factsWritten: 0, decisionMakersCreated: 0 };
}
