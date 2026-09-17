import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";
import { generateText, generateStructured } from "@/lib/ai/fallback";
import { recordAIUsage } from "@/lib/billing/ai-credits";
import { KVL_SERVICES } from "./kvl-service-catalog";
import { normalizeWebsiteHost } from "./dedup";
import type { PartnerType } from "@/generated/prisma/client";

/**
 * AI Partner Discovery (Phase 8 — Partner & Referral Client Acquisition
 * Engine). "Identify potential partners based on Industry/Market/Service
 * overlap/Client base. Do not automatically recruit/spam." (spec, verbatim).
 *
 * Deliberately its OWN two-pass web-search call, mirroring
 * decision-maker-discovery.ts's exact shape: (1) a real `generateText` call
 * with `webSearch` so an actual live web search happens, then (2) a
 * tool-free `generateStructured` pass that extracts a clean, schema-
 * validated list of real candidates out of that research text. Same
 * non-fabrication discipline: a candidate is only ever reported when the AI
 * found genuine evidence (a real company/agency website, a public
 * directory/profile listing, a press mention) — no evidence means that
 * candidate is simply absent from the result, never invented.
 *
 * HARD CONSTRAINT (spec, verbatim: "Do not automatically recruit/send
 * spam."): this function only ever WRITES a `ReferralPartner` row with
 * status CANDIDATE for a human operator to review and manually reach out to
 * later. It never sends an email, never generates an outreach draft, and
 * never imports anything from the outreach send pipeline
 * (src/lib/outreach/draft-generator.ts, src/lib/outreach/email-provider.ts,
 * src/lib/email.ts) — this module's only imports are AI generation, Prisma,
 * and this codebase's existing service catalog/dedup helpers. See this
 * file's colocated test for a static assertion of that.
 */

const PARTNER_TYPE_VALUES = [
  "FREELANCER",
  "DIGITAL_AGENCY",
  "SEO_AGENCY",
  "MARKETING_CONSULTANT",
  "IT_CONSULTANT",
  "BUSINESS_CONSULTANT",
  "DESIGNER",
  "TECHNOLOGY_CONSULTANT",
] as const satisfies readonly PartnerType[];

const DiscoveredPartnerSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(PARTNER_TYPE_VALUES),
  website: z.string().trim().min(1).nullable().default(null),
  email: z.string().trim().min(1).nullable().default(null),
  // Why this candidate is a plausible referral source — e.g. "a web design
  // freelancer whose service list has no CRM/backend offering" — grounded in
  // real evidence, not a generic template sentence.
  reason: z.string().trim().min(1),
  source: z.string().trim().min(1),
  sourceUrl: z.string().trim().min(1).nullable().default(null),
  confidence: z.number().min(0).max(1),
});

const DiscoveredPartnersSchema = z.object({
  partners: z.array(DiscoveredPartnerSchema).max(8).default([]),
});

export interface DiscoverPotentialPartnersResult {
  found: number;
  created: number;
}

export async function discoverPotentialPartners(organizationId: string): Promise<DiscoverPotentialPartnersResult> {
  if (!isAIConnected()) return { found: 0, created: 0 };

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      industry: true,
      primaryMarket: true,
      countriesServed: true,
      clientTypes: true,
      services: true,
    },
  });
  if (!organization) return { found: 0, created: 0 };

  const serviceCatalogLines = KVL_SERVICES.map((s) => `- ${s.label}: ${s.description}`).join("\n");

  try {
    const searchResult = await generateText({
      system: [
        "You are a B2B partnerships researcher with live web search available. Your ONLY job is to find REAL,",
        "PUBLICLY DISCOVERABLE companies or independent professionals who could plausibly REFER new clients to the",
        "business described below — because their own service offering does NOT compete with it but genuinely",
        "COMPLEMENTS it (e.g. a web design freelancer with no backend/CRM capability is a good referral source for a",
        "company that builds CRM systems; a marketing consultant with no website-development arm is a good referral",
        "source for a web development agency).",
        "",
        "Only classify each real candidate into exactly one of these 8 types: Freelancer, Digital Agency, SEO",
        "Agency, Marketing Consultant, IT Consultant, Business Consultant, Designer, Technology Consultant.",
        "",
        "Only report a real, named company or individual if you have genuine evidence of who they are and what",
        "they do — their own website, a public professional/agency directory listing, a press mention. If you",
        "cannot find real, verifiable candidates, do not report anyone — never invent a plausible-sounding company",
        "or freelancer name. This is a strict requirement.",
        "",
        "This is prospect IDENTIFICATION only — you are not drafting any outreach message, and none will be sent",
        "automatically. A human will review your findings and decide whether/how to reach out manually.",
      ].join(" "),
      userContent: [
        `Search the web and find real potential referral partners for this business: "${organization.name}".`,
        organization.industry ? `Its own industry: ${organization.industry}.` : null,
        organization.primaryMarket ? `Primary market: ${organization.primaryMarket}.` : null,
        organization.countriesServed.length > 0 ? `Countries served: ${organization.countriesServed.join(", ")}.` : null,
        organization.clientTypes.length > 0 ? `Typical client base: ${organization.clientTypes.join(", ")}.` : null,
        "The services this business sells (so you can find partners whose OWN offering does not overlap with",
        "these, but whose client base plausibly needs them):",
        serviceCatalogLines,
        "",
        "For each real candidate you find, note their name, which of the 8 partner types they are, their website",
        "if you found one, a public contact email only if genuinely publicly listed (otherwise leave it out),",
        "exactly why they're a plausible complementary referral source, exactly where you found this, the specific",
        "URL if you have one, and how confident you genuinely are.",
      ]
        .filter(Boolean)
        .join(" "),
      maxTokens: 3072,
      webSearch: { maxUses: 5 },
    });

    const researchSummary = searchResult.text;

    const extraction = await generateStructured({
      system: [
        "Extract a clean, structured list of REAL named potential referral partners from the research notes you're",
        "given. Map each one to exactly one of: FREELANCER, DIGITAL_AGENCY, SEO_AGENCY, MARKETING_CONSULTANT,",
        "IT_CONSULTANT, BUSINESS_CONSULTANT, DESIGNER, TECHNOLOGY_CONSULTANT. Only include a candidate that was",
        "actually named in the notes with real supporting evidence — never invent one. If the notes found nothing",
        "usable, return an empty list. Cap the list at 8 candidates, keeping the ones with the strongest evidence.",
      ].join(" "),
      userContent: researchSummary || "No research notes were produced — no potential partners were found.",
      maxTokens: 2048,
      effort: "low",
      schema: DiscoveredPartnersSchema,
    });

    await recordAIUsage(
      organizationId,
      extraction.provider,
      extraction.model,
      searchResult.inputTokens + extraction.inputTokens,
      searchResult.outputTokens + extraction.outputTokens,
      "business-development:partner-discovery",
    );

    const discovered = extraction.parsed.partners;
    if (discovered.length === 0) return { found: 0, created: 0 };

    const existing = await prisma.referralPartner.findMany({
      where: { organizationId },
      select: { id: true, name: true, website: true },
    });
    const existingByLowerName = new Set(existing.map((p) => p.name.trim().toLowerCase()));
    const existingByHost = new Set(existing.map((p) => normalizeWebsiteHost(p.website)).filter((h): h is string => !!h));

    let created = 0;
    for (const candidate of discovered) {
      const nameKey = candidate.name.trim().toLowerCase();
      const host = normalizeWebsiteHost(candidate.website);

      if (existingByLowerName.has(nameKey) || (host && existingByHost.has(host))) {
        continue; // already known as a partner (candidate or recruited) — never a duplicate CANDIDATE row
      }

      await prisma.referralPartner.create({
        data: {
          organizationId,
          name: candidate.name,
          type: candidate.type,
          status: "CANDIDATE",
          email: candidate.email,
          website: candidate.website,
          notes: candidate.reason,
          discoverySource: candidate.source,
          discoveryUrl: candidate.sourceUrl,
        },
      });
      existingByLowerName.add(nameKey);
      if (host) existingByHost.add(host);
      created += 1;
    }

    return { found: discovered.length, created };
  } catch (error) {
    console.error(`[business-development/partner-discovery] discovery failed for organization ${organizationId}:`, error);
    return { found: 0, created: 0 };
  }
}
