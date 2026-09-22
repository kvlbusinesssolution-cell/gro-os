"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { computeAttributionForOrganization, type BulkAttributionResult } from "@/lib/analytics/revenue-attribution";

export interface AttributionActionResult {
  ok: boolean;
  data?: BulkAttributionResult;
  error?: string;
}

/**
 * Phase 7 (Revenue Attribution Engine) — manual "Recompute Attribution"
 * trigger. Deterministic, non-AI, financial-integrity-sensitive: never
 * modifies Invoice/Deal/Payment amounts (§48) — only (re)computes and
 * upserts the derived RevenueAttribution rows, idempotently (§45).
 */
export async function recomputeAttributionAction(): Promise<AttributionActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  if (!checkRateLimit(`recompute-attribution:${userId}`, { limit: 5, windowMs: 5 * 60_000 }).allowed) {
    return { ok: false, error: "Too many recompute requests — wait a few minutes and try again." };
  }

  const data = await computeAttributionForOrganization(membership.organizationId);
  await logAudit({ userId, organizationId: membership.organizationId, action: "revenue_attribution.recomputed", metadata: data as unknown as Record<string, unknown> });
  revalidatePath("/dashboard/revenue-command-center");
  return { ok: true, data };
}
