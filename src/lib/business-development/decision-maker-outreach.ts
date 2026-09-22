import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";
import { generateText, generateStructured } from "@/lib/ai/fallback";
import { recordAIUsage } from "@/lib/billing/ai-credits";
import { findOrCreateContact } from "./dedup";
import type { DecisionMakerRole } from "@/generated/prisma/client";

/**
 * Phase 5: bridges the Phase 3 `DecisionMaker` (a real named person + role,
 * deliberately with NO email — public-name/role-only, never-guess-identity
 * discipline) to a real `Contact` row (outreach can only ever target a
 * `Contact`, and `Contact.email` is a REQUIRED field). `Contact` has no
 * direct FK to `DecisionMaker`; the actual current traceability mechanism is
 * case-insensitive full-name matching within the same company — the same
 * mechanism `buildContactContext` (personalization.ts) uses to surface a
 * matched decision-maker's role/source in the AI draft context.
 *
 * Hard rule, no exceptions: an email is NEVER fabricated/guessed (never a
 * firstname@company.com-style format). Only a real, evidence-based,
 * explicitly-published email (found via a real web search, same two-pass
 * generateText+webSearch -> generateStructured pattern as
 * decision-maker-discovery.ts) or the company's own already-on-file general
 * email are ever used. If neither exists, this returns an honest error
 * rather than creating a Contact at all.
 */

/** Human-readable label for each `DecisionMakerRole` (e.g. "MARKETING_HEAD" -> "Marketing Head", "CTO" -> "CTO") — mirrors personalization.ts's own local `DECISION_MAKER_ROLE_LABEL`; a small exhaustive `Record` duplicated per call site rather than a shared export, same convention `decision-maker-matching.ts`'s private `roleLabel` already established for this 11-entry enum. */
const DECISION_MAKER_ROLE_LABEL: Record<DecisionMakerRole, string> = {
  FOUNDER: "Founder",
  CO_FOUNDER: "Co-Founder",
  CEO: "CEO",
  DIRECTOR: "Director",
  CTO: "CTO",
  COO: "COO",
  MARKETING_HEAD: "Marketing Head",
  SALES_HEAD: "Sales Head",
  BUSINESS_DEVELOPMENT_HEAD: "Business Development Head",
  IT_HEAD: "IT Head",
  PRODUCT_HEAD: "Product Head",
};

/** Splits a real full name into (firstName, lastName) the same simple way a manually-entered Contact would be: first token is the first name, everything else (if any) is the last name. */
function splitName(fullName: string): { firstName: string; lastName: string | null } {
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] ?? fullName.trim();
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  return { firstName, lastName };
}

const EmailFindingSchema = z.object({
  // Only ever a real, explicitly-published address the research actually
  // found — null when nothing genuine turned up. Deliberately NOT a fallback
  // to a guessed format; the system prompt below forbids it, and this schema
  // gives the model an honest way to report "not found" instead.
  email: z.string().trim().email().nullable().default(null),
  sourceDescription: z.string().trim().min(1).nullable().default(null),
  sourceUrl: z.string().trim().min(1).nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
});

export type ResolveOutreachContactResult =
  | { contactId: string; created: boolean; emailSource: "found" | "company_fallback" | "existing" }
  | { error: string };

export async function resolveOutreachContact(decisionMakerId: string): Promise<ResolveOutreachContactResult> {
  const decisionMaker = await prisma.decisionMaker.findUnique({
    where: { id: decisionMakerId },
    include: { company: true },
  });
  if (!decisionMaker) return { error: "Decision-maker not found." };

  const company = decisionMaker.company;
  const nameKey = decisionMaker.name.trim().toLowerCase();

  // 1. Reuse an existing Contact at this company whose name matches.
  const existingContacts = await prisma.contact.findMany({ where: { companyId: company.id } });
  const existing = existingContacts.find(
    (c) => `${c.firstName} ${c.lastName ?? ""}`.trim().toLowerCase() === nameKey,
  );
  if (existing) return { contactId: existing.id, created: false, emailSource: "existing" };

  const { firstName, lastName } = splitName(decisionMaker.name);
  const jobTitle = DECISION_MAKER_ROLE_LABEL[decisionMaker.role] ?? decisionMaker.role;

  // 2. Real, evidence-based web search for a genuinely published email.
  if (isAIConnected()) {
    try {
      const searchResult = await generateText({
        system: [
          "You are a B2B sales researcher with live web search available. Your ONLY job is to find whether a",
          "REAL, PUBLICLY LISTED professional email address exists for one specific named person at one specific",
          "company. Only report an email if you find it explicitly published — e.g. on the company's own",
          "team/contact page, in a press release, or on a public professional profile that lists it. NEVER guess",
          "or construct a plausible-looking address (e.g. firstname@company.com) — if you cannot find a real",
          "published email, say so plainly. This is a strict requirement.",
        ].join(" "),
        userContent: [
          `Is there a real, publicly listed professional email address for ${decisionMaker.name}, ${jobTitle} at ${company.name}${
            company.website ? ` (${company.website})` : ""
          }?`,
          "Only report one if you find it explicitly published somewhere public. If you cannot find a real",
          "published email, say so explicitly rather than guessing.",
        ].join(" "),
        maxTokens: 2048,
        webSearch: { maxUses: 4 },
      });

      const extraction = await generateStructured({
        system: [
          "Extract whether the research notes below found a REAL, explicitly-published email address for the",
          "person in question. Only return an email if the notes actually state they found one published",
          "somewhere public — never invent or construct one, even a plausible-looking one. If the notes say no",
          "real email was found (or say nothing conclusive), return null for email.",
        ].join(" "),
        userContent: searchResult.text || "No research notes were produced — no email was found.",
        maxTokens: 512,
        effort: "low",
        schema: EmailFindingSchema,
      });

      await recordAIUsage(
        company.organizationId,
        extraction.provider,
        extraction.model,
        searchResult.inputTokens + extraction.inputTokens,
        searchResult.outputTokens + extraction.outputTokens,
        "business-development:decision-maker-outreach",
      );

      if (extraction.parsed.email) {
        // Phase 25 (dedup-bypass fix): routed through the real single
        // choke point instead of a direct prisma.contact.create().
        const { contact } = await findOrCreateContact({
          organizationId: company.organizationId,
          companyId: company.id,
          firstName,
          lastName,
          email: extraction.parsed.email,
          jobTitle,
        });

        // Log the found email as auditable CompanyEvidence — "why do we
        // have this email" traces back to a real, timestamped source.
        await prisma.companyEvidence.create({
          data: {
            companyId: company.id,
            kind: "RAW_FACT",
            fact: `Publicly listed email found for ${decisionMaker.name} (${jobTitle}): ${extraction.parsed.email}${
              extraction.parsed.sourceDescription ? ` — ${extraction.parsed.sourceDescription}` : ""
            }`,
            source: "WEB_SEARCH",
            sourceUrl: extraction.parsed.sourceUrl,
            confidence: extraction.parsed.confidence,
          },
        });

        return { contactId: contact.id, created: true, emailSource: "found" };
      }
    } catch (error) {
      console.error(`[business-development/decision-maker-outreach] email search failed for decision-maker ${decisionMakerId}:`, error);
      // Fall through to the company-email fallback below — a failed search
      // is not itself grounds to give up on outreach entirely.
    }
  }

  // 3. Fall back to the company's own general email, honestly labeled.
  // Phase 25 (dedup-bypass fix): routed through the real single choke
  // point — multiple decision-makers at the same company with no real
  // personal email now correctly share one Contact row for the shared
  // inbox, instead of each creating a real duplicate.
  if (company.email) {
    const { contact } = await findOrCreateContact({
      organizationId: company.organizationId,
      companyId: company.id,
      firstName,
      lastName,
      email: company.email,
      jobTitle,
      notes: `General company contact — personal email not publicly available for ${decisionMaker.name}.`,
    });
    return { contactId: contact.id, created: true, emailSource: "company_fallback" };
  }

  // 4. No real email findable anywhere — never fabricate one.
  return { error: "No real, publicly available contact email could be found for this person or their company." };
}
