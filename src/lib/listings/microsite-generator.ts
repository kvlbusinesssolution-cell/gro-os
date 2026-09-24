import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { isAIConnected, AINotConnectedError } from "@/lib/ai/client";
import { generateStructured } from "@/lib/ai/fallback";
import { recordAIUsage } from "@/lib/billing/ai-credits";
import { landingPageBlockSchema } from "@/lib/validations/marketing";

/**
 * JustDial-parity "AI Business Website Builder" — grounding + generation
 * for a real multi-page micro-site built FROM a listing's own already
 * real, stored data (same "real facts in, AI only phrases/organizes them"
 * discipline as buildProposalContext, src/lib/business-development/
 * proposal-context.ts). The AI may never invent a service, price, review,
 * or fact not present in the context string below.
 */

const MicrositePageContentSchema = z.object({
  title: z.string(),
  blocks: z.array(landingPageBlockSchema).max(10),
});

const MicrositeContentSchema = z.object({
  home: MicrositePageContentSchema,
  about: MicrositePageContentSchema,
  services: MicrositePageContentSchema,
  contact: MicrositePageContentSchema,
});
export type MicrositeContent = z.infer<typeof MicrositeContentSchema>;

/** Real-facts-only context string — every line traces to an already-stored field, never invented. Returns null only when the listing itself doesn't exist. */
export async function buildMicrositeContext(listingId: string): Promise<string | null> {
  const listing = await prisma.businessListing.findUnique({
    where: { id: listingId },
    include: {
      catalogItems: { where: { status: "PUBLISHED" }, take: 20 },
      reviews: { where: { status: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!listing) return null;

  const facts = [
    `Business name: ${listing.businessName}`,
    `Category: ${listing.category}`,
    `Location: ${listing.city}${listing.state ? `, ${listing.state}` : ""}, ${listing.country}`,
    listing.tagline ? `Tagline: ${listing.tagline}` : null,
    listing.description ? `Description: ${listing.description}` : null,
    listing.phone ? `Phone: ${listing.phone}` : null,
    listing.whatsappNumber ? `WhatsApp: ${listing.whatsappNumber}` : null,
    listing.priceRange ? `Price range: ${listing.priceRange}` : null,
    listing.reviewCount > 0
      ? `Real average rating: ${listing.averageRating.toFixed(1)}/5 from ${listing.reviewCount} real customer reviews.`
      : "No customer reviews on file yet.",
  ].filter((f): f is string => Boolean(f));

  const catalogFacts = listing.catalogItems.map(
    (c) => `- ${c.name}${c.price ? ` (₹${c.price}${c.priceUnit ? ` ${c.priceUnit}` : ""})` : ""}${c.description ? `: ${c.description}` : ""}`,
  );

  const reviewFacts = listing.reviews.filter((r) => r.body).map((r) => `- ${r.rating}/5 — "${r.body}"`);

  return [
    facts.join("\n"),
    catalogFacts.length ? `Real products/services on file:\n${catalogFacts.join("\n")}` : null,
    reviewFacts.length ? `Real customer reviews on file:\n${reviewFacts.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Drafts real, structured content for the 4 standard microsite pages — grounded strictly in `context`. Never called if AI isn't connected (throws AINotConnectedError, same contract as generateProposalSections). */
export async function generateMicrositeContent(organizationId: string, businessName: string, context: string): Promise<MicrositeContent> {
  if (!isAIConnected()) throw new AINotConnectedError();

  const result = await generateStructured({
    system: `You are a website copywriter drafting a real small-business website. You will be given real, verified facts about a specific business — you may only phrase and organize what's given; never invent a service, price, testimonial, or fact that isn't in the provided context. If the context doesn't mention something (e.g. no reviews on file), write around that honestly rather than inventing filler. Write four pages: "home" (a warm, concise introduction and call to action), "about" (the business's real story/description as given), "services" (the real products/services listed, or a general note if none are listed yet), and "contact" (a clear call to action using only the real contact details given). Each page is a title plus 2-6 structured content blocks (paragraph, bullets, or testimonial — testimonial blocks may ONLY use a real review quote from the context, never invented).`,
    userContent: `Business: ${businessName}\n\nReal context:\n${context}`,
    maxTokens: 4096,
    effort: "medium",
    schema: MicrositeContentSchema,
  });

  await recordAIUsage(organizationId, result.provider, result.model, result.inputTokens, result.outputTokens, "listings:microsite-generation");

  return result.parsed;
}
