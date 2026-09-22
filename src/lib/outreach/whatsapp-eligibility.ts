import { prisma } from "@/lib/prisma";
import { checkSuppression } from "./suppression";

/**
 * Phase 8 (WhatsApp Business Outreach) §6/§8 — the single, deterministic
 * eligibility check every outbound WhatsApp send path must run BEFORE
 * calling the provider. Mirrors Phase 4's "one choke-point" discipline
 * (checkSuppression before every email send).
 */

export type WhatsAppEligibilityStatus = "ELIGIBLE" | "OPTED_IN" | "OPTED_OUT" | "BLOCKED" | "INVALID_NUMBER" | "UNKNOWN" | "RESTRICTED";

export interface WhatsAppEligibilityResult {
  status: WhatsAppEligibilityStatus;
  phone: string | null;
  detail: string;
}

// Standard E.164: + followed by 7-15 digits, first digit 1-9.
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/** Format-only validation — this app has no Twilio Lookup (paid add-on) integration, so a passing check means "well-formed", never "confirmed WhatsApp-reachable" (§8: never falsely display VERIFIED). */
export function isValidE164(phone: string): boolean {
  return E164_PATTERN.test(phone.trim());
}

export async function checkWhatsAppEligibility(organizationId: string, contactId: string): Promise<WhatsAppEligibilityResult> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== organizationId) {
    return { status: "UNKNOWN", phone: null, detail: "Contact not found." };
  }

  if (!contact.phone || !contact.phone.trim()) {
    return { status: "INVALID_NUMBER", phone: null, detail: "Contact has no phone number on file." };
  }

  const phone = contact.phone.trim();
  if (!isValidE164(phone)) {
    return { status: "INVALID_NUMBER", phone, detail: "Phone number is not in valid E.164 format (e.g. +14155552671)." };
  }

  const suppression = await checkSuppression(organizationId, phone, "WHATSAPP");
  if (suppression.suppressed) {
    return { status: "OPTED_OUT", phone, detail: suppression.detail ?? `Suppressed (${suppression.reason}).` };
  }

  const conversation = await prisma.whatsAppConversation.findUnique({ where: { organizationId_contactId: { organizationId, contactId } } });
  if (conversation?.status === "RESTRICTED") {
    return { status: "RESTRICTED", phone, detail: conversation.restrictedReason ?? "Provider reported a restriction on this conversation." };
  }

  // A real prior inbound message is the honest basis for "OPTED_IN" (the
  // contact has actively messaged us) — never assumed from a contact simply
  // existing in the CRM.
  const hasInboundMessage = await prisma.reply.findFirst({ where: { organizationId, contactId, channel: "WHATSAPP" } });
  if (hasInboundMessage) return { status: "OPTED_IN", phone, detail: "Contact has previously messaged us on WhatsApp." };

  return { status: "ELIGIBLE", phone, detail: "Valid number, not suppressed, no known restriction — eligible for a first outbound message (template required outside any open session window per provider rules)." };
}
