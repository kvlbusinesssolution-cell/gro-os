import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { AINotConnectedError, isAIConnected } from "@/lib/ai/client";
import { generateStructured, generateText } from "@/lib/ai/fallback";
import { decryptMemory, encryptMemory } from "@/lib/ai/encryption";
import { getPersona, type ExecutiveAgentType } from "@/lib/ai/personas";
import { logMemoryEvent } from "@/lib/ai/memory-events";
import { publishRealtimeEvent } from "@/lib/realtime/event-bus";
import { enqueueSourceEmbedding } from "@/lib/rag/embedding-queue";
import { buildAgentContext } from "@/lib/context-engine";
import { recordAIUsage } from "@/lib/billing/ai-credits";
import type { AIUsageProvider, MemorySourceKind, MemoryType } from "@/generated/prisma/client";

/**
 * Real per-call AI usage metering (Phase 19's AI Credit System) — looks up
 * the calling agent's real organizationId and records the real token counts
 * every provider response already reports (previously computed here and
 * silently discarded by every caller). `provider`/`model` identify whichever
 * provider in the fallback chain (src/lib/ai/fallback.ts) actually served
 * this call — not always Anthropic anymore. Fire-and-forget: a metering
 * failure must never fail the AI call it's recording, since the call has
 * already completed by the time this runs.
 */
async function recordAgentAIUsage(
  agentId: string,
  provider: AIUsageProvider,
  model: string,
  inputTokens: number,
  outputTokens: number,
  context: string,
): Promise<void> {
  try {
    const agent = await prisma.aIAgentInstance.findUnique({ where: { id: agentId }, select: { organizationId: true } });
    if (!agent) return;
    await recordAIUsage(agent.organizationId, provider, model, inputTokens, outputTokens, context);
  } catch (error) {
    console.error("[agent-runtime] recordAgentAIUsage failed:", error);
  }
}

const VoteSchema = z.object({
  vote: z.enum(["APPROVE", "REJECT", "ESCALATE", "DISCUSS", "DELAY", "DELEGATE"]),
  reasoning: z.string(),
});

export type VoteResult = z.infer<typeof VoteSchema>;

// A separate schema from VoteSchema, not a widened version of it — the
// shared VoteSchema stays exactly as War Room has always used it (forking
// here, not touching shared code with a new choice War Room never asked
// for, mirrors why Review Board has its own ReviewVoteSchema instead of
// reusing this one).
const DeliveryVoteSchema = z.object({
  vote: z.enum(["APPROVE", "REJECT", "ESCALATE", "DISCUSS", "DELAY", "DELEGATE", "REQUEST_REVISION"]),
  reasoning: z.string(),
});

export type DeliveryVoteResult = z.infer<typeof DeliveryVoteSchema>;

const MeetingTurnSchema = z.object({
  content: z.string(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  confidenceScore: z.number().min(0).max(100),
  suggestedAction: z.string().optional(),
  evidence: z.string().optional(),
});

export type MeetingTurnResult = z.infer<typeof MeetingTurnSchema>;

// Structured so an execution plan comes out of every meeting directly
// usable as a real ActionItem row (Task/Owner/Priority/Deadline/KPI/
// Expected Impact) — no separate free-text-parsing step. dueInDays (not an
// absolute date) because LLMs are unreliable at date arithmetic; the
// orchestrator computes the real Date server-side from "now".
const MeetingActionItemSchema = z.object({
  // Capped to match createActionItemSchema's ActionItem.title bound
  // (validations/action-items.ts) — the orchestrator writes this string
  // verbatim as ActionItem.title, and the UI matches a notesJson entry back
  // to its real ActionItem row by exact title, so the two must agree.
  title: z.string().max(300),
  owner: z.enum(["CEO", "SALES", "MARKETING", "PROPOSAL", "OUTREACH", "HUMAN"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  dueInDays: z.number().int().min(0).max(90),
  kpi: z.string().max(300),
  expectedImpact: z.string().max(500),
});

export type MeetingActionItem = z.infer<typeof MeetingActionItemSchema>;

const MeetingBlockerSchema = z.object({
  description: z.string(),
  proposedSolution: z.string(),
});

export type MeetingBlocker = z.infer<typeof MeetingBlockerSchema>;

const MeetingNotesSchema = z.object({
  summary: z.string(),
  actionItems: z.array(MeetingActionItemSchema).max(20).default([]),
  risks: z.array(z.string()).max(20).default([]),
  blockers: z.array(MeetingBlockerSchema).max(20).default([]),
  recommendations: z.array(z.string()).max(20).default([]),
  nextSteps: z.array(z.string()).max(20).default([]),
});

export type MeetingNotes = z.infer<typeof MeetingNotesSchema>;

// ===== AI Proposal Review Board =====
// Restricted to the 9 RecommendationType values that actually apply to
// reviewing a proposal/quotation/contract/invoice (the ones matching the
// brief's "AI Suggestions" list) — the other RecommendationType values
// (BEST_OPPORTUNITY, HIGHEST_VALUE_LEAD, etc.) are Lead Finder/company
// intelligence concepts, not something a review agent would ever produce.
const ReviewRecommendationTypeSchema = z.enum([
  "BETTER_PRICING",
  "ADDITIONAL_SERVICES",
  "UPSELL_OPPORTUNITY",
  "CROSS_SELL_OPPORTUNITY",
  "BETTER_TIMELINE",
  "RISK_WARNING",
  "SCOPE_IMPROVEMENT",
  "PROPOSAL_QUALITY_IMPROVEMENT",
  "COMPETITIVE_ADVANTAGE",
]);

const ReviewRecommendationSchema = z.object({
  type: ReviewRecommendationTypeSchema,
  title: z.string(),
  description: z.string(),
});

export type ReviewRecommendation = z.infer<typeof ReviewRecommendationSchema>;

const ReviewTurnSchema = z.object({
  opinion: z.string(),
  strengths: z.array(z.string()).max(10).default([]),
  weaknesses: z.array(z.string()).max(10).default([]),
  recommendations: z.array(ReviewRecommendationSchema).max(8).default([]),
  confidenceScore: z.number().min(0).max(100),
  winProbability: z.number().min(0).max(100).optional(),
  profitMarginEstimate: z.number().optional(),
});

export type ReviewTurnResult = z.infer<typeof ReviewTurnSchema>;

const FinanceReviewTurnSchema = ReviewTurnSchema.extend({
  profitAnalysis: z.object({
    estimatedRevenue: z.number().optional(),
    estimatedCost: z.number().optional(),
    grossMargin: z.number().optional(),
    netMargin: z.number().optional(),
    discountImpact: z.number().optional(),
    paymentRiskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
    paymentRiskNotes: z.string().optional(),
  }),
});

export type FinanceReviewTurnResult = z.infer<typeof FinanceReviewTurnSchema>;

const LegalReviewTurnSchema = ReviewTurnSchema.extend({
  riskAnalysis: z.object({
    contractTermsOk: z.boolean().optional(),
    missingClauses: z.array(z.string()).max(10).default([]),
    ndaRequired: z.boolean().optional(),
    liabilityRisk: z.string().optional(),
    warrantyRisk: z.string().optional(),
    complianceNotes: z.string().optional(),
    overallRiskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    riskFactors: z.array(z.string()).max(10).default([]),
  }),
});

export type LegalReviewTurnResult = z.infer<typeof LegalReviewTurnSchema>;

const ReviewVoteSchema = z.object({
  vote: z.enum(["APPROVE", "APPROVE_WITH_CHANGES", "REQUEST_REVISION", "REJECT"]),
  reasoning: z.string(),
});

export type ReviewVoteResult = z.infer<typeof ReviewVoteSchema>;

// ===== AI Project Manager =====
// Solo, single-project analysis — never a "boardroom meeting" framing
// (unlike runMeetingAgentTurn/runReviewAgentTurn). Deterministic risk/
// deadline/budget detection happens in real code before this is ever
// called (see src/lib/projects/risk-detection.ts); this call's job is
// strictly to review, prioritize, and narrate those real findings.
const ProjectManagerTurnSchema = z.object({
  summary: z.string(),
  priorities: z.array(z.string()).max(10).default([]),
  riskAssessments: z
    .array(z.object({ title: z.string(), assessment: z.string() }))
    .max(10)
    .default([]),
  recommendations: z.array(z.string()).max(10).default([]),
  suggestedAssignments: z
    .array(z.object({ taskId: z.string(), suggestedAssigneeUserId: z.string(), reason: z.string() }))
    .max(10)
    .default([]),
});

export type ProjectManagerTurnResult = z.infer<typeof ProjectManagerTurnSchema>;

const DiscoveredCompaniesSchema = z.object({
  companies: z
    .array(
      z.object({
        name: z.string(),
        website: z.string().optional(),
        industry: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .max(15),
});

export type DiscoveredCompany = z.infer<typeof DiscoveredCompaniesSchema>["companies"][number];

const CompanyIntelligenceOutputSchema = z.object({
  businessSummary: z.string(),
  productsSummary: z.string().optional(),
  servicesSummary: z.string().optional(),
  techStackSummary: z.string().optional(),
  digitalPresenceSummary: z.string().optional(),
  seoOverview: z.string().optional(),
  performanceOverview: z.string().optional(),
  growthSignals: z.array(z.string()).max(10).default([]),
  hiringSignals: z.array(z.string()).max(10).default([]),
  expansionIndicators: z.array(z.string()).max(10).default([]),
  businessOpportunities: z.array(z.string()).max(10).default([]),
  estimatedSoftwareNeeds: z.array(z.string()).max(10).default([]),
  potentialPainPoints: z.array(z.string()).max(10).default([]),
  recommendedSolution: z.string().optional(),
  estimatedProjectValue: z.number().nonnegative().optional(),
  confidenceScore: z.number().min(0).max(100),
});

export type CompanyIntelligenceOutput = z.infer<typeof CompanyIntelligenceOutputSchema>;

const ResearchNoteOutputSchema = z.object({
  content: z.string(),
});

async function loadAgentMemoryContext(agentId: string, limit = 8): Promise<string> {
  const memories = await prisma.agentMemory.findMany({
    // Archived memories are deliberately excluded from what an agent actually
    // sees in its own prompt context — archiving something in the Memory
    // Manager means "stop acting on this," not just "hide it from the list."
    where: { agentId, archivedAt: null },
    // Pinned memories a human has explicitly marked important always surface
    // first; recency (not any relevance ranking) breaks every other tie —
    // still the same naive-recency retrieval as before, just pin-aware. Real
    // semantic-relevance ranking is the Context Engine's job, not this one.
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });
  if (memories.length === 0) return "You have no stored memory yet.";
  const lines = memories.map((m) => `- [${m.type}]${m.pinned ? " (pinned)" : ""} ${decryptMemory(m.encryptedContent)}`);
  return `Relevant memory:\n${lines.join("\n")}`;
}

/**
 * Writes one real, encrypted AgentMemory row — the first real write path
 * this primitive has ever had in this app (loadAgentMemoryContext above has
 * always read from it, but until Phase 5 nothing ever called `.create()`,
 * so every agent's memory was permanently empty in every board type).
 * Content must be real (a real meeting outcome, a real decision, a real
 * recurring risk) — never a fabricated fact.
 *
 * `sourceKind`/`sourceId` optionally tag the real record (a Deal, a
 * Proposal/Invoice, a Project, a Task, a Meeting) this memory was distilled
 * from, so the Memory Manager UI and future retrieval can trace it back.
 * Manual entries from the Memory Manager's "Add memory" form pass
 * `sourceKind: "MANUAL"` instead.
 */
export async function storeAgentMemory(
  agentId: string,
  organizationId: string,
  type: MemoryType,
  content: string,
  sourceKind?: MemorySourceKind,
  sourceId?: string,
): Promise<void> {
  const memory = await prisma.agentMemory.create({
    data: {
      agentId,
      organizationId,
      type,
      encryptedContent: encryptMemory(content),
      sourceKind: sourceKind ?? undefined,
      sourceId: sourceId ?? undefined,
    },
  });

  await logMemoryEvent(memory.id, agentId, organizationId, "CREATED");

  // The plaintext content is sent to the org's connected embeddings provider
  // (a real third-party API the org explicitly connected under
  // /dashboard/settings/integrations) so this memory becomes retrievable via
  // semantic search — an accepted, documented tradeoff against the "never
  // store/log plaintext" rule for the encrypted column itself, not a bug.
  try {
    await enqueueSourceEmbedding(organizationId, "AGENT_MEMORY", memory.id, content);
  } catch (error) {
    console.error("[agent-runtime] enqueueSourceEmbedding failed for new memory:", error);
  }
}

async function setAgentStatus(
  agentId: string,
  status: "THINKING" | "RESEARCHING" | "PLANNING" | "ANALYZING" | "WAITING" | "COMPLETED" | "IDLE",
  currentTask?: string,
) {
  const agent = await prisma.aIAgentInstance.update({
    where: { id: agentId },
    data: { status, ...(currentTask !== undefined ? { currentTask } : {}) },
    select: { organizationId: true },
  });
  // Real live-status push for the Live AI Panel — every status transition
  // here is a genuine Claude-call state change, never animated client-side.
  publishRealtimeEvent({ kind: "agent_status", organizationId: agent.organizationId });
}

/**
 * Runs one real Claude API turn for an agent — a meeting contribution, a
 * standalone analysis, or a drafted artifact (proposal, email, etc). Never
 * called if isAIConnected() is false; callers must check that first and
 * render an explicit "AI not connected" state instead.
 */
export async function runAgentTurn(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  task: string;
  conversationContext?: string;
  effort?: "low" | "medium" | "high";
  // Optional Context Engine hook (src/lib/context-engine.ts) — when
  // `organizationId` is given, real live CRM/project/meeting/decision/
  // Knowledge Base context is assembled and spliced in alongside memory.
  // Both new params are optional and additive: every existing call site
  // that omits them behaves byte-for-byte as before. The same pattern is
  // wired into every other real board/vote/notes/review turn function in
  // this file (runAgentVote, runMeetingAgentTurn, runMeetingNotesTurn,
  // runReviewAgentTurn, runReviewVoteTurn, runProjectManagerTurn,
  // runDeliveryVoteTurn) — deliberately NOT into the external-web-research
  // turns (runWebSearchDiscovery, runCompanyIntelligenceTurn,
  // runResearchNoteTurn), where this org's own internal meetings/decisions/
  // preferences aren't relevant context for researching an outside company.
  organizationId?: string;
  contextQuery?: string;
}): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number } }> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const persona = getPersona(params.agentType);

  await setAgentStatus(params.agentId, "THINKING", params.task);

  try {
    const memoryContext = await loadAgentMemoryContext(params.agentId);
    const engineContext = params.organizationId
      ? await buildAgentContext(params.organizationId, { agentId: params.agentId, agentType: params.agentType, clientQuery: params.contextQuery }).catch((error) => {
          console.error("[agent-runtime] buildAgentContext failed, continuing without it:", error);
          return "";
        })
      : "";

    const result = await generateText(
      {
        system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}".`,
        userContent: [
          memoryContext,
          engineContext || null,
          params.conversationContext ? `Conversation so far:\n${params.conversationContext}` : null,
          `Your task now: ${params.task}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        maxTokens: 2048,
        effort: params.effort ?? "medium",
      },
      // The only call site that queues a durable retry on total-chain
      // failure — see fallback-queue.ts's doc comment for why: this is the
      // one call whose return value (`content`) is the entire deliverable of
      // the turn, so "retry later and mark the agent COMPLETED" is fully
      // meaningful on its own, unlike the multi-step/structured call sites
      // below.
      { organizationId: params.organizationId, agentId: params.agentId, context: "agent-turn" },
    );

    await setAgentStatus(params.agentId, "COMPLETED");
    await recordAgentAIUsage(params.agentId, result.provider, result.model, result.inputTokens, result.outputTokens, "agent-turn");

    return {
      content: result.text,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    };
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

/**
 * Asks an agent to cast a structured vote on a decision using real Claude
 * output parsed against a strict schema — never a hardcoded/random vote.
 */
export async function runAgentVote(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  topic: string;
  description?: string;
  conversationContext?: string;
  // Real, deterministic signal computed by the caller from
  // Decision.category/riskLevel/financialImpact — not AI-guessed. Grounds
  // the agent's free-choice ESCALATE vote in actual stakes instead of vibes
  // alone, without touching the vote-tally logic itself.
  riskContext?: string;
  // Same optional Context Engine hook as runAgentTurn (see its doc comment)
  // — additive, every existing call site that omits these is unaffected.
  organizationId?: string;
  contextQuery?: string;
}): Promise<VoteResult> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const persona = getPersona(params.agentType);

  await setAgentStatus(params.agentId, "ANALYZING", `Voting on: ${params.topic}`);

  try {
    const memoryContext = await loadAgentMemoryContext(params.agentId);
    const engineContext = params.organizationId
      ? await buildAgentContext(params.organizationId, { agentId: params.agentId, agentType: params.agentType, clientQuery: params.contextQuery }).catch((error) => {
          console.error("[agent-runtime] buildAgentContext failed, continuing without it:", error);
          return "";
        })
      : "";

    const result = await generateStructured({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". You are being asked to formally vote on a board decision. Vote APPROVE, REJECT, ESCALATE (needs human/CEO judgment), DISCUSS (need more debate first), DELAY (not enough information yet), or DELEGATE (someone else should own this). Give concrete reasoning grounded in your role.`,
      userContent: [
        memoryContext,
        engineContext || null,
        params.conversationContext ? `Discussion so far:\n${params.conversationContext}` : null,
        `Decision topic: ${params.topic}`,
        params.description ? `Details: ${params.description}` : null,
        params.riskContext ?? null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 1024,
      effort: "medium",
      schema: VoteSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    await recordAgentAIUsage(params.agentId, result.provider, result.model, result.inputTokens, result.outputTokens, "agent-vote");

    return result.parsed;
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

/**
 * The AI Delivery Board's vote-casting turn (Phase 5) — same shape as
 * runAgentVote, forked rather than widening the shared VoteSchema, so it
 * can offer REQUEST_REVISION ("needs revision") alongside the same
 * APPROVE/REJECT/ESCALATE/DISCUSS/DELAY/DELEGATE choices, without changing
 * what War Room's decisions can ever vote.
 */
export async function runDeliveryVoteTurn(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  topic: string;
  description?: string;
  conversationContext?: string;
  organizationId?: string;
  contextQuery?: string;
}): Promise<DeliveryVoteResult> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const persona = getPersona(params.agentType);

  await setAgentStatus(params.agentId, "ANALYZING", `Voting on: ${params.topic}`);

  try {
    const memoryContext = await loadAgentMemoryContext(params.agentId);
    const engineContext = params.organizationId
      ? await buildAgentContext(params.organizationId, { agentId: params.agentId, agentType: params.agentType, clientQuery: params.contextQuery }).catch((error) => {
          console.error("[agent-runtime] buildAgentContext failed, continuing without it:", error);
          return "";
        })
      : "";

    const result = await generateStructured({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". You are being asked to formally vote on a real AI Delivery Board decision. Vote APPROVE, REJECT, ESCALATE (needs human/CEO judgment — "Require Human Approval"), DISCUSS (need more debate first), DELAY (not enough information yet), DELEGATE (someone else should own this), or REQUEST_REVISION (the plan needs changes before you can approve it). Give concrete reasoning grounded in your role and the real project data you were given.`,
      userContent: [
        memoryContext,
        engineContext || null,
        params.conversationContext ? `Discussion so far:\n${params.conversationContext}` : null,
        `Decision topic: ${params.topic}`,
        params.description ? `Details: ${params.description}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 1024,
      effort: "medium",
      schema: DeliveryVoteSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    await recordAgentAIUsage(params.agentId, result.provider, result.model, result.inputTokens, result.outputTokens, "delivery-vote-turn");

    return result.parsed;
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

/**
 * War Room briefing-card turn: like runAgentTurn, but the agent's
 * contribution comes back as real structured Claude output — priority,
 * confidenceScore, an optional suggestedAction, and optional evidence —
 * instead of just prose. The agent genuinely self-reports these; nothing
 * here is a client-side fabrication or a fixed default dressed up as data.
 */
export async function runMeetingAgentTurn(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  task: string;
  conversationContext?: string;
  effort?: "low" | "medium" | "high";
  // Defaults to the War Room's exact original framing text — every existing
  // caller (War Room) is byte-for-byte unaffected. The AI Delivery Board
  // (Phase 5) passes its own label so agents aren't told they're in the
  // wrong boardroom.
  meetingLabel?: string;
  organizationId?: string;
  contextQuery?: string;
}): Promise<MeetingTurnResult & { usage: { inputTokens: number; outputTokens: number } }> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const persona = getPersona(params.agentType);

  await setAgentStatus(params.agentId, "THINKING", params.task);

  try {
    const memoryContext = await loadAgentMemoryContext(params.agentId);
    const meetingLabel = params.meetingLabel ?? "AI Executive Board meeting";
    const engineContext = params.organizationId
      ? await buildAgentContext(params.organizationId, { agentId: params.agentId, agentType: params.agentType, clientQuery: params.contextQuery }).catch((error) => {
          console.error("[agent-runtime] buildAgentContext failed, continuing without it:", error);
          return "";
        })
      : "";

    const result = await generateStructured({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". You are speaking in a live ${meetingLabel} (a real boardroom, not a chat). Alongside your actual contribution ("content"), honestly self-report: your priority for this point (LOW/NORMAL/HIGH/URGENT), your genuine confidence in it (0-100 — vary this based on how sure you actually are, never a fixed number), an optional one-line "suggestedAction" if someone should concretely act on this, and optional "evidence" — a specific fact, figure, or piece of reasoning backing your point (omit if you don't have any).`,
      userContent: [
        memoryContext,
        engineContext || null,
        params.conversationContext ? `Conversation so far:\n${params.conversationContext}` : null,
        `Your task now: ${params.task}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 2048,
      effort: params.effort ?? "medium",
      schema: MeetingTurnSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    await recordAgentAIUsage(params.agentId, result.provider, result.model, result.inputTokens, result.outputTokens, "meeting-agent-turn");

    return {
      ...result.parsed,
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    };
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

/**
 * Structured end-of-meeting notes — summary, a real execution plan
 * (actionItems), risks, blockers, recommendations, next steps — as six
 * real, independently-rendered sections instead of one prose blob. Same
 * honest-or-nothing rule as everywhere else: an empty array means the
 * agent genuinely found nothing for that section, not a placeholder.
 */
export async function runMeetingNotesTurn(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  transcript: string;
  organizationId?: string;
}): Promise<MeetingNotes & { usage: { inputTokens: number; outputTokens: number } }> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const persona = getPersona(params.agentType);

  await setAgentStatus(params.agentId, "ANALYZING", "Writing meeting notes");

  try {
    const engineContext = params.organizationId
      ? await buildAgentContext(params.organizationId, { agentId: params.agentId, agentType: params.agentType }).catch((error) => {
          console.error("[agent-runtime] buildAgentContext failed, continuing without it:", error);
          return "";
        })
      : "";

    const result = await generateStructured({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". Write the official record for this AI Executive Board meeting from its full transcript: a concise "summary" (3-6 sentences), a real execution-plan list "actionItems" (each a concrete assignment made — "title", "owner" as one of CEO/SALES/MARKETING/PROPOSAL/OUTREACH/HUMAN, "priority" LOW/NORMAL/HIGH/URGENT, "dueInDays" as a small integer number of days from today, "kpi" naming the one metric that proves it worked, and "expectedImpact" stating the concrete business impact — never invent an owner, KPI, or impact the discussion doesn't actually support), "risks" (real concerns raised), "blockers" (each a real thing actually stalling progress right now, with "description" and a concrete "proposedSolution" — leave this list empty if nothing in the transcript is genuinely blocked, never invent a blocker to fill the section), "recommendations" (suggestions made), and "nextSteps" (what happens next). Leave any list empty if the transcript genuinely didn't cover it — never pad a list to make it look complete.`,
      userContent: [engineContext || null, params.transcript || "No discussion took place."].filter(Boolean).join("\n\n"),
      maxTokens: 2048,
      effort: "low",
      schema: MeetingNotesSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    await recordAgentAIUsage(params.agentId, result.provider, result.model, result.inputTokens, result.outputTokens, "meeting-notes-turn");

    return {
      ...result.parsed,
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    };
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

/**
 * AI Proposal Review Board turn: one board member's real, structured review
 * of a proposal/quotation/contract/invoice — opinion, strengths, weaknesses,
 * recommendations, self-reported confidence, and (only when the agent can
 * honestly estimate them) win probability / profit margin. The Finance and
 * Legal seats additionally return a structured profitAnalysis/riskAnalysis
 * via the same single call (no extra round-trip) — pass `specialty` to get
 * the richer, correctly-typed schema back.
 */
export async function runReviewAgentTurn(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  task: string;
  conversationContext?: string;
  specialty: "FINANCE";
  organizationId?: string;
  contextQuery?: string;
  calibrationContext?: string;
}): Promise<FinanceReviewTurnResult & { usage: { inputTokens: number; outputTokens: number } }>;
export async function runReviewAgentTurn(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  task: string;
  conversationContext?: string;
  specialty: "LEGAL";
  organizationId?: string;
  contextQuery?: string;
  calibrationContext?: string;
}): Promise<LegalReviewTurnResult & { usage: { inputTokens: number; outputTokens: number } }>;
export async function runReviewAgentTurn(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  task: string;
  conversationContext?: string;
  specialty?: undefined;
  organizationId?: string;
  contextQuery?: string;
  calibrationContext?: string;
}): Promise<ReviewTurnResult & { usage: { inputTokens: number; outputTokens: number } }>;
export async function runReviewAgentTurn(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  task: string;
  conversationContext?: string;
  specialty?: "FINANCE" | "LEGAL";
  organizationId?: string;
  contextQuery?: string;
  // Real historical calibration text (src/lib/ai/prediction-calibration.ts)
  // — how accurate this board's past winProbability estimates actually
  // were, banded against real terminal Proposal outcomes. This is the
  // feedback half of the self-improvement loop: real past outcomes changing
  // what an agent sees before it estimates a new one. undefined when there
  // isn't yet enough real data to calibrate against.
  calibrationContext?: string;
}): Promise<(ReviewTurnResult | FinanceReviewTurnResult | LegalReviewTurnResult) & { usage: { inputTokens: number; outputTokens: number } }> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const persona = getPersona(params.agentType);
  const schema = params.specialty === "FINANCE" ? FinanceReviewTurnSchema : params.specialty === "LEGAL" ? LegalReviewTurnSchema : ReviewTurnSchema;

  await setAgentStatus(params.agentId, "ANALYZING", params.task);

  try {
    const memoryContext = await loadAgentMemoryContext(params.agentId);
    const engineContext = params.organizationId
      ? await buildAgentContext(params.organizationId, { agentId: params.agentId, agentType: params.agentType, clientQuery: params.contextQuery }).catch((error) => {
          console.error("[agent-runtime] buildAgentContext failed, continuing without it:", error);
          return "";
        })
      : "";

    const specialtyInstruction =
      params.specialty === "FINANCE"
        ? ` You must also fill in a structured "profitAnalysis": honestly estimate revenue/cost/margins from the real numbers you were given, rate payment risk, and note discount impact — never invent a number you weren't given a basis for; leave a field out entirely rather than guessing.`
        : params.specialty === "LEGAL"
          ? ` You must also fill in a structured "riskAnalysis": whether contract terms look complete, which clauses (if any) appear to be missing, whether an NDA is warranted, liability/warranty risk, and an honest overall risk level.`
          : "";

    const result = await generateStructured({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". You are one of 8 board members in a real AI Proposal Review Board meeting, reviewing a real document before it goes to a client. Give your honest "opinion" (a few sentences, from your role's perspective), concrete "strengths" and "weaknesses" you actually see (empty arrays are genuinely fine if you don't see any), 0-8 concrete "recommendations" you'd honestly stand behind, a "confidenceScore" (0-100, how confident you are in your own assessment — vary this honestly), and — only if you have a real basis to estimate them — a "winProbability" (0-100) and/or "profitMarginEstimate" (a percent). Omit winProbability/profitMarginEstimate entirely rather than guessing if you don't have grounds for either.${specialtyInstruction}`,
      userContent: [
        memoryContext,
        engineContext || null,
        params.calibrationContext ?? null,
        params.conversationContext ? `Discussion so far:\n${params.conversationContext}` : null,
        `Your task now: ${params.task}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 2048,
      effort: "medium",
      schema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    await recordAgentAIUsage(params.agentId, result.provider, result.model, result.inputTokens, result.outputTokens, "review-agent-turn");

    return {
      ...result.parsed,
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    };
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

/**
 * AI Proposal Review Board's formal vote — APPROVE / APPROVE_WITH_CHANGES /
 * REQUEST_REVISION / REJECT, restricted to those 4 VoteChoice values (the
 * War Room's runAgentVote keeps the original 6-choice VoteSchema untouched).
 */
export async function runReviewVoteTurn(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  topic: string;
  description?: string;
  conversationContext?: string;
  organizationId?: string;
  contextQuery?: string;
}): Promise<ReviewVoteResult> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const persona = getPersona(params.agentType);

  await setAgentStatus(params.agentId, "ANALYZING", `Voting on: ${params.topic}`);

  try {
    const memoryContext = await loadAgentMemoryContext(params.agentId);
    const engineContext = params.organizationId
      ? await buildAgentContext(params.organizationId, { agentId: params.agentId, agentType: params.agentType, clientQuery: params.contextQuery }).catch((error) => {
          console.error("[agent-runtime] buildAgentContext failed, continuing without it:", error);
          return "";
        })
      : "";

    const result = await generateStructured({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". You are casting your final formal vote in a real AI Proposal Review Board meeting on whether this document should go to the client. Vote APPROVE (ready to send as-is), APPROVE_WITH_CHANGES (send once the small fixes you name are made), REQUEST_REVISION (needs real rework before it should go out — say what), or REJECT (should not go out at all — say why). Give concrete reasoning grounded in your role, not a generic rubber stamp.`,
      userContent: [
        memoryContext,
        engineContext || null,
        params.conversationContext ? `Discussion so far:\n${params.conversationContext}` : null,
        `Document under review: ${params.topic}`,
        params.description ? `Details: ${params.description}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 1024,
      effort: "medium",
      schema: ReviewVoteSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    await recordAgentAIUsage(params.agentId, result.provider, result.model, result.inputTokens, result.outputTokens, "review-vote-turn");

    return result.parsed;
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

/**
 * One real Claude call for the AI Project Manager, analyzing exactly one
 * real project — solo, not a meeting participant. `projectContext` must be
 * real data (task list, deadlines, budget/spend, team, and any
 * deterministically-detected ProjectRisk rows); this call never invents a
 * risk, number, or status beyond what it's given.
 */
export async function runProjectManagerTurn(params: {
  agentId: string;
  agentName: string;
  task: string;
  projectContext: string;
  organizationId?: string;
  contextQuery?: string;
  // Enriches buildAgentContext's project section (milestones/risks/upcoming
  // tasks) on top of the projectContext string already passed in above.
  projectId?: string;
}): Promise<ProjectManagerTurnResult & { usage: { inputTokens: number; outputTokens: number } }> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const persona = getPersona("PROJECT_MANAGER");

  await setAgentStatus(params.agentId, "ANALYZING", params.task);

  try {
    const memoryContext = await loadAgentMemoryContext(params.agentId);
    const engineContext = params.organizationId
      ? await buildAgentContext(params.organizationId, {
          agentId: params.agentId,
          projectId: params.projectId,
          clientQuery: params.contextQuery,
        }).catch((error) => {
          console.error("[agent-runtime] buildAgentContext failed, continuing without it:", error);
          return "";
        })
      : "";

    const result = await generateStructured({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". You are analyzing ONE specific real project on your own — not in a meeting, not speaking to other agents. Your task: ${params.task}. Give a concise "summary", a real prioritized list of what matters most right now, honest "riskAssessments" reviewing whatever real risk findings you were given (never invent a new one that isn't grounded in the data below), concrete "recommendations", and — only if the data below genuinely supports it — "suggestedAssignments" for currently-unassigned work. Leave any list empty rather than padding it.`,
      userContent: [memoryContext, engineContext || null, `Real project data:\n${params.projectContext}`].filter(Boolean).join("\n\n"),
      maxTokens: 2048,
      effort: "medium",
      schema: ProjectManagerTurnSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    await recordAgentAIUsage(params.agentId, result.provider, result.model, result.inputTokens, result.outputTokens, "project-manager-turn");

    return {
      ...result.parsed,
      usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    };
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

/**
 * Real, live web-search-powered company discovery for Lead Finder / Client
 * Finder. Two Claude calls: (1) research, with the `web_search_20250305`
 * server tool actually querying the live web — never hallucinated; (2) a
 * tool-free structured-output pass that extracts a clean list from that
 * research text. If the research pass finds nothing, the extraction
 * honestly returns an empty list rather than inventing companies.
 */
export async function runWebSearchDiscovery(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  query: string;
  resultKind: "lead" | "client";
  /** Rendered via describeFilters() in src/lib/validations/discovery.ts — folded into the search prompt since no local business-data provider exists to filter instead. */
  filtersDescription?: string;
}): Promise<{
  companies: DiscoveredCompany[];
  researchSummary: string;
  usage: { inputTokens: number; outputTokens: number };
}> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const persona = getPersona(params.agentType);

  await setAgentStatus(params.agentId, "RESEARCHING", `Searching the web: ${params.query}`);

  try {
    const searchResult = await generateText({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". You have live web search available for this task — use it for real, current information. Never invent a company that didn't actually show up in your search results.`,
      userContent: [
        params.resultKind === "lead"
          ? `Search the web and find real, currently-operating companies matching this criteria: "${params.query}".`
          : `Search the web and find real, currently-operating companies that would make an ideal long-term client matching this profile: "${params.query}".`,
        params.filtersDescription ? `Additional filters to honor: ${params.filtersDescription}.` : null,
        `For each one, note its name, official website, industry, and any public contact email/phone you can find, plus one sentence on why it's a good ${params.resultKind === "lead" ? "sales lead" : "client"} fit.`,
      ]
        .filter(Boolean)
        .join(" "),
      maxTokens: 4096,
      webSearch: { maxUses: 5 },
    });

    const researchSummary = searchResult.text;

    await setAgentStatus(params.agentId, "ANALYZING", "Extracting structured results from research");

    const extraction = await generateStructured({
      system:
        "Extract a clean, deduplicated, structured list of companies from the research notes you're given. Only include companies that were actually named in the notes — never invent one. If the notes found nothing usable, return an empty list.",
      userContent: researchSummary || "No research notes were produced — no companies were found.",
      maxTokens: 2048,
      effort: "low",
      schema: DiscoveredCompaniesSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    // Both passes' token usage is summed under one recordAIUsage call (as it
    // always was, back when both passes were guaranteed to be Anthropic) —
    // attributed to the extraction pass's provider/model, since the two
    // passes can now genuinely be served by two different providers if the
    // chain fell over mid-turn. An approximation, not a precision billing
    // split; see this file's header comment in fallback.ts for the same
    // tradeoff on the other two-pass functions below.
    await recordAgentAIUsage(
      params.agentId,
      extraction.provider,
      extraction.model,
      searchResult.inputTokens + extraction.inputTokens,
      searchResult.outputTokens + extraction.outputTokens,
      "web-search-discovery",
    );

    return {
      companies: extraction.parsed.companies,
      researchSummary,
      usage: {
        inputTokens: searchResult.inputTokens + extraction.inputTokens,
        outputTokens: searchResult.outputTokens + extraction.outputTokens,
      },
    };
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

/**
 * AI Company Intelligence report — same two-pass shape as
 * runWebSearchDiscovery: a real web-search research pass, then a structured
 * extraction pass. confidenceScore is the model's own honest self-report of
 * how much it could actually verify from real search results, not a fixed
 * number — a thin/unfindable web presence should score low confidence.
 */
export async function runCompanyIntelligenceTurn(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  companyName: string;
  companyWebsite?: string;
  companyContext?: string;
}): Promise<CompanyIntelligenceOutput & { usage: { inputTokens: number; outputTokens: number } }> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const persona = getPersona(params.agentType);

  await setAgentStatus(params.agentId, "RESEARCHING", `Researching ${params.companyName}`);

  try {
    const searchResult = await generateText({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". You have live web search available — use it to genuinely research this real company. Never invent facts you didn't find.`,
      userContent: [
        `Research this company thoroughly: "${params.companyName}"${params.companyWebsite ? ` (${params.companyWebsite})` : ""}.`,
        params.companyContext ? `Context already known: ${params.companyContext}` : null,
        "Cover: what the business actually does, its products and services, the technology it appears to use (from job posts, site tech, integrations), its digital presence quality (website, SEO signals, apparent performance), any real growth/hiring/expansion signals you find, and what business opportunities or software/automation needs a B2B vendor might realistically pitch them.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      maxTokens: 4096,
      webSearch: { maxUses: 6 },
    });

    const researchSummary = searchResult.text;

    await setAgentStatus(params.agentId, "ANALYZING", "Structuring the intelligence report");

    const extraction = await generateStructured({
      system:
        "Turn the research notes into a structured company intelligence report. Every list should only contain things genuinely supported by the notes — leave a list empty rather than padding it. confidenceScore (0-100) must honestly reflect how much real, specific information the notes actually contained versus how thin/generic they were.",
      userContent: researchSummary || "No research notes were produced.",
      maxTokens: 3072,
      effort: "medium",
      schema: CompanyIntelligenceOutputSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    await recordAgentAIUsage(
      params.agentId,
      extraction.provider,
      extraction.model,
      searchResult.inputTokens + extraction.inputTokens,
      searchResult.outputTokens + extraction.outputTokens,
      "company-intelligence-turn",
    );

    return {
      ...extraction.parsed,
      usage: {
        inputTokens: searchResult.inputTokens + extraction.inputTokens,
        outputTokens: searchResult.outputTokens + extraction.outputTokens,
      },
    };
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}

const RESEARCH_TOPIC_PROMPTS: Record<string, string> = {
  COMPETITORS: "who this company's real competitors appear to be, and how it seems to differentiate",
  TECHNOLOGY: "what technology stack, tools, or platforms this company appears to use",
  BUSINESS_MODEL: "how this company actually makes money and who its customers are",
  EXPANSION: "any real signs of geographic or market expansion",
  NEWS: "recent real news or public announcements about this company",
  HIRING_TRENDS: "what roles this company appears to be hiring for and what that signals",
  PUBLIC_SIGNALS: "any other real public signals — reviews, press, social presence, notable mentions",
  GENERAL: "a general overview of this company for sales research purposes",
};

/**
 * AI Research Engine — one topic-scoped, real web-search-backed research
 * note. Same two-pass shape as the other web-search functions above.
 */
export async function runResearchNoteTurn(params: {
  agentId: string;
  agentType: ExecutiveAgentType;
  agentName: string;
  companyName: string;
  companyWebsite?: string;
  topic: string;
}): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number } }> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const persona = getPersona(params.agentType);
  const topicPrompt = RESEARCH_TOPIC_PROMPTS[params.topic] ?? RESEARCH_TOPIC_PROMPTS.GENERAL;

  await setAgentStatus(params.agentId, "RESEARCHING", `Researching ${params.companyName}: ${params.topic}`);

  try {
    const searchResult = await generateText({
      system: `${persona.systemPrompt}\n\nYour name in this organization is "${params.agentName}". You have live web search available — use it for real, current information. Never invent facts you didn't find.`,
      userContent: `Research ${topicPrompt} for the real company "${params.companyName}"${params.companyWebsite ? ` (${params.companyWebsite})` : ""}.`,
      maxTokens: 3072,
      webSearch: { maxUses: 5 },
    });

    const researchSummary = searchResult.text;

    await setAgentStatus(params.agentId, "ANALYZING", "Writing up the research note");

    const extraction = await generateStructured({
      system:
        "Write a clean, well-organized research note from these raw research findings — no meta-commentary about the search process itself, just the actual findings. If nothing substantive was found, say so honestly in one sentence rather than padding.",
      userContent: researchSummary || "No research notes were produced.",
      maxTokens: 1536,
      effort: "low",
      schema: ResearchNoteOutputSchema,
    });

    await setAgentStatus(params.agentId, "COMPLETED");
    await recordAgentAIUsage(
      params.agentId,
      extraction.provider,
      extraction.model,
      searchResult.inputTokens + extraction.inputTokens,
      searchResult.outputTokens + extraction.outputTokens,
      "research-note-turn",
    );

    return {
      content: extraction.parsed.content,
      usage: {
        inputTokens: searchResult.inputTokens + extraction.inputTokens,
        outputTokens: searchResult.outputTokens + extraction.outputTokens,
      },
    };
  } catch (error) {
    await setAgentStatus(params.agentId, "IDLE");
    throw error;
  }
}
