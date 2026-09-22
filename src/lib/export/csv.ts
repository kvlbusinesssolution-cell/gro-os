/** Minimal, dependency-free CSV generation — RFC 4180 quoting, no external library needed for this shape of data. */

export interface ExportCompanyRow {
  name: string;
  industry: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  headquartersCity: string | null;
  headquartersState: string | null;
  headquartersCountry: string | null;
  employeeCount: number | null;
  estimatedRevenue: number | null;
  foundedYear: number | null;
  status: string;
  priority: string;
  source: string;
  leadScoreBand: string | null;
  leadScoreOverall: number | null;
  technologies: string[];
  createdAt: Date;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(escapeCsvCell).join(",");
}

export interface ExportPriorityQueueRow {
  companyName: string;
  industry: string | null;
  country: string | null;
  opportunityTitle: string;
  leadScore: number | null;
  intentScore: number | null;
  opportunityScore: number | null;
  priority: string | null;
  status: string;
  ownerName: string | null;
  nextAction: string;
  createdAt: Date;
}

/** Priority Queue export — exactly the rows/filters currently on screen (see /api/export/priority-queue). */
export function priorityQueueToCsv(rows: ExportPriorityQueueRow[]): string {
  const header = [
    "Company",
    "Industry",
    "Country",
    "Opportunity",
    "Lead Score",
    "Intent Score",
    "Opportunity Score",
    "Priority",
    "Status",
    "Owner",
    "Recommended Next Action",
    "Created At",
  ];
  const csvRows = rows.map((r) =>
    toRow([
      r.companyName,
      r.industry,
      r.country,
      r.opportunityTitle,
      r.leadScore,
      r.intentScore,
      r.opportunityScore,
      r.priority,
      r.status,
      r.ownerName,
      r.nextAction,
      r.createdAt.toISOString(),
    ]),
  );
  return [toRow(header), ...csvRows].join("\r\n");
}

/** Full-field export — every real stored profile field, one row per company. */
export function companiesToCsv(companies: ExportCompanyRow[]): string {
  const header = [
    "Name",
    "Industry",
    "Website",
    "Email",
    "Phone",
    "Address",
    "City",
    "State",
    "Country",
    "Employees",
    "Estimated Revenue",
    "Founded Year",
    "Status",
    "Priority",
    "Source",
    "Lead Score Band",
    "Lead Score",
    "Technologies",
    "Created At",
  ];
  const rows = companies.map((c) =>
    toRow([
      c.name,
      c.industry,
      c.website,
      c.email,
      c.phone,
      c.address,
      c.headquartersCity,
      c.headquartersState,
      c.headquartersCountry,
      c.employeeCount,
      c.estimatedRevenue,
      c.foundedYear,
      c.status,
      c.priority,
      c.source,
      c.leadScoreBand,
      c.leadScoreOverall,
      c.technologies.join("; "),
      c.createdAt.toISOString(),
    ]),
  );
  return [toRow(header), ...rows].join("\r\n");
}

/**
 * "CRM Export" — the same real data, mapped to the standard column names
 * most CRM bulk-import tools (Salesforce, HubSpot, Zoho) expect, so the file
 * can be dropped straight into an import wizard without renaming columns.
 */
export function companiesToCrmCsv(companies: ExportCompanyRow[]): string {
  const header = [
    "Company Name",
    "Website",
    "Industry",
    "Phone",
    "Email",
    "Billing Street",
    "Billing City",
    "Billing State",
    "Billing Country",
    "Number of Employees",
    "Annual Revenue",
    "Lead Status",
    "Lead Source",
    "Rating",
  ];
  const rows = companies.map((c) =>
    toRow([
      c.name,
      c.website,
      c.industry,
      c.phone,
      c.email,
      c.address,
      c.headquartersCity,
      c.headquartersState,
      c.headquartersCountry,
      c.employeeCount,
      c.estimatedRevenue,
      c.status,
      c.source,
      c.leadScoreBand,
    ]),
  );
  return [toRow(header), ...rows].join("\r\n");
}
