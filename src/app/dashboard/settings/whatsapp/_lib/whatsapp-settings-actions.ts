"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getConnection } from "@/lib/integrations/connection-store";
import { isValidE164 } from "@/lib/outreach/whatsapp-eligibility";
import { getOrCreateWhatsAppSendingIdentity } from "@/lib/outreach/whatsapp-sending-identity";
import type { WhatsAppTemplate } from "@/generated/prisma/client";

export interface WhatsAppSettingsResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function requireOwnerOrAdmin() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false as const, error: "You must be signed in." };
  const membership = await prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!membership) return { ok: false as const, error: "You don't belong to an organization yet." };
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") return { ok: false as const, error: "Only an owner or admin can change WhatsApp settings." };
  return { ok: true as const, userId, organizationId: membership.organizationId };
}

/**
 * Stores the org's real WhatsApp-enabled sender number as non-secret
 * IntegrationConnection.metadata (the same field DocuSign/other adapters
 * already use for non-secret provider details) — never a hard-coded value
 * (§3). Requires a real CONNECTED Twilio account first.
 */
export async function setWhatsAppFromNumberAction(phoneNumber: string): Promise<WhatsAppSettingsResult> {
  const access = await requireOwnerOrAdmin();
  if (!access.ok) return { ok: false, error: access.error };

  const trimmed = phoneNumber.trim();
  if (!isValidE164(trimmed)) return { ok: false, error: "Enter a valid E.164 number, e.g. +14155238886." };

  const connection = await getConnection(access.organizationId, "TWILIO");
  if (!connection || connection.status !== "CONNECTED") {
    return { ok: false, error: "Connect a Twilio account first at /dashboard/settings/integrations." };
  }

  await prisma.integrationConnection.update({
    where: { organizationId_provider: { organizationId: access.organizationId, provider: "TWILIO" } },
    data: { metadata: { ...(connection.metadata ?? {}), whatsappFromNumber: trimmed } },
  });
  await getOrCreateWhatsAppSendingIdentity(access.organizationId, trimmed);
  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "whatsapp.from_number_set", metadata: { phoneNumber: trimmed } });
  revalidatePath("/dashboard/settings/whatsapp");
  return { ok: true };
}

export async function getWhatsAppFromNumberAction(): Promise<WhatsAppSettingsResult<string | null>> {
  const access = await requireOwnerOrAdmin();
  if (!access.ok) return { ok: false, error: access.error };
  const connection = await getConnection(access.organizationId, "TWILIO");
  const metadata = connection?.metadata as { whatsappFromNumber?: string } | null | undefined;
  return { ok: true, data: metadata?.whatsappFromNumber ?? null };
}

/**
 * §16 — a real WhatsApp template is only usable once it's actually been
 * approved by the provider. Since this app has no live Twilio Content API
 * sync connected in this environment, templates are recorded manually
 * (real Content SID + real approval status the admin copies from their own
 * Twilio console) rather than fabricated — `approvalStatus` defaults to
 * UNKNOWN, never silently "APPROVED", until an admin explicitly confirms
 * the provider's own state.
 */
export interface AddTemplateInput {
  providerTemplateId: string;
  name: string;
  language: string;
  category: string;
  variables: string[];
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED" | "DISABLED" | "UNKNOWN";
}

export async function addWhatsAppTemplateAction(input: AddTemplateInput): Promise<WhatsAppSettingsResult<WhatsAppTemplate>> {
  const access = await requireOwnerOrAdmin();
  if (!access.ok) return { ok: false, error: access.error };
  if (!input.providerTemplateId.trim() || !input.name.trim()) return { ok: false, error: "A provider template id and name are required." };

  const data = await prisma.whatsAppTemplate.upsert({
    where: { organizationId_providerTemplateId: { organizationId: access.organizationId, providerTemplateId: input.providerTemplateId.trim() } },
    create: {
      organizationId: access.organizationId,
      providerTemplateId: input.providerTemplateId.trim(),
      name: input.name.trim(),
      language: input.language.trim() || "en",
      category: input.category.trim() || "UTILITY",
      variables: input.variables,
      approvalStatus: input.approvalStatus,
      lastSyncedAt: new Date(),
    },
    update: { name: input.name.trim(), language: input.language.trim() || "en", category: input.category.trim() || "UTILITY", variables: input.variables, approvalStatus: input.approvalStatus, lastSyncedAt: new Date() },
  });
  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "whatsapp.template_saved", metadata: { templateId: data.id, providerTemplateId: data.providerTemplateId } });
  revalidatePath("/dashboard/settings/whatsapp");
  return { ok: true, data };
}

export async function listWhatsAppTemplatesAction(): Promise<WhatsAppSettingsResult<WhatsAppTemplate[]>> {
  const access = await requireOwnerOrAdmin();
  if (!access.ok) return { ok: false, error: access.error };
  const data = await prisma.whatsAppTemplate.findMany({ where: { organizationId: access.organizationId }, orderBy: { createdAt: "desc" } });
  return { ok: true, data };
}
