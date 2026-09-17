import { prisma } from "@/lib/prisma";
import { KVL_SERVICES } from "@/lib/business-development/kvl-service-catalog";

/**
 * Phase 7 (AI Proposal & Deal Closing Intelligence) — real-data-only
 * grounding context for the AI Proposal Engine when drafting a proposal
 * FROM a qualified `LeadOpportunity`. Same discipline as
 * buildContactContext (src/lib/outreach/personalization.ts) and
 * buildOpportunityBrief (./opportunity-brief.ts): every section either
 * reports a real stored fact or honestly says "not available" — never
 * invents a pain point, conversation, decision maker, or company fact that
 * hasn't actually been researched/said. Read-time composition only, no AI
 * call in this function.
 *
 * Pulls together every real "conversation history / meeting notes /
 * customer requirements / previous communication" source this app already
 * has for the opportunity's company: the LeadOpportunity itself, the
 * latest CompanyIntelligence run, real Reply content (chronological, via
 * each Contact belonging to the company — Reply has no direct companyId),
 * real OutreachMeeting notes/agenda/topics, and named DecisionMakers.
 *
 * Returned as a single newline-joined string (not JSON) — the same shape
 * buildContactContext returns, fed straight into generateProposalSections'
 * `companyContext` param.
 */
export async function buildProposalContext(opportunityId: string): Promise<string | null> {
  const opportunity = await prisma.leadOpportunity.findUnique({
    where: { id: opportunityId },
    include: {
      company: {
        include: {
          contacts: true,
          decisionMakers: { orderBy: { confidence: "desc" }, take: 5 },
        },
      },
    },
  });
  if (!opportunity) return null;

  const company = opportunity.company;
  const sections: (string | null)[] = [];

  // ---- Company (real facts only) ----
  const companyFacts = [
    company.industry ? `Industry: ${company.industry}` : null,
    [company.headquartersCity, company.headquartersCountry].filter(Boolean).join(", ") || null,
    company.website ? `Website: ${company.website}` : null,
    company.employeeCount ? `Approx. ${company.employeeCount} employees` : null,
  ].filter((fact): fact is string => Boolean(fact));
  sections.push(`Company: ${company.name}${companyFacts.length ? `\n${companyFacts.join("\n")}` : "\nNo further company profile facts recorded yet."}`);

  // ---- Qualified Opportunity (real LeadOpportunity fields) ----
  const oppParts = [
    `Detected problem: ${opportunity.description}`,
    `Evidence: ${opportunity.evidence}`,
    opportunity.recommendedService ? `Recommended KVL service: ${serviceLabel(opportunity.recommendedService)}` : "Recommended service: not yet matched.",
    opportunity.serviceMatchReason ? `Why this service: ${opportunity.serviceMatchReason}` : null,
    opportunity.salesAngle ? `Sales angle: ${opportunity.salesAngle}` : null,
    opportunity.nextStep ? `Suggested next step: ${opportunity.nextStep}` : null,
    opportunity.estimatedValue != null
      ? `Estimated deal value (real, already sized on this opportunity): ${opportunity.estimatedValue}`
      : "Estimated deal value: not yet sized — do not state or invent a number.",
  ].filter((part): part is string => Boolean(part));
  sections.push(`Qualified Opportunity: ${opportunity.title}\n${oppParts.join("\n")}`);

  // ---- Company Intelligence (real, or honest fallback) ----
  const intelligence = await prisma.companyIntelligence.findFirst({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
  });
  if (intelligence) {
    const intelParts = [
      intelligence.businessSummary ? `Business summary: ${intelligence.businessSummary}` : null,
      intelligence.potentialPainPoints.length ? `Known pain points: ${intelligence.potentialPainPoints.join("; ")}` : null,
      intelligence.recommendedSolution ? `AI-recommended solution direction: ${intelligence.recommendedSolution}` : null,
      intelligence.estimatedProjectValue != null
        ? `AI-estimated project value (reference only, not authoritative — never treat as a final price): ${intelligence.estimatedProjectValue}`
        : null,
    ].filter((part): part is string => Boolean(part));
    sections.push(intelParts.length > 0 ? `Company Intelligence:\n${intelParts.join("\n")}` : "Company Intelligence: report exists but has no further real signals recorded.");
  } else {
    sections.push("Company Intelligence: no AI Company Intelligence report generated yet for this company.");
  }

  // ---- Named decision makers (real, verified) ----
  if (company.decisionMakers.length > 0) {
    const lines = company.decisionMakers.map((dm) => `- ${dm.name} (${dm.role})`);
    sections.push(`Known decision makers:\n${lines.join("\n")}`);
  } else {
    sections.push("Known decision makers: none verified yet for this company.");
  }

  // ---- Real communication history + meeting notes (via Contact.companyId — Reply/OutreachMeeting have no direct companyId) ----
  const contactIds = company.contacts.map((c) => c.id);
  if (contactIds.length > 0) {
    const replies = await prisma.reply.findMany({
      where: { contactId: { in: contactIds } },
      orderBy: { receivedAt: "asc" },
      include: { contact: true },
    });
    if (replies.length > 0) {
      const lines = replies.map((reply) => {
        const date = reply.receivedAt.toISOString().slice(0, 10);
        const contactName = [reply.contact.firstName, reply.contact.lastName].filter(Boolean).join(" ");
        return `- [${date}] ${contactName}: ${reply.content}${reply.intent ? ` (intent: ${reply.intent})` : ""}`;
      });
      sections.push(`Real communication history (actual replies received, chronological):\n${lines.join("\n")}`);
    } else {
      sections.push("Real communication history: no replies logged yet for this company's contacts.");
    }

    const meetings = await prisma.outreachMeeting.findMany({
      where: { contactId: { in: contactIds } },
      orderBy: { createdAt: "asc" },
    });
    const meetingsWithNotes = meetings.filter(
      (meeting) => (meeting.notes && meeting.notes.trim().length > 0) || (meeting.agenda && meeting.agenda.trim().length > 0) || meeting.discussionTopics.length > 0,
    );
    if (meetingsWithNotes.length > 0) {
      const lines = meetingsWithNotes.map((meeting) => {
        const parts = [
          meeting.title,
          meeting.agenda ? `Agenda: ${meeting.agenda}` : null,
          meeting.discussionTopics.length ? `Topics: ${meeting.discussionTopics.join(", ")}` : null,
          meeting.notes ? `Notes: ${meeting.notes}` : null,
        ].filter(Boolean);
        return `- ${parts.join(" | ")}`;
      });
      sections.push(`Real meeting notes:\n${lines.join("\n")}`);
    } else {
      sections.push("Real meeting notes: no meeting notes recorded yet for this company's contacts.");
    }
  } else {
    sections.push("Real communication history: no contacts on file for this company yet.");
    sections.push("Real meeting notes: no contacts on file for this company yet.");
  }

  return sections.filter((section): section is string => Boolean(section)).join("\n\n");
}

function serviceLabel(serviceId: string): string {
  const service = KVL_SERVICES.find((s) => s.id === serviceId);
  return service?.label ?? serviceId;
}
