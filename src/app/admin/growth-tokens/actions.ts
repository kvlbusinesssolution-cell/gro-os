"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformOwner } from "@/lib/billing/platform-admin";
import { adjustGrowthTokensManually, type AdjustGrowthTokensResult } from "@/lib/billing/growth-tokens";

/** Platform-operator-only — a manual Growth Token grant/deduct is a cross-tenant money-equivalent decision, same gate as every other /admin/* action. */
export async function adjustGrowthTokensAction(organizationId: string, deltaTokens: number, reason: string): Promise<AdjustGrowthTokensResult> {
  const admin = await requirePlatformOwner("/admin/growth-tokens");
  const result = await adjustGrowthTokensManually(organizationId, deltaTokens, { adminUserId: admin.userId, reason });
  revalidatePath("/admin/growth-tokens");
  return result;
}
