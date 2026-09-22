"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getConnection } from "@/lib/integrations/connection-store";
import { isValidE164 } from "@/lib/outreach/whatsapp-eligibility";

export interface VoiceSettingsResult {
  ok: boolean;
  error?: string;
}

async function requireOwnerOrAdmin() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false as const, error: "You must be signed in." };
  const membership = await prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!membership) return { ok: false as const, error: "You don't belong to an organization yet." };
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") return { ok: false as const, error: "Only an owner or admin can change voice-calling settings." };
  return { ok: true as const, userId, organizationId: membership.organizationId };
}

/** §34 — the org's authorized caller-ID number. Reuses the same connected Twilio account WhatsApp/SMS already use — no separate credential. */
export async function setVoiceFromNumberAction(phoneNumber: string): Promise<VoiceSettingsResult> {
  const access = await requireOwnerOrAdmin();
  if (!access.ok) return { ok: false, error: access.error };

  const trimmed = phoneNumber.trim();
  if (!isValidE164(trimmed)) return { ok: false, error: "Enter a valid E.164 number, e.g. +14155238886." };

  const connection = await getConnection(access.organizationId, "TWILIO");
  if (!connection || connection.status !== "CONNECTED") return { ok: false, error: "Connect a Twilio account first at /dashboard/settings/integrations." };

  await prisma.integrationConnection.update({
    where: { organizationId_provider: { organizationId: access.organizationId, provider: "TWILIO" } },
    data: { metadata: { ...(connection.metadata ?? {}), voiceFromNumber: trimmed } },
  });
  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "voice.from_number_set", metadata: { phoneNumber: trimmed } });
  revalidatePath("/dashboard/settings/voice");
  return { ok: true };
}

/** §11 — the real, org-approved AI-disclosure script every outbound call speaks first. */
export async function setAiDisclosureScriptAction(script: string): Promise<VoiceSettingsResult> {
  const access = await requireOwnerOrAdmin();
  if (!access.ok) return { ok: false, error: access.error };

  const trimmed = script.trim();
  if (!trimmed) return { ok: false, error: "Enter a disclosure script." };

  const connection = await getConnection(access.organizationId, "TWILIO");
  if (!connection || connection.status !== "CONNECTED") return { ok: false, error: "Connect a Twilio account first at /dashboard/settings/integrations." };

  await prisma.integrationConnection.update({
    where: { organizationId_provider: { organizationId: access.organizationId, provider: "TWILIO" } },
    data: { metadata: { ...(connection.metadata ?? {}), aiDisclosureScript: trimmed } },
  });
  await logAudit({ userId: access.userId, organizationId: access.organizationId, action: "voice.disclosure_script_set", metadata: {} });
  revalidatePath("/dashboard/settings/voice");
  return { ok: true };
}
