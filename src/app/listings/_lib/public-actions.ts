"use server";

import { headers } from "next/headers";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { notifyOrganizationOwners } from "@/lib/notifications";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/security/client-ip";
import { incrementDailyStat } from "@/lib/listings/daily-stats";
import { requestQuotesSchema, type RequestQuotesInput } from "@/lib/validations/listings";

/**
 * "Get Quotes" — JustDial's flagship discovery feature: one message fanned
 * out to several matching businesses at once instead of contacting each one
 * individually. Reuses BusinessListingLead (type ENQUIRY_FORM) rather than a
 * new model, tagged with a shared quoteBatchId, so it shows up in each
 * business's existing lead inbox (lead-inbox-actions.ts) with zero
 * inbox-side changes.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  matchedCount?: number;
}

const MAX_TARGETS = 5;

async function clientIp(): Promise<string> {
  const h = await headers();
  return clientIpFromHeaders(h);
}

export async function requestQuotes(input: RequestQuotesInput): Promise<ActionResult> {
  const parsed = requestQuotesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  if (parsed.data.companyWebsite) return { ok: true, matchedCount: 0 }; // honeypot tripped — silently succeed, never tip off a bot

  const ip = await clientIp();
  if (!checkRateLimit(`get-quotes:${ip}`, { limit: 5, windowMs: 60 * 60_000 }).allowed) {
    return { ok: false, error: "Too many requests — please try again later." };
  }

  const targets = await prisma.businessListing.findMany({
    where: {
      status: "PUBLISHED",
      city: parsed.data.city,
      OR: [{ category: parsed.data.category }, { categories: { has: parsed.data.category } }],
    },
    orderBy: [{ isFeatured: "desc" }, { averageRating: "desc" }],
    take: MAX_TARGETS,
    select: { id: true, organizationId: true, businessName: true },
  });

  if (targets.length === 0) return { ok: false, error: "No matching businesses found for that category and city yet." };

  const quoteBatchId = randomUUID();
  const headerBag = await headers();
  const userAgent = headerBag.get("user-agent");

  await prisma.$transaction(async (tx) => {
    await tx.businessListingLead.createMany({
      data: targets.map((t) => ({
        businessListingId: t.id,
        type: "ENQUIRY_FORM" as const,
        name: parsed.data.name,
        email: parsed.data.email || null,
        phone: parsed.data.phone,
        message: parsed.data.message || null,
        ipAddress: ip,
        userAgent,
        quoteBatchId,
      })),
    });
    await tx.businessListing.updateMany({ where: { id: { in: targets.map((t) => t.id) } }, data: { leadCount: { increment: 1 } } });
    await Promise.all(targets.map((t) => incrementDailyStat(t.id, "leadCount", tx)));
  });

  await Promise.all(
    targets.map((t) =>
      notifyOrganizationOwners({
        organizationId: t.organizationId,
        type: "APPROVAL_REQUESTED",
        title: "New quote request",
        message: `${parsed.data.name} requested a quote for ${parsed.data.category} in ${parsed.data.city} — "${t.businessName}" was matched. Check the lead inbox.`,
      }),
    ),
  );

  await logAudit({
    userId: null,
    organizationId: null,
    action: "business_listing.quotes_requested",
    ipAddress: ip,
    metadata: { quoteBatchId, category: parsed.data.category, city: parsed.data.city, matchedListingIds: targets.map((t) => t.id) },
  });

  return { ok: true, matchedCount: targets.length };
}
