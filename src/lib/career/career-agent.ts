import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { isAIConnected } from "@/lib/ai/client";
import { generateStructured } from "@/lib/ai/fallback";
import { recordAIUsage } from "@/lib/billing/ai-credits";
import { withAgentRunTracing } from "@/lib/ai/agent-governance";

/**
 * Phase 18 (AI Career Agent Foundation) — §18: the agent answers only
 * foundational questions grounded in the user's OWN real stored
 * CareerProfile/CareerResume data. No job/application/interview data
 * exists yet (Phase 19+), so this never fabricates any — the context
 * assembled below simply has no such section.
 */
const CareerAgentAnswerSchema = z.object({
  answer: z.string(),
  groundedIn: z.array(z.string()),
});

export interface CareerAgentResult {
  answer: string;
  groundedIn: string[];
}

async function buildCareerContext(userId: string, organizationId: string, careerProfileId: string): Promise<string | null> {
  const profile = await prisma.careerProfile.findUnique({
    where: { id: careerProfileId },
    include: { resumes: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!profile || profile.userId !== userId || profile.organizationId !== organizationId) return null;

  const lines: string[] = [`## Career Profile: ${profile.name} [CareerProfile:${profile.id}]`];
  if (profile.currentRole) lines.push(`Current role: ${profile.currentRole}`);
  if (profile.careerLevel) lines.push(`Career level: ${profile.careerLevel}`);
  if (profile.yearsOfExperience != null) lines.push(`Years of experience: ${profile.yearsOfExperience}`);
  if (profile.location) lines.push(`Location: ${profile.location}`);
  if (profile.industries.length > 0) lines.push(`Industries: ${profile.industries.join(", ")}`);
  if (profile.skills) lines.push(`Skills: ${JSON.stringify(profile.skills).slice(0, 2000)}`);
  if (profile.education) lines.push(`Education: ${JSON.stringify(profile.education).slice(0, 1000)}`);
  if (profile.targetRoles.length > 0) lines.push(`Target roles: ${profile.targetRoles.join(", ")}`);
  if (profile.targetCountries.length > 0) lines.push(`Target countries: ${profile.targetCountries.join(", ")}`);
  if (profile.workMode) lines.push(`Work mode preference: ${profile.workMode}`);
  if (profile.salaryMin != null || profile.salaryMax != null) {
    lines.push(`Salary range: ${profile.salaryMin ?? "?"}-${profile.salaryMax ?? "?"} ${profile.salaryCurrency ?? ""}`.trim());
  }
  if (profile.preferredTechnologies.length > 0) lines.push(`Preferred technologies: ${profile.preferredTechnologies.join(", ")}`);
  if (profile.relocationPreference) lines.push(`Relocation: ${profile.relocationPreference}`);
  if (profile.noticePeriodDays != null) lines.push(`Notice period: ${profile.noticePeriodDays} days`);

  const resume = profile.resumes[0];
  if (resume) {
    lines.push(`\n## Latest Resume: v${resume.version} [CareerResume:${resume.id}] — status ${resume.status}`);
  } else {
    lines.push(`\n## No resume uploaded yet.`);
  }

  return lines.join("\n");
}

export async function askCareerAgent(
  userId: string,
  organizationId: string,
  careerProfileId: string,
  question: string,
): Promise<CareerAgentResult | { error: string }> {
  if (!isAIConnected()) return { error: "AI is not connected for this environment." };

  const context = await buildCareerContext(userId, organizationId, careerProfileId);
  if (!context) return { error: "Career profile not found." };

  const result = await withAgentRunTracing(
    {
      organizationId,
      userId,
      domain: "CAREER",
      agentKey: "career-agent-chat",
      inputSummary: `Question: ${question.slice(0, 500)}`,
    },
    () =>
      generateStructured({
        system: `You are the KVL GrowthOS Career Agent — a foundational assistant that answers questions
about a user's OWN career profile using ONLY the real, stored data given to you below. You do not have
access to any job listings, applications, or interviews — that capability does not exist yet, so if asked
about jobs/applications/interviews, say so honestly rather than inventing any. Cite which real record(s)
(the [Type:id] tags in the context) your answer draws from in groundedIn. If the profile is missing
information needed to answer, say what's missing rather than guessing.`,
        userContent: `${context}\n\n## Question\n${question}`,
        maxTokens: 800,
        effort: "low",
        schema: CareerAgentAnswerSchema,
      }),
    (r) => ({ outputSummary: r.parsed.answer.slice(0, 500) }),
  );

  await recordAIUsage(organizationId, result.provider, result.model, result.inputTokens, result.outputTokens, "career:agent");

  return result.parsed;
}
