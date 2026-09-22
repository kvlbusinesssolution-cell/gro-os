import { prisma } from "@/lib/prisma";
import { generateStructured } from "@/lib/ai/fallback";
import { isAIConnected } from "@/lib/ai/client";
import { z } from "zod";

import { getCompanyCompleteTimeline, type TimelineEntry } from "./company-complete-timeline";
import { summarizeCompanyConversation } from "./company-conversation-summary";
import { suggestNextActionForCompany } from "./company-next-action";

/**
 * Phase 5 (Client 360 / Account 360) — a pure READ-TIME aggregation layer
 * over existing source records. No new Company/Contact/Lead/Opportunity/
 * Deal model, no copied data — every field here is either a direct real
 * value or a thin composition of Phase 1-4's existing functions
 * (summarizeCompanyConversation, suggestNextActionForCompany,
 * getCompanyCompleteTimeline, ChurnRiskAssessment where a real Client
 * exists). Every fact is labeled CONFIRMED / INFERRED / UNKNOWN — never an
 * inference silently presented as a fact.
 */

export type Confidence = "CONFIRMED" | "INFERRED" | "UNKNOWN";

export interface GroundedField<T> {
  value: T | null;
  status: Confidence;
  source: string | null;
}

export interface LastContact {
  date: string;
  channel: string;
  direction: "INBOUND" | "OUTBOUND";
  recordType: string;
  recordId: string;
}

export interface NextAction {
  action: string;
  kind: "SYSTEM_ACTION" | "SYSTEM_SUGGESTION" | "AI_RECOMMENDATION";
  taskId: string | null;
}

export interface RiskAssessment {
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
  status: Confidence;
  reasons: string[];
  source: string | null;
}

export interface ClientSummary {
  currentSituation: GroundedField<string>;
  clientWants: GroundedField<string[]>;
  whatWePromised: GroundedField<string>;
  openIssues: GroundedField<string[]>;
  objections: GroundedField<string[]>;
  lastContact: LastContact | null;
  nextAction: NextAction;
  aiRecommendedAction: string | null;
  dealValue: GroundedField<number>;
  revenue: { invoiced: number; paid: number; source: Confidence };
  risk: RiskAssessment;
  /** Phase 11 §43 — a real, same-org LearningPattern this company's cohort matches. Always labeled HISTORICAL OBSERVATION, never a prediction/guarantee, and never cross-tenant. */
  historicalCohortObservation: GroundedField<string>;
}

const TERMINAL_TASK_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

/**
 * Phase 11 §43 — surfaces a real, same-org LearningPattern whose cohort
 * (industry/country/companySize) matches this company, ONLY when it has a
 * real sample (OBSERVED/STRONG_OBSERVATION) — never a LOW_SAMPLE/
 * INSUFFICIENT_DATA pattern, and never another organization's pattern.
 * Always framed as a historical observation, never a guarantee.
 */
async function deriveHistoricalCohortObservation(organizationId: string, companyId: string): Promise<GroundedField<string>> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { industry: true, headquartersCountry: true, employeeCount: true } });
  if (!company) return { value: null, status: "UNKNOWN", source: null };

  const cohortValues = new Set([company.industry, company.headquartersCountry].filter((v): v is string => !!v));
  if (cohortValues.size === 0) return { value: null, status: "UNKNOWN", source: null };

  const candidates = await prisma.learningPattern.findMany({
    where: {
      organizationId,
      status: { in: ["EMERGING", "ACTIVE"] },
      sampleClassification: { in: ["OBSERVED", "STRONG_OBSERVATION"] },
      patternType: { in: ["WINNING_PATTERN", "LOSING_PATTERN", "HIGH_VALUE"] },
    },
    orderBy: { sampleSize: "desc" },
    take: 50,
  });
  const pattern = candidates.find((p) => {
    const conditions = p.conditions as unknown as Array<{ dimension: string; value: string }>;
    return conditions.some((c) => (c.dimension === "industry" || c.dimension === "country") && cohortValues.has(c.value));
  });
  if (!pattern) return { value: null, status: "UNKNOWN", source: null };

  return {
    value: `HISTORICAL OBSERVATION (not a prediction or guarantee): this company's cohort matches "${pattern.name}" — ${pattern.description}`,
    status: "INFERRED",
    source: `LearningPattern ${pattern.id} (${pattern.sampleClassification}, ${pattern.confidence} confidence, n=${pattern.sampleSize}).`,
  };
}

/**
 * Real, deterministic "Current Situation" — reuses IntentScore.buyingStage
 * (Phase 2's existing lifecycle classification) rather than inventing a
 * second lifecycle state machine, extended with 2 real post-sale states
 * (DELIVERY/SUPPORT) Phase 2 never needed to cover.
 */
async function deriveCurrentSituation(organizationId: string, companyId: string): Promise<GroundedField<string>> {
  const intentScore = await prisma.intentScore.findUnique({ where: { companyId } });
  if (!intentScore) return { value: null, status: "UNKNOWN", source: null };

  if (intentScore.buyingStage === "CUSTOMER") {
    const activeProject = await prisma.project.findFirst({ where: { organizationId, companyId, status: { in: ["PLANNING", "ACTIVE"] } } });
    if (activeProject) return { value: "DELIVERY", status: "CONFIRMED", source: `Project ${activeProject.id} is ${activeProject.status}.` };
    const openSupportTask = await prisma.task.findFirst({ where: { organizationId, companyId, type: "SUPPORT", status: { notIn: Array.from(TERMINAL_TASK_STATUSES) as never[] } } });
    if (openSupportTask) return { value: "SUPPORT", status: "CONFIRMED", source: `Open support task ${openSupportTask.id}.` };
  }

  return { value: intentScore.buyingStage, status: "CONFIRMED", source: `IntentScore.buyingStage (${intentScore.buyingStageReasoning})` };
}

async function deriveLastContact(timeline: TimelineEntry[]): Promise<LastContact | null> {
  const contactTypes: Record<string, "INBOUND" | "OUTBOUND"> = {
    EMAIL_SENT: "OUTBOUND",
    REPLY_RECEIVED: "INBOUND",
    MEETING_SCHEDULED: "OUTBOUND",
    MEETING_COMPLETED: "OUTBOUND",
    CALL: "OUTBOUND",
  };
  const contactEvents = timeline.filter((e) => e.type in contactTypes).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const latest = contactEvents[0];
  if (!latest) return null;
  return {
    date: latest.occurredAt.toISOString(),
    channel: latest.type === "CALL" ? "Call" : latest.type.startsWith("MEETING") ? "Meeting" : "Email",
    direction: contactTypes[latest.type],
    recordType: latest.recordType,
    recordId: latest.recordId,
  };
}

async function deriveDealValue(organizationId: string, companyId: string): Promise<GroundedField<number>> {
  const deal = await prisma.deal.findFirst({ where: { organizationId, companyId, value: { not: null } }, orderBy: { createdAt: "desc" } });
  if (deal?.value) return { value: deal.value, status: "CONFIRMED", source: `Deal ${deal.id} ("${deal.name}").` };

  const opportunity = await prisma.leadOpportunity.findFirst({ where: { companyId, estimatedValue: { not: null } }, orderBy: { createdAt: "desc" } });
  if (opportunity?.estimatedValue) return { value: opportunity.estimatedValue, status: "CONFIRMED", source: `LeadOpportunity ${opportunity.id} ("${opportunity.title}").` };

  return { value: null, status: "UNKNOWN", source: null };
}

async function deriveRevenue(organizationId: string, companyId: string): Promise<{ invoiced: number; paid: number; source: Confidence }> {
  const invoices = await prisma.invoice.findMany({ where: { organizationId, companyId }, select: { grandTotal: true, amountPaid: true } });
  if (invoices.length === 0) return { invoiced: 0, paid: 0, source: "UNKNOWN" };
  return {
    invoiced: invoices.reduce((sum, i) => sum + i.grandTotal, 0),
    paid: invoices.reduce((sum, i) => sum + i.amountPaid, 0),
    source: "CONFIRMED",
  };
}

/**
 * Reuses the real ChurnRiskAssessment (already computed for an actual
 * Client — src/lib/clients/churn.ts) when this company has become one.
 * Before that, a company has no churn model to reuse, so this falls back
 * to a small, deterministic, evidence-only pre-sale risk check — never an
 * AI guess, and UNKNOWN (not a fabricated LOW) when there's no real signal
 * either way.
 */
async function deriveRisk(organizationId: string, companyId: string): Promise<RiskAssessment> {
  const client = await prisma.client.findFirst({ where: { organizationId, companyId } });
  if (client) {
    const churn = await prisma.churnRiskAssessment.findUnique({ where: { clientId: client.id } });
    if (churn) {
      return {
        level: churn.riskLevel,
        status: "CONFIRMED",
        reasons: Array.isArray(churn.reasons) ? (churn.reasons as string[]) : [String(churn.reasons)],
        source: `ChurnRiskAssessment for Client ${client.id}, computed ${churn.computedAt.toISOString()}.`,
      };
    }
  }

  const reasons: string[] = [];
  const staleOpportunity = await prisma.leadOpportunity.findFirst({
    where: { companyId, status: { not: "DISMISSED" }, createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
  });
  if (staleOpportunity) reasons.push(`Opportunity "${staleOpportunity.title}" has been open 30+ days with no resolution.`);

  const agingProposal = await prisma.proposal.findFirst({ where: { organizationId, companyId, status: "SENT", createdAt: { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } } });
  if (agingProposal) reasons.push(`Proposal "${agingProposal.title}" has been SENT for 14+ days with no response.`);

  const overdueInvoice = await prisma.invoice.findFirst({ where: { organizationId, companyId, status: "OVERDUE" } });
  if (overdueInvoice) reasons.push(`Invoice ${overdueInvoice.invoiceNumber} is OVERDUE.`);

  if (reasons.length === 0) return { level: "UNKNOWN", status: "UNKNOWN", reasons: [], source: null };
  const level = reasons.length >= 2 ? "HIGH" : "MEDIUM";
  return { level, status: "INFERRED", reasons, source: "Deterministic pre-sale risk check (no Client/ChurnRiskAssessment exists yet)." };
}

export async function buildClientSummary(organizationId: string, companyId: string): Promise<ClientSummary | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, organizationId: true } });
  if (!company || company.organizationId !== organizationId) return null;

  const [conversation, systemNextAction, timeline, dealValue, revenue, risk, currentSituation, historicalCohortObservation] = await Promise.all([
    summarizeCompanyConversation(organizationId, companyId),
    suggestNextActionForCompany(organizationId, companyId),
    getCompanyCompleteTimeline(organizationId, companyId),
    deriveDealValue(organizationId, companyId),
    deriveRevenue(organizationId, companyId),
    deriveRisk(organizationId, companyId),
    deriveCurrentSituation(organizationId, companyId),
    deriveHistoricalCohortObservation(organizationId, companyId),
  ]);

  const lastContact = await deriveLastContact(timeline);

  const acceptedProposal = await prisma.proposal.findFirst({ where: { organizationId, companyId, status: "ACCEPTED" }, orderBy: { createdAt: "desc" } });
  const signedContract = await prisma.contract.findFirst({ where: { organizationId, companyId, status: "SIGNED" }, orderBy: { createdAt: "desc" } });
  const whatWePromised: GroundedField<string> = signedContract
    ? { value: signedContract.title, status: "CONFIRMED", source: `Contract ${signedContract.id} (SIGNED).` }
    : acceptedProposal
      ? { value: acceptedProposal.title, status: "CONFIRMED", source: `Proposal ${acceptedProposal.id} (ACCEPTED).` }
      : { value: null, status: "UNKNOWN", source: null };

  const openTasks = await prisma.task.findMany({ where: { organizationId, companyId, type: "SUPPORT", status: { notIn: Array.from(TERMINAL_TASK_STATUSES) as never[] } }, select: { title: true } });

  return {
    currentSituation,
    clientWants:
      conversation && conversation.requirementsConfirmed.length > 0
        ? { value: conversation.requirementsConfirmed, status: "CONFIRMED", source: "AI conversation summary, grounded in real sent emails + replies." }
        : conversation && conversation.clientRequirements.length > 0
          ? { value: conversation.clientRequirements, status: "INFERRED", source: "AI conversation summary — real transcript, but not yet an explicitly confirmed requirement." }
          : { value: null, status: "UNKNOWN", source: null },
    whatWePromised,
    openIssues: openTasks.length > 0 ? { value: openTasks.map((t) => t.title), status: "CONFIRMED", source: "Open Task rows (type=SUPPORT)." } : { value: null, status: "UNKNOWN", source: null },
    objections:
      conversation && conversation.objections.length > 0
        ? { value: conversation.objections, status: "INFERRED", source: "AI conversation summary, grounded in real replies — inferred from language, not a literal 'objection' field." }
        : { value: null, status: "UNKNOWN", source: null },
    lastContact,
    nextAction: { action: systemNextAction.action, kind: systemNextAction.taskId ? "SYSTEM_ACTION" : "SYSTEM_SUGGESTION", taskId: systemNextAction.taskId },
    aiRecommendedAction: conversation?.nextAction ?? null,
    dealValue,
    revenue,
    risk,
    historicalCohortObservation,
  };
}

// ===== Ask AI About This Client =====

const AskAiAnswerSchema = z.object({
  answer: z.string(),
  confidence: z.enum(["CONFIRMED", "INFERRED", "UNKNOWN"]),
  supportingRecordRefs: z.array(z.string()).max(8),
});

export interface AskAiAnswer {
  answer: string;
  confidence: Confidence;
  supportingRecords: { recordType: string; recordId: string; label: string }[];
}

/**
 * ONE real AI call, reusing the existing fallback chain (never a new
 * provider system). Grounding context is built ONLY from this company's
 * real records — organizationId/companyId enforced at the query layer
 * (never trusting the caller), matching resolveMembershipForCompany's exact
 * tenant-isolation discipline used everywhere else in this codebase.
 */
export async function askAboutClient(organizationId: string, companyId: string, question: string): Promise<AskAiAnswer> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.organizationId !== organizationId) {
    return { answer: "Company not found in your organization.", confidence: "UNKNOWN", supportingRecords: [] };
  }
  if (!isAIConnected()) {
    return { answer: "AI is not connected — cannot answer questions right now.", confidence: "UNKNOWN", supportingRecords: [] };
  }

  const [timeline, summary, contacts, decisionMakers] = await Promise.all([
    getCompanyCompleteTimeline(organizationId, companyId),
    buildClientSummary(organizationId, companyId),
    prisma.contact.findMany({ where: { organizationId, companyId } }),
    prisma.decisionMaker.findMany({ where: { companyId } }),
  ]);

  if (timeline.length === 0) {
    return { answer: "I couldn't find this information in the stored client records.", confidence: "UNKNOWN", supportingRecords: [] };
  }

  const contextParts = [
    `Company: ${company.name}${company.industry ? ` (${company.industry})` : ""}`,
    `Contacts: ${contacts.map((c) => `${c.firstName} ${c.lastName ?? ""} <${c.email}>`).join("; ") || "none on record"}`,
    `Decision makers: ${decisionMakers.map((d) => `${d.name} (${d.role})`).join("; ") || "none verified yet"}`,
    summary ? `Deal value: ${summary.dealValue.value ?? "UNKNOWN"} (${summary.dealValue.status})` : null,
    summary ? `Revenue: invoiced ${summary.revenue.invoiced}, paid ${summary.revenue.paid}` : null,
    summary?.clientWants.value ? `Client wants (${summary.clientWants.status}): ${summary.clientWants.value.join("; ")}` : null,
    summary?.objections.value ? `Objections (${summary.objections.status}): ${summary.objections.value.join("; ")}` : null,
    "",
    "Full real chronological record (source table:id — event — timestamp):",
    ...timeline.map((e) => `[${e.recordType}:${e.recordId}] ${e.type} — ${e.label} — ${e.occurredAt.toISOString()}`),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await generateStructured({
      system: `You are answering a question about ONE specific real client/company, using ONLY the real records given below. You must NEVER answer from general knowledge, assumptions, or anything not present in this context.

Rules:
- If the records genuinely answer the question, give a real answer and cite the exact supporting record references (in the format "RecordType:recordId") from the context — never invent a reference.
- If the records do NOT contain the answer, you MUST respond with exactly: "I couldn't find this information in the stored client records." and an empty supportingRecordRefs list.
- confidence: CONFIRMED only if a specific real record directly states the answer. INFERRED if you reasonably derived it from real records but it isn't explicitly stated. UNKNOWN if you genuinely don't know from the records.
- Never invent a budget, requirement, decision maker, objection, commitment, or date not present in the context.`,
      userContent: `CLIENT RECORDS:\n${contextParts}\n\nQUESTION: ${question}`,
      maxTokens: 800,
      effort: "low",
      schema: AskAiAnswerSchema,
    });

    const supportingRecords = result.parsed.supportingRecordRefs
      .map((ref) => {
        const [recordType, recordId] = ref.split(":");
        if (!recordType || !recordId) return null;
        const match = timeline.find((e) => e.recordType === recordType && e.recordId === recordId);
        return { recordType, recordId, label: match?.label ?? ref };
      })
      .filter((r): r is { recordType: string; recordId: string; label: string } => r !== null);

    return { answer: result.parsed.answer, confidence: result.parsed.confidence, supportingRecords };
  } catch (error) {
    console.error("[client-360] askAboutClient failed:", error);
    return { answer: "AI is currently unavailable — please try again.", confidence: "UNKNOWN", supportingRecords: [] };
  }
}
