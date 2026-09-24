"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { resolveActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { spendGrowthTokens, GROWTH_TOKEN_COST } from "@/lib/billing/growth-tokens";
import { businessReputationCertificateToPdfBuffer } from "@/lib/export/pdf";

export interface DownloadCertificateResult {
  ok: boolean;
  error?: string;
  pdfBase64?: string;
  filename?: string;
}

/**
 * JustDial-parity "Business Reputation / Rating Certificate" — generates a
 * fresh, dated PDF from the listing's own real rating/review data every
 * time (never cached), so each download is an honest snapshot as of that
 * moment. Growth-Token gated like every other real deliverable this
 * platform produces (LISTING_FEATURE, LANDING_PAGE_PUBLISH) — never a
 * database write, so no transaction composition is needed the way
 * publish/feature actions need one.
 */
export async function downloadReputationCertificate(listingId: string): Promise<DownloadCertificateResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const listing = await prisma.businessListing.findUnique({ where: { id: listingId } });
  if (!listing || listing.organizationId !== membership.organizationId) return { ok: false, error: "Listing not found." };
  if (listing.reviewCount === 0) return { ok: false, error: "This listing has no real reviews yet — a certificate needs at least one." };

  const spend = await spendGrowthTokens(membership.organizationId, "REPUTATION_CERTIFICATE_DOWNLOAD", {
    referenceType: "BusinessListing",
    referenceId: listingId,
    context: "business-growth:reputation-certificate",
  });
  if (!spend.ok) return { ok: false, error: spend.error ?? "Not enough Growth Tokens to generate this certificate." };

  const pdfBuffer = await businessReputationCertificateToPdfBuffer({
    businessName: listing.businessName,
    city: listing.city,
    category: listing.category,
    averageRating: listing.averageRating,
    reviewCount: listing.reviewCount,
    isVerified: listing.isVerified,
  });

  await logAudit({
    userId,
    organizationId: membership.organizationId,
    action: "business_listing.reputation_certificate_downloaded",
    metadata: { listingId, tokensCost: GROWTH_TOKEN_COST.REPUTATION_CERTIFICATE_DOWNLOAD },
  });

  return { ok: true, pdfBase64: pdfBuffer.toString("base64"), filename: `${listing.slug}-reputation-certificate.pdf` };
}
