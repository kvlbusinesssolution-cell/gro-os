"use server";

import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { notifyOrganizationOwners } from "@/lib/notifications";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/security/client-ip";
import { findOrCreateContact } from "@/lib/business-development/dedup";
import { createSignedFileToken } from "@/lib/storage/signed-url";
import { landingPageLeadSubmissionSchema, type LandingPageLeadSubmissionInput, type LandingPageFormField } from "@/lib/validations/marketing";

export interface ActionResult {
  ok: boolean;
  error?: string;
  downloadUrl?: string;
}

const LEAD_MAGNET_LINK_TTL_SECONDS = 24 * 60 * 60;

async function clientIp(): Promise<string> {
  const h = await headers();
  return clientIpFromHeaders(h);
}

/**
 * Public form submission for a published MarketingLandingPage — always
 * free (never Growth-Token-gated, same "lead capture stays free" rule as
 * requestQuotes in src/app/listings/_lib/public-actions.ts, which this
 * mirrors: Zod validation, a honeypot field, rate limiting, real client-IP
 * capture). The real durable record is a Contact (findOrCreateContact,
 * dedup.ts) — this action never invents a second lead-storage concept.
 */
export async function submitLandingPageLead(landingPageId: string, input: LandingPageLeadSubmissionInput): Promise<ActionResult> {
  const parsed = landingPageLeadSubmissionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  if (parsed.data.companyWebsite) return { ok: true }; // honeypot tripped — silently succeed, never tip off a bot

  const ip = await clientIp();
  if (!checkRateLimit(`landing-page-lead:${ip}`, { limit: 5, windowMs: 60 * 60_000 }).allowed) {
    return { ok: false, error: "Too many requests — please try again later." };
  }

  const page = await prisma.marketingLandingPage.findUnique({ where: { id: landingPageId } });
  if (!page || page.status !== "PUBLISHED") return { ok: false, error: "This page is not accepting submissions." };

  const formFields = page.formFields as unknown as LandingPageFormField[];

  // The page's own formFields definition is the source of truth for what's
  // required — never the generic submission schema, since that's per-page,
  // not knowable at that schema's compile time.
  for (const field of formFields) {
    if (field.required && !parsed.data.fields[field.key]?.trim()) {
      return { ok: false, error: `${field.label} is required.` };
    }
  }

  const nameField = formFields.find((f) => f.role === "name");
  const emailField = formFields.find((f) => f.role === "email");
  const phoneField = formFields.find((f) => f.role === "phone");
  const fullName = (nameField ? parsed.data.fields[nameField.key] : undefined)?.trim();
  const email = (emailField ? parsed.data.fields[emailField.key] : undefined)?.trim();
  if (!fullName || !email) return { ok: false, error: "This page's form is missing a name or email field — contact the page owner." };

  const [firstName, ...rest] = fullName.split(/\s+/);
  const lastName = rest.length > 0 ? rest.join(" ") : null;
  const phone = phoneField ? parsed.data.fields[phoneField.key]?.trim() || null : null;

  const { contact } = await findOrCreateContact({
    organizationId: page.organizationId,
    firstName: firstName || fullName,
    lastName,
    email,
    phone,
    tags: ["inbound-marketing"],
  });

  await prisma.marketingLandingPageLead.create({
    data: { marketingLandingPageId: page.id, contactId: contact.id, rawFieldData: parsed.data.fields, ipAddress: ip },
  });

  await notifyOrganizationOwners({
    organizationId: page.organizationId,
    type: "APPROVAL_REQUESTED",
    title: "New landing page lead",
    message: `${fullName} (${email}) submitted "${page.title}". Check the CRM contact for details.`,
  });

  await logAudit({
    userId: null,
    organizationId: page.organizationId,
    action: "marketing_landing_page.lead_submitted",
    metadata: { landingPageId: page.id, contactId: contact.id },
  });

  // A gated lead magnet — issue a short-lived signed download link only
  // after a real submission, never a public static path.
  let downloadUrl: string | undefined;
  if (page.leadMagnetAssetKey && page.leadMagnetAssetFilename) {
    const token = createSignedFileToken({
      subdir: "marketing-assets",
      storageKey: page.leadMagnetAssetKey,
      filename: page.leadMagnetAssetFilename,
      contentType: page.leadMagnetAssetContentType ?? "application/octet-stream",
      expiresInSeconds: LEAD_MAGNET_LINK_TTL_SECONDS,
    });
    downloadUrl = `/api/files/signed/${token}`;
  }

  return { ok: true, downloadUrl };
}

/** Real page-view counter — best-effort, never blocks rendering the page if it fails. */
export async function recordLandingPageView(landingPageId: string): Promise<void> {
  await prisma.marketingLandingPage.update({ where: { id: landingPageId }, data: { viewCount: { increment: 1 } } }).catch(() => {});
}
