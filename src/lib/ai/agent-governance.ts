import { prisma } from "@/lib/prisma";
import type { AgentDomain } from "@/generated/prisma/client";

/**
 * Phase 23 — Unified AI Agent Governance. A thin execution-trace wrapper
 * around whatever real AI call the caller is already making (fallback.ts's
 * generateStructured/generateText, called directly or via
 * src/lib/ai/agent-runtime.ts) — this never makes an AI call itself, never
 * wraps a second runtime, and never duplicates content already stored in
 * its own real model (CareerResume, ApplicationDocument, EmailDraft, ...).
 * It records ONLY that a run happened, who/what triggered it, and a
 * redacted summary — the same content-minimization discipline AuditLog
 * already uses elsewhere in this codebase.
 *
 * A run that throws is recorded as FAILED with the real error message
 * before the error is re-thrown — recording failures is exactly as
 * important as recording successes for a governance trace.
 */
export async function withAgentRunTracing<T>(
  params: {
    organizationId: string;
    userId?: string | null;
    domain: AgentDomain;
    agentKey: string;
    tools?: string[];
    inputSummary: string;
  },
  fn: () => Promise<T>,
  summarize?: (result: T) => { outputSummary?: string; confidence?: number },
): Promise<T> {
  const startedAt = Date.now();
  const run = await prisma.agentRun.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId ?? undefined,
      domain: params.domain,
      agentKey: params.agentKey,
      tools: params.tools ?? [],
      inputSummary: params.inputSummary.slice(0, 2000),
      status: "EXECUTING",
    },
  });

  try {
    const result = await fn();
    const summary = summarize?.(result);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        outputSummary: summary?.outputSummary?.slice(0, 2000),
        confidence: summary?.confidence,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    return result;
  } catch (error) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "Unknown error",
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    throw error;
  }
}
