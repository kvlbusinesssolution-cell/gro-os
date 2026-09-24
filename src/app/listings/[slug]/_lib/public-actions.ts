"use server";

import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { notifyOrganizationOwners } from "@/lib/notifications";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/security/client-ip";
import { incrementDailyStat } from "@/lib/listings/daily-stats";
import { captureLeadSchema, submitReviewSchema, reportListingSchema, type CaptureLeadInput, type SubmitReviewInput, type ReportListingInput } from "@/lib/validations/listings";

/**
 * Public, unauthenticated actions for a listing page — no Growth Token
 * interaction of any kind (lead capture and review submission stay free in
 * v1, a deliberate product decision). Same IP-capture + logAudit(userId:
 * null, ...) pattern as signature-actions.ts's submitManualSignature, since
 * the actor here is an anonymous visitor, not a logged-in app user.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return clientIpFromHeaders(h);
}

/** Per-IP-per-listing, not just global — a bad actor targeting one listing must not hide under a global-IP threshold tuned for normal traffic. */
function rateLimitKey(prefix: string, ip: string, listingId: string): string {
  return `${prefix}:${ip}:${listingId}`;
}

export async function captureLead(listingId: string, input: CaptureLeadInput): Promise<ActionResult> {
  const parsed = captureLeadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  if (parsed.data.companyWebsite) return { ok: true }; // honeypot tripped — silently succeed, never tip off a bot

  const listing = await prisma.businessListing.findUnique({ where: { id: listingId } });
  if (!listing || listing.status !== "PUBLISHED") return { ok: false, error: "Listing not found." };

  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("listing-lead", ip, listingId), { limit: 10, windowMs: 60 * 60_000 }).allowed) {
    return { ok: false, error: "Too many requests — please try again later." };
  }

  const dealId = parsed.data.dealId || undefined;
  if (dealId) {
    const deal = await prisma.businessDeal.findUnique({ where: { id: dealId } });
    if (!deal || deal.businessListingId !== listingId) return { ok: false, error: "Deal not found." };
  }

  const headerBag = await headers();
  await prisma.$transaction(async (tx) => {
    await tx.businessListingLead.create({
      data: {
        businessListingId: listingId,
        businessDealId: dealId,
        type: parsed.data.type,
        name: parsed.data.name || null,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        message: parsed.data.message || null,
        ipAddress: ip,
        userAgent: headerBag.get("user-agent"),
      },
    });
    await tx.businessListing.update({ where: { id: listingId }, data: { leadCount: { increment: 1 } } });
    if (dealId) await tx.businessDeal.update({ where: { id: dealId }, data: { claimCount: { increment: 1 } } });
    await incrementDailyStat(listingId, "leadCount", tx);
  });

  await logAudit({
    userId: null,
    organizationId: listing.organizationId,
    action: "business_listing.lead_captured",
    ipAddress: ip,
    metadata: { listingId, type: parsed.data.type, dealId: dealId ?? null },
  });

  await notifyOrganizationOwners({
    organizationId: listing.organizationId,
    type: "APPROVAL_REQUESTED",
    title: "New lead on your listing",
    message: `A visitor submitted a ${leadTypeLabel(parsed.data.type)} on "${listing.businessName}" — check the lead inbox.`,
  });

  return { ok: true };
}

function leadTypeLabel(type: CaptureLeadInput["type"]): string {
  switch (type) {
    case "CALL_CLICK":
      return "call-click";
    case "WHATSAPP_CLICK":
      return "WhatsApp-click";
    case "ENQUIRY_FORM":
    default:
      return "enquiry";
  }
}

export async function submitReview(listingId: string, input: SubmitReviewInput): Promise<ActionResult> {
  const parsed = submitReviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the review and try again." };
  if (parsed.data.companyWebsite) return { ok: true }; // honeypot tripped — silently succeed

  const listing = await prisma.businessListing.findUnique({ where: { id: listingId } });
  if (!listing || listing.status !== "PUBLISHED") return { ok: false, error: "Listing not found." };

  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("listing-review", ip, listingId), { limit: 5, windowMs: 60 * 60_000 }).allowed) {
    return { ok: false, error: "Too many requests — please try again later." };
  }

  // PENDING by design — never auto-approved. A business owner must moderate
  // every real review before it ever appears publicly (review-moderation-
  // actions.ts), so this write alone never changes the listing's rating.
  await prisma.businessReview.create({
    data: {
      businessListingId: listingId,
      reviewerName: parsed.data.reviewerName,
      reviewerEmail: parsed.data.reviewerEmail || null,
      rating: parsed.data.rating,
      title: parsed.data.title || null,
      body: parsed.data.body || null,
      ipAddress: ip,
    },
  });

  await logAudit({
    userId: null,
    organizationId: listing.organizationId,
    action: "business_review.submitted",
    ipAddress: ip,
    metadata: { listingId, rating: parsed.data.rating },
  });

  await notifyOrganizationOwners({
    organizationId: listing.organizationId,
    type: "APPROVAL_REQUESTED",
    title: "New review awaiting moderation",
    message: `${parsed.data.reviewerName} left a ${parsed.data.rating}-star review on "${listing.businessName}" — review it before it goes live.`,
  });

  return { ok: true };
}

/**
 * Public abuse/accuracy report against a listing — reviewed by the platform
 * admin (src/app/admin/business-listings), never by the listing's own owner.
 * Same honeypot + per-IP-per-listing rate limit shape as captureLead/
 * submitReview above.
 */
export async function reportListing(listingId: string, input: ReportListingInput): Promise<ActionResult> {
  const parsed = reportListingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  if (parsed.data.companyWebsite) return { ok: true }; // honeypot tripped — silently succeed

  const listing = await prisma.businessListing.findUnique({ where: { id: listingId } });
  if (!listing || listing.status !== "PUBLISHED") return { ok: false, error: "Listing not found." };

  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("listing-report", ip, listingId), { limit: 3, windowMs: 60 * 60_000 }).allowed) {
    return { ok: false, error: "Too many requests — please try again later." };
  }

  await prisma.businessListingReport.create({
    data: {
      businessListingId: listingId,
      reason: parsed.data.reason,
      details: parsed.data.details || null,
      reporterEmail: parsed.data.reporterEmail || null,
      ipAddress: ip,
    },
  });

  await logAudit({
    userId: null,
    organizationId: listing.organizationId,
    action: "business_listing.reported",
    ipAddress: ip,
    metadata: { listingId, reason: parsed.data.reason },
  });

  return { ok: true };
}

/** Best-effort view counter — fired from a client component on mount, not from the page render itself (which may be served from ISR cache and wouldn't re-run per real visitor). Never throws, never blocks rendering. */
export async function recordListingView(listingId: string): Promise<void> {
  try {
    await prisma.businessListing.update({ where: { id: listingId }, data: { viewCount: { increment: 1 } } });
    await incrementDailyStat(listingId, "viewCount");
  } catch (error) {
    console.error("[listings/public-actions] recordListingView failed:", error);
  }
}
