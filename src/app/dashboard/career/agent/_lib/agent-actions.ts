"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { askCareerAgent } from "@/lib/career/career-agent";

async function resolveActiveMembership(userId: string) {
  return prisma.membership.findFirst({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

export interface AskCareerAgentResult {
  ok: boolean;
  error?: string;
  answer?: string;
  groundedIn?: string[];
}

export async function askCareerAgentAction(careerProfileId: string, question: string): Promise<AskCareerAgentResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (!question.trim()) return { ok: false, error: "Ask a question first." };

  const membership = await resolveActiveMembership(userId);
  if (!membership) return { ok: false, error: "You don't belong to an organization yet." };

  const result = await askCareerAgent(userId, membership.organizationId, careerProfileId, question.trim());
  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, answer: result.answer, groundedIn: result.groundedIn };
}
