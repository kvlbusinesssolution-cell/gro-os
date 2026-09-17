import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { AINotConnectedError, isAIConnected } from "@/lib/ai/client";
import { generateStructured } from "@/lib/ai/fallback";
import { getPersona } from "@/lib/ai/personas";
import { publishRealtimeEvent } from "@/lib/realtime/event-bus";

/**
 * AI generation for the Proposal/Contract/Legal-&-Project-Document engine
 * — same generateStructured fallback-chain pattern used everywhere else
 * (see src/lib/ai/agent-runtime.ts, src/lib/ai/fallback.ts). Kept in its own
 * module since these generators are document-shaped (title + structured
 * sections), not agent-turn-shaped.
 */

async function setAgentStatus(agentId: string, status: "THINKING" | "COMPLETED" | "IDLE", currentTask?: string) {
  const agent = await prisma.aIAgentInstance.update({
    where: { id: agentId },
    data: { status, ...(currentTask !== undefined ? { currentTask } : {}) },
    select: { organizationId: true },
  });
  publishRealtimeEvent({ kind: "agent_status", organizationId: agent.organizationId });
}

const MilestoneSchema = z.object({
  name: z.string(),
  dueOffsetDays: z.number().int().nonnegative(),
  description: z.string().optional(),
});

const ResourceSchema = z.object({
  role: z.string(),
  count: z.number().int().positive(),
});

const TimelinePhaseSchema = z.object({
  phase: z.string(),
  duration: z.string(),
  description: z.string().optional(),
});

export const ProposalSectionsSchema = z.object({
  executiveSummary: z.string(),
  businessChallenges: z.array(z.string()).max(8).default([]),
  currentProblems: z.array(z.string()).max(8).default([]),
  recommendedSolution: z.string(),
  techStack: z.array(z.string()).max(15).default([]),
  architecture: z.string().optional(),
  features: z.array(z.string()).max(15).default([]),
  modules: z.array(z.string()).max(15).default([]),
  // Phase 7 (AI Proposal & Deal Closing Intelligence) — the four spec'd
  // sections the pre-existing software-project-shaped schema above didn't
  // have (Scope, Commercial Structure, Assumptions, Exclusions), plus a
  // concrete Next Steps action list distinct from the closing `callToAction`
  // sentence. All optional/defaulted so every pre-Phase-7 Proposal row's
  // stored `sections` JSON (and every existing caller that doesn't ask for
  // these) keeps working unchanged.
  //
  // `commercialStructure` is a NARRATIVE ONLY — pricing model, payment
  // milestones, options described in prose. It must never be parsed into a
  // number: the real numeric `Proposal.value`/`Deal.value` always comes from
  // a human or from a pre-existing LeadOpportunity.estimatedValue, never
  // from this AI-authored text (see generateProposalFromOpportunityCore in
  // src/app/dashboard/opportunities/_lib/proposal-generation-actions.ts).
  scope: z.string().optional(),
  commercialStructure: z.string().optional(),
  assumptions: z.array(z.string()).max(10).default([]),
  exclusions: z.array(z.string()).max(10).default([]),
  nextSteps: z.array(z.string()).max(8).default([]),
  timeline: z.array(TimelinePhaseSchema).max(10).default([]),
  deliverables: z.array(z.string()).max(15).default([]),
  support: z.string().optional(),
  warranty: z.string().optional(),
  terms: z.string().optional(),
  callToAction: z.string(),
  estimation: z.object({
    resources: z.array(ResourceSchema).max(10).default([]),
    totalHours: z.number().nonnegative().optional(),
    milestones: z.array(MilestoneSchema).max(15).default([]),
  }),
});

export type ProposalSections = z.infer<typeof ProposalSectionsSchema>;

/**
 * Real Claude call producing every AI Proposal Engine field the brief
 * asks for (Executive Summary through Call To Action) plus a real
 * Project Estimation breakdown — grounded entirely in the brief text and
 * context given, never fabricated beyond what's asked. Same
 * throw-AINotConnectedError/propagate-AIBillingError discipline as
 * every other AI entry point.
 */
export async function generateProposalSections(params: {
  agentId: string;
  agentName: string;
  title: string;
  brief: string;
  industry?: string;
  companyContext?: string;
  pricingModel?: string;
}): Promise<ProposalSections> {
  if (!isAIConnected()) throw new AINotConnectedError();
  const persona = getPersona("PROPOSAL");

  await setAgentStatus(params.agentId, "THINKING", `Drafting proposal: ${params.title}`);

  try {
    const result = await generateStructured({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". You are drafting a premium enterprise sales proposal. Every section must be concrete and grounded in the brief given — never invent client facts, prices, or team names that weren't provided. The estimation.resources/milestones/totalHours must be a genuine, reasonable breakdown for a project of this scope, not a placeholder.\n\nAlso write: "scope" (what work is and isn't included, in prose), "assumptions" (conditions this proposal depends on, e.g. client-provided access/content/timelines), "exclusions" (explicitly out-of-scope items), and "nextSteps" (concrete next actions to move this deal forward, e.g. "Schedule a kickoff call", distinct from the closing call-to-action line). Write "commercialStructure" as a NARRATIVE ONLY describing the pricing model/payment structure/options in words (e.g. "fixed-price with two milestone payments" or "monthly retainer") — never state a specific total price or number in this field; the real commercial number is added separately by a human from verified data, not generated by you.\n\nWriting quality bar: this document represents the company in front of a real decision-maker, so every section must read like it was written by an experienced consultant, not generated boilerplate — precise, confident prose; no filler ("in today's competitive landscape", "leverage cutting-edge technology", "unlock synergies"); no vague claims without the concrete detail behind them. Every section must end complete — never a heading with no closing sentence, never a sign-off or list that trails off mid-thought.`,
      userContent: [
        `Proposal title: ${params.title}`,
        params.industry ? `Industry / domain: ${params.industry}` : null,
        params.pricingModel ? `Pricing model: ${params.pricingModel}` : null,
        params.companyContext ? `Client context:\n${params.companyContext}` : null,
        `Brief:\n${params.brief}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 4096,
      effort: "high",
      schema: ProposalSectionsSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    return result.parsed;
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

const ContractContentSchema = z.object({
  content: z.string(),
});

const CONTRACT_TYPE_GUIDANCE: Record<string, string> = {
  SOFTWARE_DEVELOPMENT_AGREEMENT: "a Software Development Agreement covering scope, deliverables, IP ownership, payment milestones, and change-request handling",
  AMC_AGREEMENT: "an Annual Maintenance Contract (AMC) covering support hours, response SLAs, covered systems, and renewal terms",
  MAINTENANCE_AGREEMENT: "a Maintenance Agreement covering ongoing upkeep scope, response times, and exclusions",
  SUPPORT_AGREEMENT: "a Support Agreement covering support tiers, response/resolution SLAs, and escalation paths",
  IMPLEMENTATION_AGREEMENT: "an Implementation Agreement covering rollout scope, timeline, acceptance criteria, and training",
  CONSULTING_AGREEMENT: "a Consulting Agreement covering advisory scope, engagement model, confidentiality, and fees",
};

/** Real Claude-drafted contract body, parameterized by ContractType — never a copy-pasted boilerplate template. */
export async function generateContractContent(params: {
  agentId: string;
  agentName: string;
  contractType: string;
  partyName: string;
  clientName: string;
  value?: number;
  startDate?: string;
  endDate?: string;
  brief?: string;
}): Promise<{ content: string }> {
  if (!isAIConnected()) throw new AINotConnectedError();
  const persona = getPersona("PROPOSAL");

  await setAgentStatus(params.agentId, "THINKING", `Drafting contract for ${params.clientName}`);

  try {
    const result = await generateStructured({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". Draft ${CONTRACT_TYPE_GUIDANCE[params.contractType] ?? "a business agreement"} between "${params.partyName}" (the service provider) and "${params.clientName}" (the client). Write real, professional legal-style prose organized into numbered clauses. This is a genuine draft for review by both parties' counsel, not a toy example — do not include bracketed placeholders like "[insert X]" for anything you were actually given (party names, value, dates); only leave a placeholder for information that truly wasn't provided.`,
      userContent: [
        `Contract type: ${params.contractType}`,
        `Provider: ${params.partyName}`,
        `Client: ${params.clientName}`,
        params.value != null ? `Contract value: ${params.value}` : null,
        params.startDate ? `Start date: ${params.startDate}` : null,
        params.endDate ? `End date: ${params.endDate}` : null,
        params.brief ? `Additional context:\n${params.brief}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 3072,
      effort: "high",
      schema: ContractContentSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    return result.parsed;
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

const BusinessDocumentContentSchema = z.object({
  title: z.string(),
  content: z.string(),
});

const BUSINESS_DOC_GUIDANCE: Record<string, string> = {
  NDA: "a mutual Non-Disclosure Agreement",
  MSA: "a Master Service Agreement",
  SLA: "a Service Level Agreement with concrete uptime/response targets",
  TERMS: "Terms & Conditions for professional services",
  PRIVACY_AGREEMENT: "a Privacy Agreement / data handling policy",
  ACCEPTANCE_LETTER: "a formal project Acceptance Letter confirming deliverables were received and approved",
  DELIVERY_CERTIFICATE: "a Delivery Certificate confirming a project/deliverable was handed over",
  SCOPE_OF_WORK: "a detailed Scope of Work document",
  REQUIREMENT_SPECIFICATION: "a Requirement Specification document",
  TECHNICAL_ARCHITECTURE: "a Technical Architecture document describing system design",
  PROJECT_ROADMAP: "a Project Roadmap with phased milestones",
  RISK_REGISTER: "a Risk Register listing identified risks, likelihood, impact, and mitigation",
  ACCEPTANCE_CRITERIA: "an Acceptance Criteria document defining done/pass conditions",
  PROJECT_PLAN: "a full Project Plan with phases, timeline, and resourcing",
  BUSINESS_REPORT: "a Business Report summarizing performance and recommendations",
};

/** Real Claude generation for every BusinessDocument kind (NDA/MSA/SLA/SOW/etc.) — one generator parameterized by kind, not 14 near-duplicate functions. */
export async function generateBusinessDocument(params: {
  agentId: string;
  agentName: string;
  kind: string;
  organizationName: string;
  counterpartyName?: string;
  brief: string;
}): Promise<{ title: string; content: string }> {
  if (!isAIConnected()) throw new AINotConnectedError();
  const persona = getPersona("PROPOSAL");

  await setAgentStatus(params.agentId, "THINKING", `Drafting ${params.kind.replace(/_/g, " ").toLowerCase()}`);

  try {
    const result = await generateStructured({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". Draft ${BUSINESS_DOC_GUIDANCE[params.kind] ?? "a business document"} for "${params.organizationName}"${params.counterpartyName ? ` and "${params.counterpartyName}"` : ""}. Produce a real, professional, ready-to-review draft — grounded in the brief given, never inventing facts you weren't given.`,
      userContent: `Document kind: ${params.kind}\n\nBrief:\n${params.brief}`,
      maxTokens: 3072,
      effort: "medium",
      schema: BusinessDocumentContentSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    return result.parsed;
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

const ProposalRecommendationsSchema = z.object({
  recommendations: z
    .array(
      z.object({
        type: z.enum(["BETTER_PRICING", "ADDITIONAL_SERVICES", "UPSELL_OPPORTUNITY", "CROSS_SELL_OPPORTUNITY", "BETTER_TIMELINE", "RISK_WARNING"]),
        title: z.string(),
        description: z.string(),
      }),
    )
    .max(6),
});

export type ProposalRecommendations = z.infer<typeof ProposalRecommendationsSchema>;

/** AI Recommendations for a proposal — better pricing, additional services, upsell/cross-sell, timeline, risk warnings — grounded in the real proposal content, feeding the existing Recommendation model/panel. */
export async function suggestProposalRecommendations(params: {
  agentId: string;
  agentName: string;
  proposalTitle: string;
  proposalSummary: string;
  value?: number;
}): Promise<ProposalRecommendations> {
  if (!isAIConnected()) throw new AINotConnectedError();
  const persona = getPersona("PROPOSAL");

  await setAgentStatus(params.agentId, "THINKING", `Reviewing proposal: ${params.proposalTitle}`);

  try {
    const result = await generateStructured({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". Review this real proposal and suggest concrete, actionable improvements — pricing, additional/upsell/cross-sell services, a better timeline, or a genuine risk to flag. Only surface a recommendation if it's actually grounded in the proposal content; do not pad the list to hit any count.`,
      userContent: [`Proposal: ${params.proposalTitle}`, params.value != null ? `Value: ${params.value}` : null, `Summary:\n${params.proposalSummary}`].filter(Boolean).join("\n\n"),
      maxTokens: 2048,
      effort: "medium",
      schema: ProposalRecommendationsSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    return result.parsed;
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}
