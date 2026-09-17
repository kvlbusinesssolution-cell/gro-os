import type { DocumentBlueprint, DocumentSection } from "@/lib/documents";
import type { ProposalSections } from "@/lib/ai/document-engine";

export interface ProposalBlueprintInput {
  title: string;
  content: string;
  sections: ProposalSections | null;
  value: number | null;
  currency?: string | null;
  documentNumber: string;
  organizationName: string;
  logoUrl?: string | null;
  footerText?: string | null;
  gstNumber?: string | null;
  registrationNumber?: string | null;
  companyName?: string | null;
  contactName?: string | null;
  createdAt: Date;
}

function formatCurrencyValue(value: number, currency?: string | null): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency ?? ""} ${value.toLocaleString()}`.trim();
  }
}

/** Flattens the structured AI Proposal Engine output into readable plain text — kept on Proposal.content for backward compatibility with anything reading it directly (search, quick actions, older callers). */
export function flattenProposalSections(sections: ProposalSections): string {
  const parts: string[] = [];
  parts.push(`Executive Summary\n${sections.executiveSummary}`);
  if (sections.businessChallenges.length) parts.push(`Business Challenges\n${sections.businessChallenges.map((c) => `- ${c}`).join("\n")}`);
  if (sections.currentProblems.length) parts.push(`Current Problems\n${sections.currentProblems.map((c) => `- ${c}`).join("\n")}`);
  parts.push(`Recommended Solution\n${sections.recommendedSolution}`);
  if (sections.techStack.length) parts.push(`Technology Stack\n${sections.techStack.join(", ")}`);
  if (sections.architecture) parts.push(`Architecture\n${sections.architecture}`);
  if (sections.features.length) parts.push(`Features\n${sections.features.map((f) => `- ${f}`).join("\n")}`);
  if (sections.modules.length) parts.push(`Modules\n${sections.modules.map((m) => `- ${m}`).join("\n")}`);
  // Phase 7 sections — guarded (`?.`/`?.length`) since Proposal.sections is a
  // Json? column and rows generated before Phase 7 won't have these keys.
  if (sections.scope) parts.push(`Scope\n${sections.scope}`);
  if (sections.timeline.length) parts.push(`Timeline\n${sections.timeline.map((t) => `- ${t.phase} (${t.duration})${t.description ? `: ${t.description}` : ""}`).join("\n")}`);
  if (sections.deliverables.length) parts.push(`Deliverables\n${sections.deliverables.map((d) => `- ${d}`).join("\n")}`);
  if (sections.commercialStructure) parts.push(`Commercial Structure\n${sections.commercialStructure}`);
  if (sections.assumptions?.length) parts.push(`Assumptions\n${sections.assumptions.map((a) => `- ${a}`).join("\n")}`);
  if (sections.exclusions?.length) parts.push(`Exclusions\n${sections.exclusions.map((e) => `- ${e}`).join("\n")}`);
  if (sections.support) parts.push(`Support\n${sections.support}`);
  if (sections.warranty) parts.push(`Warranty\n${sections.warranty}`);
  if (sections.terms) parts.push(`Terms\n${sections.terms}`);
  if (sections.nextSteps?.length) parts.push(`Next Steps\n${sections.nextSteps.map((n) => `- ${n}`).join("\n")}`);
  parts.push(`Call To Action\n${sections.callToAction}`);
  return parts.join("\n\n");
}

/** Builds the DocumentBlueprint for a Proposal — consumed by both renderDocumentToPdf and renderDocumentToDocx (see src/lib/documents/). */
export function buildProposalBlueprint(input: ProposalBlueprintInput): DocumentBlueprint {
  const sections: DocumentSection[] = [];
  const s = input.sections;

  if (s) {
    sections.push({ heading: "Executive Summary", body: s.executiveSummary });
    if (s.businessChallenges.length) sections.push({ heading: "Business Challenges", bullets: s.businessChallenges });
    if (s.currentProblems.length) sections.push({ heading: "Current Problems", bullets: s.currentProblems });
    sections.push({ heading: "Recommended Solution", body: s.recommendedSolution });
    if (s.techStack.length || s.architecture) {
      sections.push({
        heading: "Technology & Architecture",
        body: s.architecture,
        bullets: s.techStack.length ? s.techStack : undefined,
      });
    }
    if (s.features.length) sections.push({ heading: "Features", bullets: s.features });
    if (s.modules.length) sections.push({ heading: "Modules", bullets: s.modules });
    if (s.scope) sections.push({ heading: "Scope", body: s.scope });
    if (s.timeline.length) {
      sections.push({
        heading: "Timeline",
        table: {
          headers: ["Phase", "Duration", "Description"],
          rows: s.timeline.map((t) => [t.phase, t.duration, t.description ?? ""]),
        },
      });
    }
    if (s.deliverables.length) sections.push({ heading: "Deliverables", bullets: s.deliverables });
    if (s.estimation.resources.length || s.estimation.milestones.length) {
      sections.push({
        heading: "Project Estimation",
        body: s.estimation.totalHours ? `Estimated total effort: ${s.estimation.totalHours} hours.` : undefined,
        table: s.estimation.resources.length
          ? { headers: ["Role", "Count"], rows: s.estimation.resources.map((r) => [r.role, r.count]), alignRightColumns: [1] }
          : undefined,
      });
      if (s.estimation.milestones.length) {
        sections.push({
          heading: "Milestones",
          table: {
            headers: ["Milestone", "Due", "Description"],
            rows: s.estimation.milestones.map((m) => [m.name, `Day ${m.dueOffsetDays}`, m.description ?? ""]),
          },
        });
      }
    }
    const supportWarrantyTerms = [
      s.support ? `Support: ${s.support}` : null,
      s.warranty ? `Warranty: ${s.warranty}` : null,
      s.terms ? `Terms: ${s.terms}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (s.commercialStructure) sections.push({ heading: "Commercial Structure", body: s.commercialStructure });
    if (s.assumptions?.length) sections.push({ heading: "Assumptions", bullets: s.assumptions });
    if (s.exclusions?.length) sections.push({ heading: "Exclusions", bullets: s.exclusions });
    if (supportWarrantyTerms) sections.push({ heading: "Support, Warranty & Terms", body: supportWarrantyTerms });
    const nextStepsBullets = s.nextSteps?.length ? s.nextSteps : undefined;
    sections.push({ heading: "Next Steps", body: s.callToAction, bullets: nextStepsBullets });
  } else {
    sections.push({ heading: "Proposal", body: input.content });
  }

  return {
    docKind: "PROPOSAL",
    title: input.title,
    subtitle: "Business Proposal",
    documentNumber: input.documentNumber,
    brand: {
      organizationName: input.organizationName,
      logoUrl: input.logoUrl,
      gstNumber: input.gstNumber,
      registrationNumber: input.registrationNumber,
    },
    preparedFor: input.contactName || input.companyName ? { name: input.contactName ?? input.companyName ?? "Client", company: input.companyName } : undefined,
    coverNote: "This proposal is confidential and prepared exclusively for the recipient above.",
    tableOfContents: true,
    sections,
    pricingTable: input.value != null ? { headers: ["Description", "Amount"], rows: [[input.title, formatCurrencyValue(input.value, input.currency)]], alignRightColumns: [1] } : undefined,
    totalsSummary: input.value != null ? [{ label: "Total", value: formatCurrencyValue(input.value, input.currency), emphasis: true }] : undefined,
    signatureBlock: { parties: [{ role: "Client", name: input.contactName ?? undefined }, { role: input.organizationName }] },
    footerText: input.footerText ?? input.organizationName,
    generatedAt: input.createdAt,
  };
}
