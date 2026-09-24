"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { spendGrowthTokens, GROWTH_TOKEN_COST } from "@/lib/billing/growth-tokens";
import { AINotConnectedError, AIBillingError, isAIBillingError } from "@/lib/ai/client";
import { buildMicrositeContext, generateMicrositeContent } from "@/lib/listings/microsite-generator";
import { slugify } from "@/lib/slug";
import type { LandingPageBlock } from "@/lib/validations/marketing";

export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
  errorKind?: "not_connected" | "billing" | "generic";
}

async function requireEditorMembership(): Promise<{ ok: true; userId: string; organizationId: string } | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  return { ok: true, userId, organizationId: membership.organizationId };
}

async function resolveOwnedListing(organizationId: string, listingId: string) {
  const listing = await prisma.businessListing.findUnique({ where: { id: listingId } });
  if (!listing || listing.organizationId !== organizationId) return null;
  return listing;
}

function describeAIError<T>(error: unknown): ActionResult<T> {
  if (error instanceof AINotConnectedError) {
    return { ok: false, errorKind: "not_connected", error: "AI is not connected — no AI provider is configured for this environment." };
  }
  if (error instanceof AIBillingError || isAIBillingError(error)) {
    return { ok: false, errorKind: "billing", error: "AI is connected but the account has no AI credits remaining." };
  }
  console.error("[business-growth/microsite-actions] AI generation failed:", error);
  return { ok: false, errorKind: "generic", error: "Something went wrong generating your website. Please try again." };
}

async function generateUniqueMicrositeSlug(businessName: string): Promise<string> {
  const base = slugify(businessName);
  const existing = await prisma.businessMicrosite.findUnique({ where: { slug: base } });
  if (!existing) return base;
  for (let attempt = 0; attempt < 10; attempt++) {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let suffix = "";
    for (let i = 0; i < 5; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    const candidate = `${base}-${suffix}`;
    const collision = await prisma.businessMicrosite.findUnique({ where: { slug: candidate } });
    if (!collision) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Generates (or regenerates) the real, fact-grounded AI website draft —
 * free, AI-credit-metered (not Growth-Token gated), matching the
 * platform's existing split of "AI drafting = AI credits" vs
 * "publish/deliverable = Growth Tokens". Creates the DRAFT microsite +
 * its 4 pages on first call; a later call regenerates page content in
 * place without touching publish status.
 */
export async function generateMicrosite(listingId: string): Promise<ActionResult<{ micrositeId: string }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const listing = await resolveOwnedListing(access.organizationId, listingId);
  if (!listing) return { ok: false, error: "Listing not found." };

  const context = await buildMicrositeContext(listingId);
  if (!context) return { ok: false, error: "Listing not found." };

  try {
    const content = await generateMicrositeContent(access.organizationId, listing.businessName, context);

    const microsite = await prisma.businessMicrosite.upsert({
      where: { businessListingId: listingId },
      create: { businessListingId: listingId, slug: await generateUniqueMicrositeSlug(listing.businessName) },
      update: {},
    });

    await Promise.all(
      (Object.keys(content) as Array<keyof typeof content>).map((pageSlug) =>
        prisma.businessMicrositePage.upsert({
          where: { micrositeId_pageSlug: { micrositeId: microsite.id, pageSlug } },
          create: { micrositeId: microsite.id, pageSlug, title: content[pageSlug].title, bodyBlocks: content[pageSlug].blocks },
          update: { title: content[pageSlug].title, bodyBlocks: content[pageSlug].blocks },
        }),
      ),
    );

    await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "business_microsite.generated", metadata: { listingId, micrositeId: microsite.id } });

    revalidatePath(`/dashboard/business-growth/${listingId}/website`);
    return { ok: true, data: { micrositeId: microsite.id } };
  } catch (error) {
    return describeAIError(error);
  }
}

export async function updateMicrositePage(micrositeId: string, pageSlug: string, title: string, blocks: LandingPageBlock[]): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const microsite = await prisma.businessMicrosite.findUnique({ where: { id: micrositeId }, include: { businessListing: true } });
  if (!microsite || microsite.businessListing.organizationId !== access.organizationId) return { ok: false, error: "Website not found." };

  await prisma.businessMicrositePage.update({ where: { micrositeId_pageSlug: { micrositeId, pageSlug } }, data: { title, bodyBlocks: blocks } });

  revalidatePath(`/dashboard/business-growth/${microsite.businessListingId}/website`);
  if (microsite.status === "PUBLISHED") revalidatePath(`/site/${microsite.slug}`);
  return { ok: true };
}

/**
 * The ONLY place a microsite's Growth Token cost is charged — same atomic
 * spend-then-publish transaction shape as publishListing/publishLandingPage.
 */
export async function publishMicrosite(micrositeId: string): Promise<ActionResult<{ remainingTokens?: number }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const microsite = await prisma.businessMicrosite.findUnique({ where: { id: micrositeId }, include: { businessListing: true, pages: true } });
  if (!microsite || microsite.businessListing.organizationId !== access.organizationId) return { ok: false, error: "Website not found." };
  if (microsite.status === "PUBLISHED") return { ok: true, data: {} };
  if (microsite.pages.length === 0) return { ok: false, error: "Generate the website's content before publishing." };

  try {
    const remainingTokens = await prisma.$transaction(async (tx) => {
      const spend = await spendGrowthTokens(access.organizationId, "MICROSITE_PUBLISH", {
        referenceType: "BusinessMicrosite",
        referenceId: micrositeId,
        context: "business-growth:publish-microsite",
        tx,
      });
      if (!spend.ok) throw new Error(spend.error ?? "Not enough Growth Tokens to publish this website.");

      await tx.businessMicrosite.update({ where: { id: micrositeId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      return spend.remainingTokens;
    });

    await logAudit({
      userId: access.userId,
      organizationId: access.organizationId,
      action: "business_microsite.published",
      metadata: { micrositeId, tokensCost: GROWTH_TOKEN_COST.MICROSITE_PUBLISH },
    });

    revalidatePath(`/dashboard/business-growth/${microsite.businessListingId}/website`);
    revalidatePath(`/site/${microsite.slug}`);
    return { ok: true, data: { remainingTokens } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not publish this website." };
  }
}
