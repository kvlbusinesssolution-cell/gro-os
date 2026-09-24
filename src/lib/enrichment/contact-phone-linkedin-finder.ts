import { prisma } from "@/lib/prisma";
import { isProspeoConfigured, prospeoEnrichPersonFull } from "./providers/prospeo";
import { resolveFieldConflict } from "@/lib/business-development/evidence-priority";

/**
 * Real mobile-number + LinkedIn-URL finder for a contact, via Prospeo's
 * full person-enrich response — a genuinely different, separately-costed
 * Prospeo call from prospeoFindEmail (email-waterfall.ts), never combined
 * with it so an email-only lookup never pays this higher credit cost.
 * Only runs when the contact is missing BOTH phone and linkedin (fill-
 * when-empty; a contact already fully filled has nothing left to find).
 */

export interface ContactPhoneLinkedInFinderResult {
  attempted: boolean;
  phoneFound: boolean;
  linkedinFound: boolean;
}

async function logCall(organizationId: string, target: string, succeeded: boolean, resultSummary: string): Promise<void> {
  try {
    await prisma.dataProviderCallLog.create({ data: { organizationId, provider: "PROSPEO", target, succeeded, resultSummary } });
  } catch (error) {
    console.error("[enrichment/contact-phone-linkedin-finder] failed to write call log:", error);
  }
}

export async function enrichContactPhoneAndLinkedIn(contactId: string): Promise<ContactPhoneLinkedInFinderResult> {
  if (!isProspeoConfigured()) return { attempted: false, phoneFound: false, linkedinFound: false };

  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId }, include: { company: true } });
  const needsPhone = !contact.phone;
  const needsLinkedin = !contact.linkedin;
  if (!needsPhone && !needsLinkedin) return { attempted: false, phoneFound: false, linkedinFound: false };

  const companyWebsite = contact.company?.website ?? contact.company?.domain;
  if (!companyWebsite) return { attempted: false, phoneFound: false, linkedinFound: false };

  const fullName = `${contact.firstName} ${contact.lastName ?? ""}`.trim();
  const result = await prospeoEnrichPersonFull(fullName, companyWebsite);
  await logCall(contact.organizationId, `${fullName}@${companyWebsite}`, result.ok, result.ok ? `mobile=${Boolean(result.mobile)} linkedin=${Boolean(result.linkedinUrl)}` : (result.error ?? "unknown error"));

  if (!result.ok) return { attempted: true, phoneFound: false, linkedinFound: false };

  let phoneFound = false;
  if (needsPhone && result.mobile) {
    const existingFieldEvidence = await prisma.contactEvidence.findMany({ where: { contactId, fieldName: "phone" }, select: { source: true } });
    const conflict = resolveFieldConflict("PROSPEO", existingFieldEvidence);
    if (conflict.shouldApplyToCompanyField) {
      await prisma.contact.update({ where: { id: contactId }, data: { phone: result.mobile } });
    }
    const fact = `Mobile number "${result.mobile}" found via Prospeo.`;
    const existing = await prisma.contactEvidence.findFirst({ where: { contactId, source: "PROSPEO", fact }, select: { id: true } });
    if (!existing) {
      await prisma.contactEvidence.create({ data: { contactId, kind: "RAW_FACT", fact, source: "PROSPEO", fieldName: "phone", confidence: 0.8 } });
    }
    phoneFound = true;
  }

  let linkedinFound = false;
  if (needsLinkedin && result.linkedinUrl) {
    const existingFieldEvidence = await prisma.contactEvidence.findMany({ where: { contactId, fieldName: "linkedin" }, select: { source: true } });
    const conflict = resolveFieldConflict("PROSPEO", existingFieldEvidence);
    if (conflict.shouldApplyToCompanyField) {
      await prisma.contact.update({ where: { id: contactId }, data: { linkedin: result.linkedinUrl } });
    }
    const fact = `LinkedIn profile "${result.linkedinUrl}" found via Prospeo.`;
    const existing = await prisma.contactEvidence.findFirst({ where: { contactId, source: "PROSPEO", fact }, select: { id: true } });
    if (!existing) {
      await prisma.contactEvidence.create({ data: { contactId, kind: "RAW_FACT", fact, source: "PROSPEO", fieldName: "linkedin", confidence: 0.8 } });
    }
    linkedinFound = true;
  }

  return { attempted: true, phoneFound, linkedinFound };
}
