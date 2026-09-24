import PDFDocument from "pdfkit";

import type { ExportCompanyRow } from "./csv";

function collectPdfBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/** A clean, compact company-list PDF report — real stored fields only. */
export async function companiesToPdfBuffer(companies: ExportCompanyRow[], organizationName: string): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const bufferPromise = collectPdfBuffer(doc);

  doc.fontSize(18).text(`${organizationName} — Companies`, { align: "left" });
  doc.fontSize(10).fillColor("#666666").text(`Generated ${new Date().toLocaleString()} · ${companies.length} companies`);
  doc.moveDown(1);
  doc.fillColor("#000000");

  for (const c of companies) {
    doc.fontSize(12).fillColor("#000000").text(c.name, { continued: false });
    const details = [
      c.industry,
      c.headquartersCity || c.headquartersCountry ? [c.headquartersCity, c.headquartersCountry].filter(Boolean).join(", ") : null,
      c.website,
      c.email,
      c.leadScoreBand ? `Lead score: ${c.leadScoreBand}${c.leadScoreOverall != null ? ` (${c.leadScoreOverall})` : ""}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (details) doc.fontSize(9).fillColor("#666666").text(details);
    doc.moveDown(0.6);

    if (doc.y > doc.page.height - 100) doc.addPage();
  }

  doc.end();
  return bufferPromise;
}

export interface ReputationCertificateInput {
  businessName: string;
  city: string;
  category: string;
  averageRating: number;
  reviewCount: number;
  isVerified: boolean;
}

/**
 * JustDial-parity "Business Reputation / Rating Certificate" — a real,
 * dated PDF built entirely from a listing's own already-stored, real
 * review data (never AI-generated, never a number invented for the
 * occasion). Callers must ensure reviewCount > 0 before calling this — a
 * certificate for zero real reviews would have nothing real to certify.
 */
export async function businessReputationCertificateToPdfBuffer(input: ReputationCertificateInput): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 0, size: "A4", layout: "landscape" });
  const bufferPromise = collectPdfBuffer(doc);

  const { width, height } = doc.page;
  doc.rect(24, 24, width - 48, height - 48).lineWidth(2).strokeColor("#0f4c3a").stroke();
  doc.rect(34, 34, width - 68, height - 68).lineWidth(0.75).strokeColor("#0f4c3a").stroke();

  doc.fontSize(12).fillColor("#0f4c3a").text("KVL GROWTHOS", 0, 70, { align: "center" });
  doc.fontSize(28).fillColor("#111111").text("Certificate of Real Customer Reputation", 0, 100, { align: "center" });

  doc.moveDown(2);
  doc.fontSize(14).fillColor("#444444").text("This certifies that", 0, doc.y, { align: "center" });
  doc.fontSize(26).fillColor("#0f4c3a").text(input.businessName, { align: "center" });
  doc.fontSize(12).fillColor("#666666").text(`${input.category} · ${input.city}`, { align: "center" });

  doc.moveDown(1.5);
  const ratingLine = `has a real average rating of ${input.averageRating.toFixed(1)}/5, based on ${input.reviewCount} genuine customer review${input.reviewCount === 1 ? "" : "s"}`;
  doc.fontSize(14).fillColor("#111111").text(ratingLine, { align: "center" });
  if (input.isVerified) {
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor("#0f4c3a").text("Verified business on KVL GrowthOS", { align: "center" });
  }

  doc.moveDown(2);
  doc.fontSize(10).fillColor("#888888").text(`Issued ${new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}`, { align: "center" });
  doc.fontSize(9).fillColor("#aaaaaa").text("Every figure on this certificate reflects real, stored review data at the time of issue — not a marketing estimate.", { align: "center" });

  doc.end();
  return bufferPromise;
}

export interface PdfCompanyProfile extends ExportCompanyRow {
  description: string | null;
  targetCustomers: string | null;
  products: string[];
  servicesOffered: string[];
  latestIntelligence: {
    businessSummary: string;
    confidenceScore: number;
    recommendedSolution: string | null;
    estimatedProjectValue: number | null;
  } | null;
}

/** A single, detailed Company Profile PDF report — for the "Attach Research" / profile export use case. */
export async function companyProfileToPdfBuffer(company: PdfCompanyProfile): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 48, size: "A4" });
  const bufferPromise = collectPdfBuffer(doc);

  doc.fontSize(22).text(company.name);
  doc.fontSize(10).fillColor("#666666").text(`Report generated ${new Date().toLocaleString()}`);
  doc.moveDown(1);
  doc.fillColor("#000000");

  doc.fontSize(13).text("Overview");
  doc.fontSize(10).fillColor("#333333");
  const overviewLines = [
    company.industry ? `Industry: ${company.industry}` : null,
    company.headquartersCity || company.headquartersCountry
      ? `Headquarters: ${[company.headquartersCity, company.headquartersState, company.headquartersCountry].filter(Boolean).join(", ")}`
      : null,
    company.employeeCount != null ? `Employees: ${company.employeeCount}` : null,
    company.estimatedRevenue != null ? `Estimated revenue: $${company.estimatedRevenue.toLocaleString()}` : null,
    company.foundedYear ? `Founded: ${company.foundedYear}` : null,
    company.website ? `Website: ${company.website}` : null,
    company.email ? `Email: ${company.email}` : null,
    company.phone ? `Phone: ${company.phone}` : null,
    company.leadScoreBand ? `Lead score: ${company.leadScoreBand}${company.leadScoreOverall != null ? ` (${company.leadScoreOverall}/100)` : ""}` : null,
  ].filter(Boolean) as string[];
  for (const line of overviewLines) doc.text(line);
  doc.moveDown(0.8);
  doc.fillColor("#000000");

  if (company.description) {
    doc.fontSize(13).text("Description");
    doc.fontSize(10).fillColor("#333333").text(company.description);
    doc.moveDown(0.8);
    doc.fillColor("#000000");
  }

  if (company.technologies.length || company.products.length || company.servicesOffered.length) {
    doc.fontSize(13).text("Technology, products & services");
    doc.fontSize(10).fillColor("#333333");
    if (company.technologies.length) doc.text(`Technologies: ${company.technologies.join(", ")}`);
    if (company.products.length) doc.text(`Products: ${company.products.join(", ")}`);
    if (company.servicesOffered.length) doc.text(`Services: ${company.servicesOffered.join(", ")}`);
    doc.moveDown(0.8);
    doc.fillColor("#000000");
  }

  if (company.latestIntelligence) {
    doc.fontSize(13).text("AI Company Intelligence report (AI-generated)");
    doc.fontSize(10).fillColor("#333333");
    doc.text(`Confidence: ${Math.round(company.latestIntelligence.confidenceScore)}%`);
    doc.text(company.latestIntelligence.businessSummary);
    if (company.latestIntelligence.recommendedSolution) {
      doc.moveDown(0.4);
      doc.text(`Recommended solution: ${company.latestIntelligence.recommendedSolution}`);
    }
    if (company.latestIntelligence.estimatedProjectValue != null) {
      doc.text(`Estimated project value: $${company.latestIntelligence.estimatedProjectValue.toLocaleString()}`);
    }
    doc.fillColor("#000000");
  }

  doc.end();
  return bufferPromise;
}
