"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { askAiAboutClient } from "@/lib/business-development/ask-ai-about-client";

export interface AskAiActionResult {
  ok: boolean;
  error?: string;
  answer?: string;
  groundedIn?: string[];
}

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

/** Session-gated wrapper around askAiAboutClient — resolves the caller's active membership, then delegates to the real, grounded core function. */
export async function askAiAboutClientAction(companyId: string, question: string): Promise<AskAiActionResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const trimmed = question.trim();
  if (!trimmed) return { ok: false, error: "Enter a question first." };

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, organizationId: true } });
  if (!company || company.organizationId !== membership.organizationId) {
    return { ok: false, error: "Company not found." };
  }

  const result = await askAiAboutClient(membership.organizationId, companyId, trimmed);
  if (!result) {
    return { ok: false, error: "AI isn't connected, or there isn't enough real conversation data yet to answer this." };
  }
  return { ok: true, answer: result.answer, groundedIn: result.groundedIn };
}
