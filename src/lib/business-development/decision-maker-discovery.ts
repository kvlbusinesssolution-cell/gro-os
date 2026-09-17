import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";
import { generateText, generateStructured } from "@/lib/ai/fallback";
import { recordAIUsage } from "@/lib/billing/ai-credits";
import type { DecisionMakerRole } from "@/generated/prisma/client";

/**
 * Decision Maker Intelligence (Phase 3) — finds the most relevant PUBLICLY
 * AVAILABLE decision-maker contact(s) at a real Company. Deliberately its
 * OWN two-pass web-search call rather than reusing `runWebSearchDiscovery()`
 * (agent-runtime.ts) — that function's `DiscoveredCompany` schema returns
 * companies, not people, and its status-tracking plumbing (setAgentStatus,
 * `AGENT_MODEL`-bound persona) is tied to the AI Executive Board's
 * agentId/agentType turn model, which this simpler `discoverDecisionMakers
 * (companyId)` entry point doesn't have. The two-pass SHAPE is mirrored
 * exactly though: (1) a real `generateText` call with `webSearch` so an
 * actual live web search happens (only Anthropic in the provider chain has
 * real web search — every other provider in the fallback chain honestly
 * answers from training data / declines, exactly like every other
 * webSearch-shaped call in this codebase), then (2) a tool-free
 * `generateStructured` pass that extracts a clean, schema-validated list of
 * real people out of that research text.
 *
 * STRICT non-fabrication rule (spec): a decision-maker is only ever reported
 * when the AI found genuine evidence — a company team/about page, a public
 * professional profile, a press mention — tying a real name to a role at
 * THIS company. No evidence for a role means that role is simply absent from
 * the result; nothing is ever invented to fill it in.
 */

const ROLE_VALUES = [
  "FOUNDER",
  "CO_FOUNDER",
  "CEO",
  "DIRECTOR",
  "CTO",
  "COO",
  "MARKETING_HEAD",
  "SALES_HEAD",
  "BUSINESS_DEVELOPMENT_HEAD",
  "IT_HEAD",
  "PRODUCT_HEAD",
] as const satisfies readonly DecisionMakerRole[];

const DiscoveredDecisionMakerSchema = z.object({
  name: z.string().trim().min(1),
  role: z.enum(ROLE_VALUES),
  source: z.string().trim().min(1),
  sourceUrl: z.string().trim().min(1).nullable().default(null),
  confidence: z.number().min(0).max(1),
});

const DiscoveredDecisionMakersSchema = z.object({
  decisionMakers: z.array(DiscoveredDecisionMakerSchema).max(5).default([]),
});

export interface DiscoverDecisionMakersResult {
  found: number;
  created: number;
}

export async function discoverDecisionMakers(companyId: string): Promise<DiscoverDecisionMakersResult> {
  if (!isAIConnected()) return { found: 0, created: 0 };

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, organizationId: true, name: true, website: true, industry: true },
  });
  if (!company) return { found: 0, created: 0 };

  try {
    const searchResult = await generateText({
      system: [
        "You are a B2B sales researcher with live web search available. Your ONLY job is to find REAL, PUBLICLY",
        "DISCOVERABLE named individuals who hold a decision-maker role at ONE specific real company. Target roles:",
        "Founder, Co-Founder, CEO, Director, CTO, COO, Marketing Head, Sales Head, Business Development Head, IT",
        "Head, Product Head.",
        "",
        "Only report a real named person if you have genuine evidence they hold this role at this company from what",
        "you found — company website team/about pages, public professional profiles, press mentions. If you cannot",
        "find a real, verifiable person for a role, do not report anyone for that role — never invent a",
        "plausible-sounding name. This is a strict requirement.",
        "",
        "Only use publicly available professional information. Never report private/personal contact details.",
      ].join(" "),
      userContent: [
        `Search the web and find real, currently-serving decision-makers at this company: "${company.name}"${
          company.website ? ` (${company.website})` : ""
        }.`,
        company.industry ? `Industry: ${company.industry}.` : null,
        "For each real person you find, note their full name, their role/title, exactly where you found this",
        "(e.g. \"Company website /about page\", \"Public LinkedIn profile snippet\", \"Press release mention\"), the",
        "specific URL if you have one, and how confident you genuinely are that this name+role pairing is correct.",
      ]
        .filter(Boolean)
        .join(" "),
      maxTokens: 3072,
      webSearch: { maxUses: 5 },
    });

    const researchSummary = searchResult.text;

    const extraction = await generateStructured({
      system: [
        "Extract a clean, structured list of REAL named decision-makers from the research notes you're given.",
        "Map each person's title to the closest of these exact roles: FOUNDER, CO_FOUNDER, CEO, DIRECTOR, CTO, COO,",
        "MARKETING_HEAD, SALES_HEAD, BUSINESS_DEVELOPMENT_HEAD, IT_HEAD, PRODUCT_HEAD. Only include a person who was",
        "actually named in the notes with real supporting evidence — never invent one. If the notes found nothing",
        "usable, return an empty list. Cap the list at 5 people, keeping the ones with the strongest evidence.",
      ].join(" "),
      userContent: researchSummary || "No research notes were produced — no decision-makers were found.",
      maxTokens: 1536,
      effort: "low",
      schema: DiscoveredDecisionMakersSchema,
    });

    await recordAIUsage(
      company.organizationId,
      extraction.provider,
      extraction.model,
      searchResult.inputTokens + extraction.inputTokens,
      searchResult.outputTokens + extraction.outputTokens,
      "business-development:decision-maker-discovery",
    );

    const discovered = extraction.parsed.decisionMakers;
    if (discovered.length === 0) return { found: 0, created: 0 };

    const salesAgent = await prisma.aIAgentInstance.findFirst({
      where: { organizationId: company.organizationId, type: "SALES" },
      select: { id: true },
    });

    const existing = await prisma.decisionMaker.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });
    const existingByLowerName = new Map(existing.map((row) => [row.name.trim().toLowerCase(), row.id]));

    let created = 0;
    for (const person of discovered) {
      const key = person.name.trim().toLowerCase();
      const existingId = existingByLowerName.get(key);

      if (existingId) {
        // Re-verification of an already-known person: refresh role/source/
        // confidence/verifiedAt rather than creating a duplicate row.
        await prisma.decisionMaker.update({
          where: { id: existingId },
          data: {
            role: person.role,
            source: person.source,
            sourceUrl: person.sourceUrl,
            confidence: person.confidence,
            verifiedAt: new Date(),
            generatedByAgentId: salesAgent?.id ?? null,
          },
        });
      } else {
        await prisma.decisionMaker.create({
          data: {
            companyId,
            name: person.name,
            role: person.role,
            source: person.source,
            sourceUrl: person.sourceUrl,
            confidence: person.confidence,
            generatedByAgentId: salesAgent?.id ?? null,
          },
        });
        created += 1;
      }
    }

    return { found: discovered.length, created };
  } catch (error) {
    console.error(`[business-development/decision-maker-discovery] discovery failed for company ${companyId}:`, error);
    return { found: 0, created: 0 };
  }
}
