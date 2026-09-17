import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { generateStructured } from "@/lib/ai/fallback";
import { recordAIUsage } from "@/lib/billing/ai-credits";

/**
 * Website Intelligence — turns a company's existing WebsiteScan audit data
 * (SEOAudit/PerformanceAudit/UXAudit/SecurityAudit, all real deterministic
 * measurements from src/lib/scanner/) into structured, evidence-linked
 * CompanyEvidence rows: RAW_FACT rows straight off the audits (confidence
 * 1.0 — a real measurement, not a guess), then a single grounded AI pass
 * (kind: AI_INTERPRETATION) that turns those facts into plain-language
 * business implications, strictly disallowed from inventing anything (e.g.
 * a financial-loss figure) the facts themselves don't state. Mirrors the
 * "facts feed an AI interpretation layer" discipline already used by
 * src/lib/scanner/ai-report-generator.ts, just persisted as CompanyEvidence
 * instead of an ExecutiveReport.
 */

type FindingRow = { label: string; status: "pass" | "warn" | "fail"; detail: string };

/** Picks the single most severe real finding (a real fail, else a real warn) out of an audit's `findings` Json column — never invented, mirrors ai-report-generator.ts's FindingRow shape. */
function worstFinding(findings: unknown): FindingRow | null {
  const rows = Array.isArray(findings) ? (findings as FindingRow[]) : [];
  return rows.find((f) => f?.status === "fail") ?? rows.find((f) => f?.status === "warn") ?? null;
}

function findingFact(auditLabel: string, findings: unknown): string | null {
  const finding = worstFinding(findings);
  if (!finding) return null;
  return `${auditLabel} — most severe finding [${finding.status.toUpperCase()}]: ${finding.label}: ${finding.detail}`;
}

const InterpretationItemSchema = z.object({
  interpretation: z.string().trim().min(1),
  basedOnFacts: z.array(z.string().trim().min(1)).min(1),
  confidence: z.number().min(0).max(1),
});

const InterpretationsResponseSchema = z.object({
  interpretations: z.array(InterpretationItemSchema).max(4).default([]),
});

export async function buildWebsiteIntelligenceEvidence(
  companyId: string,
  websiteScanId: string,
): Promise<{ factsCreated: number; interpretationsCreated: number }> {
  // Confirm the given WebsiteScan is actually this company's own scan — the
  // where-clause's companyId filter does this via the real FK relation
  // rather than trusting a caller-supplied id pairing blindly.
  const scan = await prisma.websiteScan.findFirst({
    where: { id: websiteScanId, companyId },
    include: { seoAudit: true, performanceAudit: true, uxAudit: true, securityAudit: true },
  });
  if (!scan) return { factsCreated: 0, interpretationsCreated: 0 };

  const sourceUrl = scan.finalUrl ?? scan.url;
  const candidateFacts: string[] = [];

  if (scan.seoAudit) {
    const a = scan.seoAudit;
    candidateFacts.push(`SEO score: ${a.seoScore}/100`);
    const finding = findingFact("SEO audit", a.findings);
    if (finding) candidateFacts.push(finding);
    if (a.imagesTotal > 0) candidateFacts.push(`${a.imagesWithoutAlt} of ${a.imagesTotal} images are missing alt text`);
    candidateFacts.push(`Site is ${a.isIndexable ? "indexable" : "NOT indexable"} by search engines`);
  }

  if (scan.performanceAudit) {
    const a = scan.performanceAudit;
    candidateFacts.push(`Performance score: ${a.performanceScore}/100`);
    candidateFacts.push(`Server response time: ${a.responseTimeMs}ms`);
    const finding = findingFact("Performance audit", a.findings);
    if (finding) candidateFacts.push(finding);
    if (a.renderBlockingScriptCount > 0) candidateFacts.push(`${a.renderBlockingScriptCount} render-blocking script(s) detected`);
  }

  if (scan.uxAudit) {
    const a = scan.uxAudit;
    candidateFacts.push(`UX score: ${a.uxScore}/100`);
    candidateFacts.push(`Alt text coverage: ${a.altTextCoveragePct}%`);
    const finding = findingFact("UX audit", a.findings);
    if (finding) candidateFacts.push(finding);
  }

  if (scan.securityAudit) {
    const a = scan.securityAudit;
    candidateFacts.push(`Security score: ${a.securityScore}/100`);
    candidateFacts.push(a.isHttps ? "Site uses HTTPS" : "Site does NOT use HTTPS");
    const finding = findingFact("Security audit", a.findings);
    if (finding) candidateFacts.push(finding);
    else if (a.exposedSensitiveFileCount > 0) candidateFacts.push(`${a.exposedSensitiveFileCount} exposed sensitive file(s) detected`);
  }

  if (candidateFacts.length === 0) return { factsCreated: 0, interpretationsCreated: 0 };

  // Idempotent: skip any (companyId, fact, source) combination that already
  // exists — safe to re-run from a retryable scheduled job.
  const existing = await prisma.companyEvidence.findMany({
    where: { companyId, source: "WEBSITE_SCAN", fact: { in: candidateFacts } },
    select: { fact: true },
  });
  const existingFacts = new Set(existing.map((e) => e.fact));
  const newFacts = candidateFacts.filter((fact) => !existingFacts.has(fact));

  if (newFacts.length === 0) return { factsCreated: 0, interpretationsCreated: 0 };

  await prisma.companyEvidence.createMany({
    data: newFacts.map((fact) => ({
      companyId,
      kind: "RAW_FACT",
      fact,
      source: "WEBSITE_SCAN",
      sourceUrl,
      confidence: 1.0,
    })),
  });

  const factsCreated = newFacts.length;

  try {
    // Same agent-resolution pattern as src/lib/scanner/ai-report-generator.ts
    // (its sibling in this same "facts -> AI interpretation" flow): the
    // org's active Sales agent, or null if none exists — never guessed.
    const salesAgent = await prisma.aIAgentInstance.findFirst({
      where: { organizationId: scan.organizationId, type: "SALES" },
    });

    const result = await generateStructured({
      system: [
        "You are given real, verified facts about a company's website (a real automated technical audit,",
        "not AI-inferred). Write 1-4 short, honest business INTERPRETATIONS — plain-language implications a",
        "non-technical business owner would care about — grounded strictly in the facts given. Never claim a",
        "specific financial loss/revenue number unless the input facts themselves state one. If a fact doesn't",
        "clearly imply anything actionable, omit it rather than inventing an interpretation.",
      ].join(" "),
      userContent: JSON.stringify({ facts: newFacts }),
      maxTokens: 1024,
      effort: "low",
      schema: InterpretationsResponseSchema,
    });

    await recordAIUsage(
      scan.organizationId,
      result.provider,
      result.model,
      result.inputTokens,
      result.outputTokens,
      "business-development:website-intelligence",
    );

    const interpretations = result.parsed.interpretations;
    if (interpretations.length === 0) return { factsCreated, interpretationsCreated: 0 };

    await prisma.companyEvidence.createMany({
      data: interpretations.map((i) => ({
        companyId,
        kind: "AI_INTERPRETATION",
        fact: i.interpretation,
        source: "COMPANY_INTELLIGENCE",
        confidence: Math.min(1, Math.max(0, i.confidence)),
        generatedByAgentId: salesAgent?.id ?? null,
      })),
    });

    return { factsCreated, interpretationsCreated: interpretations.length };
  } catch (error) {
    // Never let an AI failure (AINotConnectedError, rate limit, all-providers-
    // failed, etc.) crash the raw-fact writing that already succeeded above.
    console.error(`[business-development/website-intelligence] AI interpretation failed for company ${companyId}:`, error);
    return { factsCreated, interpretationsCreated: 0 };
  }
}
