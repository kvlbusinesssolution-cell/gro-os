"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requirePlatformOwner } from "@/lib/billing/platform-admin";
import { logAudit } from "@/lib/audit";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Flips BusinessListing.isVerified — the platform-admin-only trust mark documented on that field in prisma/schema.prisma. Never settable from any organization-scoped UI. */
export async function setListingVerified(listingId: string, verified: boolean): Promise<ActionResult> {
  const admin = await requirePlatformOwner("/admin/business-listings");

  const listing = await prisma.businessListing.findUnique({ where: { id: listingId } });
  if (!listing) return { ok: false, error: "Listing not found." };

  await prisma.businessListing.update({ where: { id: listingId }, data: { isVerified: verified } });
  await logAudit({ userId: admin.userId, action: verified ? "business_listing.verified" : "business_listing.unverified", metadata: { listingId } });

  revalidatePath("/admin/business-listings");
  return { ok: true };
}

export async function resolveReport(reportId: string, status: "REVIEWED" | "DISMISSED"): Promise<ActionResult> {
  const admin = await requirePlatformOwner("/admin/business-listings");

  const report = await prisma.businessListingReport.findUnique({ where: { id: reportId } });
  if (!report) return { ok: false, error: "Report not found." };

  await prisma.businessListingReport.update({ where: { id: reportId }, data: { status, reviewedByUserId: admin.userId, reviewedAt: new Date() } });
  await logAudit({ userId: admin.userId, action: "business_listing_report.resolved", metadata: { reportId, status } });

  revalidatePath("/admin/business-listings");
  return { ok: true };
}

/** Platform-admin suspend — independent of the owner's own unpublish/delete actions, for a listing that shouldn't be taken down by its own (possibly compromised) owner account. */
export async function suspendListing(listingId: string): Promise<ActionResult> {
  const admin = await requirePlatformOwner("/admin/business-listings");

  const listing = await prisma.businessListing.findUnique({ where: { id: listingId } });
  if (!listing) return { ok: false, error: "Listing not found." };

  await prisma.businessListing.update({ where: { id: listingId }, data: { status: "SUSPENDED" } });
  await logAudit({ userId: admin.userId, action: "business_listing.suspended", metadata: { listingId } });

  revalidatePath("/admin/business-listings");
  return { ok: true };
}
