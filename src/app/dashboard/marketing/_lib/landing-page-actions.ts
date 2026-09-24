"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { spendGrowthTokens, GROWTH_TOKEN_COST } from "@/lib/billing/growth-tokens";
import { generateUniqueLandingPageSlug } from "@/lib/marketing/slug";
import { saveMarketingAssetFile, deleteMarketingAssetFile } from "@/lib/storage/marketing-assets";
import { marketingLandingPageInputSchema, type MarketingLandingPageInput } from "@/lib/validations/marketing";
import type { MembershipRole } from "@/generated/prisma/client";

export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}

const EDITOR_ROLES = new Set<MembershipRole>(["OWNER", "ADMIN", "MANAGER", "MARKETING"]);

async function requireEditorMembership(): Promise<{ ok: true; userId: string; organizationId: string } | { ok: false; error: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };
  if (!EDITOR_ROLES.has(membership.role)) return { ok: false, error: "Only an Owner, Admin, Manager, or Marketing member can manage landing pages." };

  return { ok: true, userId, organizationId: membership.organizationId };
}

async function resolveOwnedLandingPage(organizationId: string, landingPageId: string) {
  const page = await prisma.marketingLandingPage.findUnique({ where: { id: landingPageId } });
  if (!page || page.organizationId !== organizationId) return null;
  return page;
}

/** Draft creation is free — only publishing (see publishLandingPage below) spends Growth Tokens. */
export async function createLandingPage(input: MarketingLandingPageInput): Promise<ActionResult<{ id: string }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const parsed = marketingLandingPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the page details." };
  const data = parsed.data;

  const slug = await generateUniqueLandingPageSlug(prisma, data.title);

  const page = await prisma.marketingLandingPage.create({
    data: {
      organizationId: access.organizationId,
      slug,
      title: data.title,
      headline: data.headline,
      subheadline: data.subheadline || null,
      heroImageUrl: data.heroImageUrl || null,
      bodyBlocks: data.bodyBlocks,
      formFields: data.formFields,
      metaTitle: data.metaTitle || null,
      metaDescription: data.metaDescription || null,
      createdByUserId: access.userId,
    },
  });

  revalidatePath("/dashboard/marketing/landing-pages");
  return { ok: true, data: { id: page.id } };
}

/** Editing a DRAFT or an already-PUBLISHED page is free — never re-charges Growth Tokens; only the DRAFT/UNPUBLISHED -> PUBLISHED transition does (publishLandingPage). */
export async function updateLandingPage(landingPageId: string, input: MarketingLandingPageInput): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const page = await resolveOwnedLandingPage(access.organizationId, landingPageId);
  if (!page) return { ok: false, error: "Landing page not found." };

  const parsed = marketingLandingPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the page details." };
  const data = parsed.data;

  await prisma.marketingLandingPage.update({
    where: { id: landingPageId },
    data: {
      title: data.title,
      headline: data.headline,
      subheadline: data.subheadline || null,
      heroImageUrl: data.heroImageUrl || null,
      bodyBlocks: data.bodyBlocks,
      formFields: data.formFields,
      metaTitle: data.metaTitle || null,
      metaDescription: data.metaDescription || null,
    },
  });

  revalidatePath("/dashboard/marketing/landing-pages");
  revalidatePath(`/dashboard/marketing/landing-pages/${landingPageId}`);
  if (page.status === "PUBLISHED") revalidatePath(`/lp/${page.slug}`);
  return { ok: true };
}

/**
 * The ONLY place a landing page's Growth Token cost is charged — composes
 * the spend + the status flip in one transaction (via spendGrowthTokens's
 * `tx` option), same pattern as publishListing in business-growth/_lib/
 * listing-actions.ts, so a failed/insufficient spend can never leave a page
 * PUBLISHED, and two concurrent "Publish" clicks can never both succeed off
 * a balance that only covers one.
 */
export async function publishLandingPage(landingPageId: string): Promise<ActionResult<{ remainingTokens?: number }>> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const page = await resolveOwnedLandingPage(access.organizationId, landingPageId);
  if (!page) return { ok: false, error: "Landing page not found." };
  if (page.status === "PUBLISHED") return { ok: true, data: {} };

  try {
    const remainingTokens = await prisma.$transaction(async (tx) => {
      const spend = await spendGrowthTokens(access.organizationId, "LANDING_PAGE_PUBLISH", {
        referenceType: "MarketingLandingPage",
        referenceId: landingPageId,
        context: "marketing:publish-landing-page",
        tx,
      });
      if (!spend.ok) throw new Error(spend.error ?? "Not enough Growth Tokens to publish this landing page.");

      await tx.marketingLandingPage.update({ where: { id: landingPageId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      return spend.remainingTokens;
    });

    await logAudit({
      userId: access.userId,
      organizationId: access.organizationId,
      action: "marketing_landing_page.published",
      metadata: { landingPageId, tokensCost: GROWTH_TOKEN_COST.LANDING_PAGE_PUBLISH },
    });

    revalidatePath("/dashboard/marketing/landing-pages");
    revalidatePath(`/dashboard/marketing/landing-pages/${landingPageId}`);
    revalidatePath(`/lp/${page.slug}`);
    return { ok: true, data: { remainingTokens } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not publish this landing page." };
  }
}

export async function unpublishLandingPage(landingPageId: string): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const page = await resolveOwnedLandingPage(access.organizationId, landingPageId);
  if (!page) return { ok: false, error: "Landing page not found." };

  await prisma.marketingLandingPage.update({ where: { id: landingPageId }, data: { status: "UNPUBLISHED" } });
  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "marketing_landing_page.unpublished", metadata: { landingPageId } });

  revalidatePath("/dashboard/marketing/landing-pages");
  revalidatePath(`/dashboard/marketing/landing-pages/${landingPageId}`);
  revalidatePath(`/lp/${page.slug}`);
  return { ok: true };
}

export async function deleteLandingPage(landingPageId: string): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const page = await resolveOwnedLandingPage(access.organizationId, landingPageId);
  if (!page) return { ok: false, error: "Landing page not found." };

  if (page.leadMagnetAssetKey) await deleteMarketingAssetFile(page.leadMagnetAssetKey).catch(() => {});
  await prisma.marketingLandingPage.delete({ where: { id: landingPageId } });

  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "marketing_landing_page.deleted", metadata: { landingPageId } });

  revalidatePath("/dashboard/marketing/landing-pages");
  return { ok: true };
}

/** Attaches (or replaces) the gated download asset for this page's lead-magnet form. Free — only publishing the page itself is Growth-Token gated. */
export async function setLandingPageLeadMagnet(landingPageId: string, file: File): Promise<ActionResult> {
  const access = await requireEditorMembership();
  if (!access.ok) return { ok: false, error: access.error };

  const page = await resolveOwnedLandingPage(access.organizationId, landingPageId);
  if (!page) return { ok: false, error: "Landing page not found." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const storageKey = await saveMarketingAssetFile(access.organizationId, landingPageId, file.name, buffer);

  if (page.leadMagnetAssetKey) await deleteMarketingAssetFile(page.leadMagnetAssetKey).catch(() => {});
  await prisma.marketingLandingPage.update({
    where: { id: landingPageId },
    data: { leadMagnetAssetKey: storageKey, leadMagnetAssetFilename: file.name, leadMagnetAssetContentType: file.type || "application/octet-stream" },
  });

  revalidatePath(`/dashboard/marketing/landing-pages/${landingPageId}`);
  return { ok: true };
}
