import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";
import { generateStructured } from "@/lib/ai/fallback";
import { generateEmailDraft } from "@/lib/outreach/draft-generator";
import { KVL_SERVICES } from "./kvl-service-catalog";
import type { ConversationIntelligence, BuyingStage } from "@/generated/prisma/client";

/**
 * Phase 6 (AI Conversation Intelligence) — turns the real per-thread
 * transcript (a "thread" = the existing (organizationId, contactId)
 * grouping the Inbox UI already uses — no new Thread/Message model) into
 * structured, evidence-linked sales intelligence. Reuses the exact
 * grounding discipline already proven in company-conversation-summary.ts
 * (never invent, UNKNOWN when unsupported) but at finer per-thread
 * granularity and with the much richer schema this phase's spec asked for.
 */

const KVL_SERVICE_IDS = KVL_SERVICES.map((s) => s.id) as [string, ...string[]];

const EvidenceItemSchema = z.object({
  value: z.string(),
  sourceMessageId: z.string().nullable(),
  sourceQuote: z.string().nullable(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  classification: z.enum(["CONFIRMED", "INFERRED"]),
});

const ObjectionSchema = EvidenceItemSchema.extend({
  type: z.enum(["BUDGET", "TIMELINE", "TECHNICAL_COMPLEXITY", "SECURITY", "INTEGRATION", "APPROVAL", "COMPETITION", "SCOPE", "SUPPORT", "CONTRACT_TERMS", "OTHER"]),
});

const RequirementSchema = EvidenceItemSchema.extend({
  classificationSource: z.enum(["CLIENT_STATED_REQUIREMENT", "AI_RECOMMENDATION"]),
});

const QuestionSchema = z.object({
  question: z.string(),
  sourceMessageId: z.string().nullable(),
  answered: z.boolean(),
});

const RequestedServiceSchema = z.object({
  serviceId: z.enum([...KVL_SERVICE_IDS, "SERVICE_UNMAPPED"]),
  rawMention: z.string(),
  sourceMessageId: z.string().nullable(),
});

const CompetitorMentionSchema = z.object({
  competitorName: z.string(),
  context: z.string(),
  sourceMessageId: z.string().nullable(),
});

const ConversationAnalysisSchema = z.object({
  intent: z.enum(["INFORMATION_REQUEST", "INTERESTED", "EVALUATING", "REQUEST_FOR_PROPOSAL", "REQUEST_FOR_DEMO", "NEGOTIATING", "READY_TO_BUY", "NOT_INTERESTED", "FOLLOW_UP", "SUPPORT", "GENERAL", "UNKNOWN"]),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "MIXED", "NEGATIVE", "UNKNOWN"]),
  urgency: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
  detectedBuyingStage: z.enum(["UNKNOWN", "TARGET", "AWARENESS", "CONSIDERATION", "DECISION", "NEGOTIATION", "CUSTOMER", "LOST"]).nullable(),
  detectedBuyingStageWhy: z.string().nullable(),
  objections: z.array(ObjectionSchema).max(10),
  requirements: z.array(RequirementSchema).max(10),
  questions: z.array(QuestionSchema).max(10),
  requestedServices: z.array(RequestedServiceSchema).max(6),
  competitorMentions: z.array(CompetitorMentionSchema).max(5),
  budgetSignal: z.enum(["EXPLICIT_BUDGET", "BUDGET_RANGE", "BUDGET_CONCERN", "PRICE_SENSITIVITY", "NO_BUDGET_MENTION", "UNKNOWN"]),
  budgetSignalDetail: z.string().nullable(),
  timelineSignalRaw: z.string().nullable(),
  timelineSignalNormalized: z.string().nullable(),
  timelineSourceMessageId: z.string().nullable(),
  decisionMakerSignal: z.enum(["KNOWN_DECISION_MAKER", "POTENTIAL_DECISION_MAKER", "NOT_IDENTIFIED"]),
  decisionMakerSignalWhy: z.string().nullable(),
  nextAction: z.object({
    clientRequestedAction: z.string().nullable(),
    internalAction: z.string().nullable(),
    aiRecommendedAction: z.string().nullable(),
  }),
  summary: z.object({
    status: z.string(),
    clientNeed: z.string().nullable(),
    objection: z.string().nullable(),
    timeline: z.string().nullable(),
    requestedService: z.string().nullable(),
    nextAction: z.string().nullable(),
    evidence: z.array(z.string()).max(8),
  }),
  overallConfidence: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
});

interface TranscriptMessage {
  id: string;
  recordType: "EmailDraft" | "Reply";
  direction: "OUTBOUND" | "INBOUND";
  at: Date;
  text: string;
}

async function buildThreadTranscript(organizationId: string, contactId: string): Promise<TranscriptMessage[]> {
  const [drafts, replies] = await Promise.all([
    prisma.emailDraft.findMany({ where: { organizationId, contactId, sentAt: { not: null } }, orderBy: { sentAt: "asc" } }),
    prisma.reply.findMany({ where: { organizationId, contactId }, orderBy: { receivedAt: "asc" } }),
  ]);

  const messages: TranscriptMessage[] = [
    ...drafts.map((d) => ({ id: d.id, recordType: "EmailDraft" as const, direction: "OUTBOUND" as const, at: d.sentAt!, text: `Subject: ${d.subject ?? "(no subject)"}\n${d.body}` })),
    ...replies.map((r) => ({ id: r.id, recordType: "Reply" as const, direction: "INBOUND" as const, at: r.receivedAt, text: r.content })),
  ];
  messages.sort((a, b) => a.at.getTime() - b.at.getTime());
  return messages;
}

export interface AnalyzeConversationResult {
  intelligence: ConversationIntelligence | null;
  skipped: boolean;
  reason: string | null;
}

/**
 * Cost control (§31): compares the thread's CURRENT message-id set against
 * the latest existing ConversationIntelligence row's analyzedMessageIds —
 * identical set means nothing new since the last real analysis, so this
 * returns the cached row instead of making a new AI call.
 */
export async function analyzeConversation(organizationId: string, contactId: string): Promise<AnalyzeConversationResult> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== organizationId) return { intelligence: null, skipped: true, reason: "Contact not found." };

  const transcript = await buildThreadTranscript(organizationId, contactId);
  if (transcript.length === 0) return { intelligence: null, skipped: true, reason: "No real messages in this thread yet." };

  const currentMessageIds = transcript.map((m) => `${m.recordType}:${m.id}`);
  const latest = await prisma.conversationIntelligence.findFirst({ where: { organizationId, contactId }, orderBy: { generatedAt: "desc" } });
  if (latest && sameMessageSet(latest.analyzedMessageIds, currentMessageIds)) {
    return { intelligence: latest, skipped: true, reason: "No new messages since the last analysis — cached intelligence reused." };
  }

  if (!isAIConnected()) {
    const failed = await prisma.conversationIntelligence.create({
      data: { organizationId, companyId: contact.companyId, contactId, threadId: contactId, status: "FAILED", error: "AI provider not configured.", analyzedMessageIds: currentMessageIds },
    });
    return { intelligence: failed, skipped: false, reason: "AI not connected." };
  }

  const transcriptText = transcript.map((m) => `[${m.recordType}:${m.id}] ${m.direction} — ${m.at.toISOString()}\n${m.text}`).join("\n\n---\n\n");
  const serviceCatalogText = KVL_SERVICES.map((s) => `${s.id}: ${s.label} — ${s.description}`).join("\n");

  try {
    const result = await generateStructured({
      system: `You are extracting structured sales intelligence from a REAL email thread between our team and one prospect/client. The transcript below (tagged with real [RecordType:id] identifiers) is the complete, real, chronological record for this thread — nothing else exists and nothing outside it may be used.

ABSOLUTE RULES:
- Every non-UNKNOWN/non-null conclusion MUST cite a real sourceMessageId from the transcript's own [RecordType:id] tags, and where possible a real short sourceQuote copied from that message.
- If the transcript does not clearly support a field, return UNKNOWN/null/empty array for it — NEVER invent, guess, or estimate (this applies especially to budget and timeline — do not calculate a budget from context, only extract what was literally stated).
- classification is CONFIRMED only when a message explicitly states it; INFERRED when reasonably derived from real language but not explicitly stated. Never silently promote an INFERRED item to CONFIRMED.
- requirements: classificationSource is CLIENT_STATED_REQUIREMENT only if the CLIENT (inbound message) said it. If it's something WE suggested or an AI-recommended next step, it is NEVER a requirement — omit it from requirements entirely.
- requestedServices: map to the closest real KVL service ID from the catalog below ONLY if the mapping is genuinely clear; otherwise use SERVICE_UNMAPPED — never force a match.
- competitorMentions: only real company names actually mentioned as being considered/compared — never infer "we will lose to X" or any conclusion beyond the literal mention.
- nextAction: clientRequestedAction = something the client explicitly asked for; internalAction = something we said we'd do; aiRecommendedAction = your own suggestion, clearly separate from the other two, never presented as something either party committed to.
- detectedBuyingStage is your own read of the conversation ONLY — it does not change any official CRM record.

KVL Service Catalog:
${serviceCatalogText}`,
      userContent: `THREAD TRANSCRIPT:\n\n${transcriptText}`,
      maxTokens: 3000,
      effort: "medium",
      schema: ConversationAnalysisSchema,
    });

    const p = result.parsed;
    const intelligence = await prisma.conversationIntelligence.create({
      data: {
        organizationId,
        companyId: contact.companyId,
        contactId,
        threadId: contactId,
        intent: p.intent,
        sentiment: p.sentiment,
        urgency: p.urgency,
        detectedBuyingStage: p.detectedBuyingStage as BuyingStage | null,
        detectedBuyingStageWhy: p.detectedBuyingStageWhy,
        objections: p.objections,
        requirements: p.requirements.filter((r) => r.classificationSource === "CLIENT_STATED_REQUIREMENT"),
        questions: p.questions,
        requestedServices: p.requestedServices,
        competitorMentions: p.competitorMentions,
        budgetSignal: p.budgetSignal,
        budgetSignalDetail: p.budgetSignalDetail,
        timelineSignalRaw: p.timelineSignalRaw,
        timelineSignalNormalized: p.timelineSignalNormalized,
        timelineSourceMessageId: p.timelineSourceMessageId,
        decisionMakerSignal: p.decisionMakerSignal,
        decisionMakerSignalWhy: p.decisionMakerSignalWhy,
        nextAction: p.nextAction,
        summary: p.summary,
        confidence: p.overallConfidence,
        status: "COMPLETED",
        analyzedMessageIds: currentMessageIds,
        model: result.model,
        provider: result.provider,
      },
    });
    return { intelligence, skipped: false, reason: null };
  } catch (error) {
    const failed = await prisma.conversationIntelligence.create({
      data: {
        organizationId,
        companyId: contact.companyId,
        contactId,
        threadId: contactId,
        status: "FAILED",
        error: error instanceof Error ? error.message : String(error),
        analyzedMessageIds: currentMessageIds,
      },
    });
    console.error(`[conversation-intelligence] analysis failed for contact ${contactId}:`, error);
    return { intelligence: failed, skipped: false, reason: "AI analysis failed — see error field." };
  }
}

function sameMessageSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

/**
 * Human override (§38) — creates a NEW row (never mutates/erases the AI
 * original) copying the latest intelligence with one field overridden.
 */
export async function overrideConversationIntelligence(
  organizationId: string,
  contactId: string,
  field: "detectedBuyingStage" | "intent" | "sentiment" | "urgency",
  newValue: string,
  actorUserId: string,
  reason: string,
): Promise<ConversationIntelligence | null> {
  const latest = await prisma.conversationIntelligence.findFirst({ where: { organizationId, contactId }, orderBy: { generatedAt: "desc" } });
  if (!latest) return null;

  return prisma.conversationIntelligence.create({
    data: {
      organizationId,
      companyId: latest.companyId,
      contactId,
      threadId: contactId,
      intent: field === "intent" ? (newValue as never) : latest.intent,
      sentiment: field === "sentiment" ? (newValue as never) : latest.sentiment,
      urgency: field === "urgency" ? (newValue as never) : latest.urgency,
      detectedBuyingStage: field === "detectedBuyingStage" ? (newValue as BuyingStage) : latest.detectedBuyingStage,
      detectedBuyingStageWhy: latest.detectedBuyingStageWhy,
      objections: latest.objections as object,
      requirements: latest.requirements as object,
      questions: latest.questions as object,
      requestedServices: latest.requestedServices as object,
      competitorMentions: latest.competitorMentions as object,
      budgetSignal: latest.budgetSignal,
      budgetSignalDetail: latest.budgetSignalDetail,
      timelineSignalRaw: latest.timelineSignalRaw,
      timelineSignalNormalized: latest.timelineSignalNormalized,
      timelineSourceMessageId: latest.timelineSourceMessageId,
      decisionMakerSignal: latest.decisionMakerSignal,
      decisionMakerSignalWhy: latest.decisionMakerSignalWhy,
      nextAction: latest.nextAction as object,
      summary: latest.summary as object,
      confidence: latest.confidence,
      status: latest.status,
      analyzedMessageIds: latest.analyzedMessageIds,
      overriddenField: field,
      overriddenValue: newValue,
      overriddenByUserId: actorUserId,
      overrideReason: reason,
      model: latest.model,
      provider: latest.provider,
    },
  });
}

// ===== Suggested Reply (§23-24) =====

export interface SuggestedReplyResult {
  ok: boolean;
  draftId: string | null;
  error: string | null;
}

/**
 * Generates a real AI-suggested reply as a normal EmailDraft (status DRAFT
 * — the EXACT existing approval pipeline governs it from here, never a
 * parallel lifecycle). Grounded in the real latest ConversationIntelligence
 * + real Contact/Company data via generateEmailDraft's existing
 * extraContext extension point (Phase 1) — never invents pricing, dates,
 * discounts, or commitments (the same "only what's in context" system
 * prompt discipline draft-generator.ts already enforces).
 *
 * Deliberately distinct from (not a duplicate of) suggested-reply-draft.ts's
 * createDraftFromSuggestedReply: that one persists the single-message
 * suggestion analyzeReply already computed on the Reply itself (cheap, no
 * new AI call, used per-reply-bubble on the Contact detail page). This one
 * makes one fresh, thread-level AI call grounded in the FULL accumulated
 * ConversationIntelligence (objections/requirements/budget/timeline across
 * every message), for the Phase 6 Inbox thread panel's "give me the best
 * next reply for this whole conversation" action. Both terminate in the
 * exact same EmailDraft DRAFT->...->SENT pipeline — no second approval or
 * send path is introduced. Idempotent: reuses an existing unsent draft
 * already generated for this same inbound reply instead of creating a
 * second one on repeated clicks.
 */
export async function generateSuggestedReply(organizationId: string, contactId: string): Promise<SuggestedReplyResult> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== organizationId) return { ok: false, draftId: null, error: "Contact not found." };

  const latestReply = await prisma.reply.findFirst({ where: { organizationId, contactId }, orderBy: { receivedAt: "desc" } });
  if (!latestReply) return { ok: false, draftId: null, error: "No inbound reply to respond to yet." };

  const existingDraft = await prisma.emailDraft.findFirst({ where: { organizationId, contactId, inReplyToId: latestReply.id, status: "DRAFT" }, orderBy: { createdAt: "desc" } });
  if (existingDraft) return { ok: true, draftId: existingDraft.id, error: null };

  const intelligence = await prisma.conversationIntelligence.findFirst({ where: { organizationId, contactId }, orderBy: { generatedAt: "desc" } });

  const summary = intelligence?.summary as { status?: string; clientNeed?: string; objection?: string; timeline?: string; requestedService?: string; nextAction?: string } | undefined;
  const extraContext = intelligence
    ? [
        `Real conversation intelligence for this thread (status: ${intelligence.status}):`,
        summary?.status ? `Current status: ${summary.status}` : null,
        summary?.clientNeed ? `Client need: ${summary.clientNeed}` : null,
        summary?.objection ? `Objection raised: ${summary.objection}` : null,
        summary?.timeline ? `Timeline mentioned: ${summary.timeline}` : null,
        summary?.requestedService ? `Requested service: ${summary.requestedService}` : null,
        `Real most recent inbound message: "${latestReply.content}"`,
        "IMPORTANT: do not invent a price, discount, delivery date, guarantee, or commitment not already present in this context. If the client asked for something not covered here (e.g. a specific price), write a safe response that asks for clarification or says we'll follow up with specifics, rather than inventing an answer.",
      ]
        .filter(Boolean)
        .join("\n")
    : `Real most recent inbound message: "${latestReply.content}". No structured conversation intelligence is available yet — ground the reply only in this real message.`;

  try {
    const draft = await generateEmailDraft({
      contactId,
      // Not FOLLOW_UP ("hasn't replied yet") — this is a reply TO a real
      // inbound message, the same framing suggested-reply-draft.ts already
      // established CONVERSATION_SUMMARY for.
      purpose: "CONVERSATION_SUMMARY",
      tone: "PROFESSIONAL",
      channel: "EMAIL",
      extraContext,
    });
    await prisma.emailDraft.update({ where: { id: draft.id }, data: { inReplyToId: latestReply.id } });
    return { ok: true, draftId: draft.id, error: null };
  } catch (error) {
    console.error(`[conversation-intelligence] generateSuggestedReply failed for contact ${contactId}:`, error);
    return { ok: false, draftId: null, error: error instanceof Error ? error.message : "Failed to generate a suggested reply." };
  }
}

// ===== Thread Search =====

export interface ThreadSearchResult {
  contactId: string;
  companyId: string | null;
  contactName: string;
  companyName: string | null;
  matchedIn: "REQUIREMENT" | "OBJECTION" | "QUESTION" | "MESSAGE";
  snippet: string;
  intelligenceId: string | null;
}

/**
 * Real keyword search across a real organization's threads — over the
 * latest-per-contact ConversationIntelligence rows (requirements/
 * objections/questions) plus raw Reply content. Every result points at a
 * real contact/company; nothing is synthesized.
 */
export async function searchConversationThreads(organizationId: string, query: string): Promise<ThreadSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const [intelligenceRows, replies] = await Promise.all([
    prisma.conversationIntelligence.findMany({
      where: { organizationId, status: "COMPLETED" },
      orderBy: { generatedAt: "desc" },
      include: { contact: true, company: true },
    }),
    prisma.reply.findMany({
      where: { organizationId, content: { contains: q, mode: "insensitive" } },
      orderBy: { receivedAt: "desc" },
      take: 50,
      include: { contact: true },
    }),
  ]);

  const latestByContact = new Map<string, (typeof intelligenceRows)[number]>();
  for (const row of intelligenceRows) if (!latestByContact.has(row.contactId)) latestByContact.set(row.contactId, row);

  const results: ThreadSearchResult[] = [];
  for (const row of latestByContact.values()) {
    const requirements = row.requirements as Array<{ value: string; sourceMessageId: string | null }>;
    const objections = row.objections as Array<{ value: string; sourceMessageId: string | null }>;
    const questions = row.questions as Array<{ question: string; sourceMessageId: string | null }>;

    const req = requirements.find((r) => r.value?.toLowerCase().includes(q));
    if (req) results.push({ contactId: row.contactId, companyId: row.companyId, contactName: `${row.contact.firstName} ${row.contact.lastName ?? ""}`.trim(), companyName: row.company?.name ?? null, matchedIn: "REQUIREMENT", snippet: req.value, intelligenceId: row.id });

    const obj = objections.find((o) => o.value?.toLowerCase().includes(q));
    if (obj) results.push({ contactId: row.contactId, companyId: row.companyId, contactName: `${row.contact.firstName} ${row.contact.lastName ?? ""}`.trim(), companyName: row.company?.name ?? null, matchedIn: "OBJECTION", snippet: obj.value, intelligenceId: row.id });

    const ques = questions.find((qq) => qq.question?.toLowerCase().includes(q));
    if (ques) results.push({ contactId: row.contactId, companyId: row.companyId, contactName: `${row.contact.firstName} ${row.contact.lastName ?? ""}`.trim(), companyName: row.company?.name ?? null, matchedIn: "QUESTION", snippet: ques.question, intelligenceId: row.id });
  }

  for (const reply of replies) {
    if (results.some((r) => r.contactId === reply.contactId)) continue;
    const idx = reply.content.toLowerCase().indexOf(q);
    const snippet = idx >= 0 ? reply.content.slice(Math.max(0, idx - 40), idx + q.length + 40) : reply.content.slice(0, 80);
    results.push({ contactId: reply.contactId, companyId: reply.contact.companyId, contactName: `${reply.contact.firstName} ${reply.contact.lastName ?? ""}`.trim(), companyName: null, matchedIn: "MESSAGE", snippet, intelligenceId: null });
  }

  return results;
}

// ===== Conversation Analytics =====

export interface ConversationAnalytics {
  totalThreadsAnalyzed: number;
  byIntent: Record<string, number>;
  bySentiment: Record<string, number>;
  byUrgency: Record<string, number>;
  byBudgetSignal: Record<string, number>;
  criticalUrgencyThreads: Array<{ contactId: string; contactName: string; companyName: string | null }>;
  failedAnalysisCount: number;
}

/**
 * Real aggregation over the latest-per-contact ConversationIntelligence
 * rows for this organization — pure counting of what's actually stored,
 * no AI call, no invented trend lines.
 */
export async function getConversationAnalytics(organizationId: string): Promise<ConversationAnalytics> {
  const rows = await prisma.conversationIntelligence.findMany({
    where: { organizationId },
    orderBy: { generatedAt: "desc" },
    include: { contact: true, company: true },
  });

  const latestByContact = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latestByContact.has(row.contactId)) latestByContact.set(row.contactId, row);

  const byIntent: Record<string, number> = {};
  const bySentiment: Record<string, number> = {};
  const byUrgency: Record<string, number> = {};
  const byBudgetSignal: Record<string, number> = {};
  const criticalUrgencyThreads: ConversationAnalytics["criticalUrgencyThreads"] = [];
  let failedAnalysisCount = 0;

  for (const row of latestByContact.values()) {
    if (row.status === "FAILED") {
      failedAnalysisCount += 1;
      continue;
    }
    byIntent[row.intent] = (byIntent[row.intent] ?? 0) + 1;
    bySentiment[row.sentiment] = (bySentiment[row.sentiment] ?? 0) + 1;
    byUrgency[row.urgency] = (byUrgency[row.urgency] ?? 0) + 1;
    byBudgetSignal[row.budgetSignal] = (byBudgetSignal[row.budgetSignal] ?? 0) + 1;
    if (row.urgency === "CRITICAL") {
      criticalUrgencyThreads.push({ contactId: row.contactId, contactName: `${row.contact.firstName} ${row.contact.lastName ?? ""}`.trim(), companyName: row.company?.name ?? null });
    }
  }

  return {
    totalThreadsAnalyzed: latestByContact.size,
    byIntent,
    bySentiment,
    byUrgency,
    byBudgetSignal,
    criticalUrgencyThreads,
    failedAnalysisCount,
  };
}
