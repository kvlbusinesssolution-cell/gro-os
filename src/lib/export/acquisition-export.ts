import type { AcquisitionOverview } from "@/lib/analytics/acquisition-funnel";
import { COMPANY_SOURCE_LABEL } from "@/app/dashboard/analytics/_lib/acquisition-display";

// Same escape/row-join convention as campaignsToCsv in outreach-export.ts —
// reused verbatim rather than inventing a second CSV convention.
function escapeCsvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(escapeCsvCell).join(",");
}

function section(title: string, header: string[], rows: Array<Array<string | number | null | undefined>>): string[] {
  return [toRow([title]), toRow(header), ...rows.map(toRow), ""];
}

/**
 * Real-data-only CSV export of the Acquisition Overview's five breakdown
 * tables (bySource/byIndustry/byCountry/byService/byCampaign) from an
 * already-computed `AcquisitionOverview` (see computeAcquisitionOverview) —
 * one CSV file, five labeled sections, blank-line separated so it opens
 * cleanly in Excel/Sheets while staying a single download.
 */
export function acquisitionOverviewToCsv(overview: AcquisitionOverview): string {
  const lines: string[] = [];

  lines.push(toRow(["Total revenue (Won deals)", overview.totalRevenue]));
  lines.push("");

  lines.push(
    ...section(
      "By Source",
      ["Source", "Companies", "Qualified Leads", "Opportunities", "Meetings", "Proposals", "Won Deals", "Revenue"],
      overview.bySource.map((r) => [
        COMPANY_SOURCE_LABEL[r.source as keyof typeof COMPANY_SOURCE_LABEL] ?? r.source,
        r.companies,
        r.qualifiedLeads,
        r.opportunities,
        r.meetings,
        r.proposals,
        r.wonDeals,
        r.revenue,
      ]),
    ),
  );

  lines.push(
    ...section(
      "By Industry",
      ["Industry", "Companies", "Won Deals", "Revenue"],
      overview.byIndustry.map((r) => [r.industry, r.companies, r.wonDeals, r.revenue]),
    ),
  );

  lines.push(
    ...section(
      "By Country",
      ["Country", "Companies", "Won Deals", "Revenue"],
      overview.byCountry.map((r) => [r.country, r.companies, r.wonDeals, r.revenue]),
    ),
  );

  lines.push(
    ...section(
      "By Service",
      ["Service", "Opportunities", "Won Deals", "Revenue"],
      overview.byService.map((r) => [r.service, r.opportunities, r.wonDeals, r.revenue]),
    ),
  );

  lines.push(
    ...section(
      "By Campaign",
      ["Campaign", "Contacts Enrolled", "Emails Sent", "Replies", "Meetings", "Won Deals", "Revenue"],
      overview.byCampaign.map((r) => [r.campaignName, r.contactsEnrolled, r.emailsSent, r.replies, r.meetings, r.wonDeals, r.revenue]),
    ),
  );

  return lines.join("\r\n");
}
