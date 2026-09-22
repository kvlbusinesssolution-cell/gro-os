import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { companyProfileToPdfBuffer, type PdfCompanyProfile } from "@/lib/export/pdf";
import { companiesToCsv, companiesToCrmCsv, type ExportCompanyRow } from "@/lib/export/csv";
import { companiesToExcelBuffer } from "@/lib/export/excel";

const formatSchema = z.enum(["csv", "crm", "excel", "pdf"]).catch("pdf");

/** Auth-gated single Company Profile export — PDF report (default, unchanged), or the same CSV/CRM-CSV/Excel formats the companies list already offers, scoped to just this one company. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = formatSchema.parse(new URL(request.url).searchParams.get("format"));

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      leadScore: { select: { band: true, overallScore: true } },
      intelligenceRuns: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: company.organizationId } },
  });
  if (!membership || membership.status !== "ACTIVE") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (format === "csv" || format === "crm" || format === "excel") {
    const row: ExportCompanyRow = {
      name: company.name,
      industry: company.industry,
      website: company.website,
      email: company.email,
      phone: company.phone,
      address: company.address,
      headquartersCity: company.headquartersCity,
      headquartersState: company.headquartersState,
      headquartersCountry: company.headquartersCountry,
      employeeCount: company.employeeCount,
      estimatedRevenue: company.estimatedRevenue,
      foundedYear: company.foundedYear,
      status: company.status,
      priority: company.priority,
      source: company.source,
      leadScoreBand: company.leadScore?.band ?? null,
      leadScoreOverall: company.leadScore?.overallScore ?? null,
      technologies: company.technologies,
      createdAt: company.createdAt,
    };
    const safeName = company.name.replace(/[^a-z0-9]+/gi, "-");

    if (format === "excel") {
      const buffer = await companiesToExcelBuffer([row]);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
        },
      });
    }

    const csv = format === "crm" ? companiesToCrmCsv([row]) : companiesToCsv([row]);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName}${format === "crm" ? "-crm" : ""}.csv"`,
      },
    });
  }

  const latest = company.intelligenceRuns[0];
  const profile: PdfCompanyProfile = {
    name: company.name,
    industry: company.industry,
    website: company.website,
    email: company.email,
    phone: company.phone,
    address: company.address,
    headquartersCity: company.headquartersCity,
    headquartersState: company.headquartersState,
    headquartersCountry: company.headquartersCountry,
    employeeCount: company.employeeCount,
    estimatedRevenue: company.estimatedRevenue,
    foundedYear: company.foundedYear,
    status: company.status,
    priority: company.priority,
    source: company.source,
    leadScoreBand: company.leadScore?.band ?? null,
    leadScoreOverall: company.leadScore?.overallScore ?? null,
    technologies: company.technologies,
    createdAt: company.createdAt,
    description: company.description,
    targetCustomers: company.targetCustomers,
    products: company.products,
    servicesOffered: company.servicesOffered,
    latestIntelligence: latest
      ? {
          businessSummary: latest.businessSummary,
          confidenceScore: latest.confidenceScore,
          recommendedSolution: latest.recommendedSolution,
          estimatedProjectValue: latest.estimatedProjectValue,
        }
      : null,
  };

  const buffer = await companyProfileToPdfBuffer(profile);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${company.name.replace(/"/g, "")}-profile.pdf"`,
    },
  });
}
