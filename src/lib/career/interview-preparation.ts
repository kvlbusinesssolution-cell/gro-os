import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { generateStructured } from "@/lib/ai/fallback";
import { isAIConnected } from "@/lib/ai/client";
import { recordAIUsage } from "@/lib/billing/ai-credits";

/**
 * Phase 21 (§49, §50) — real interview preparation, grounded in whatever
 * real data actually exists. §50 reuses the existing Company/
 * CompanyIntelligence system (organization's own CRM company research) —
 * matched to a Job by domain/name only when a confident match exists;
 * otherwise honestly reports no verified company research is available
 * rather than inventing company facts.
 *
 * §49 requires FACTUAL INFORMATION to be clearly distinguished from
 * AI-GENERATED PREPARATION — enforced structurally: `facts` below is
 * assembled deterministically from real DB rows (job/company/profile),
 * never by the AI call; only `likelyTopics`/`potentialQuestions`/
 * `candidateQuestions`/`highlightExperience` come from the AI, and every
 * one of those is worded as "likely"/"potential", never a certainty claim.
 */

const PreparationSchema = z.object({
  likelyTopics: z.array(z.string().trim().max(200)).max(10),
  potentialQuestions: z.array(z.string().trim().max(300)).max(10),
  candidateQuestions: z.array(z.string().trim().max(300)).max(8),
  highlightExperience: z.array(z.string().trim().max(300)).max(8),
});

const SYSTEM_PROMPT = `You help a job candidate prepare for a real upcoming interview. You are given REAL, verified facts
about the job, the company, and the candidate's own career profile — use ONLY this real data as your basis.

Generate:
- likelyTopics: topics the interview will PROBABLY cover, based on the real job requirements/description.
- potentialQuestions: specific questions that COULD plausibly be asked, grounded in the real job/company/profile data given.
- candidateQuestions: good questions the CANDIDATE could ask the interviewer, grounded in the real company/job data given.
- highlightExperience: which of the candidate's OWN real, verified skills/experience/projects (given to you) are most
  worth emphasizing for this specific role — never invent an experience/skill/project the candidate data doesn't contain.

Never claim any question WILL definitely be asked — frame everything as "likely"/"potential". Never invent company facts,
job requirements, or candidate experience beyond what is given to you below.`;

export interface InterviewPreparationResult {
  facts: string[];
  aiGenerated: {
    likelyTopics: string[];
    potentialQuestions: string[];
    candidateQuestions: string[];
    highlightExperience: string[];
  } | null;
  companyResearchAvailable: boolean;
}

export async function generateInterviewPreparation(applicationId: string): Promise<InterviewPreparationResult | { error: string }> {
  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { job: true, careerProfile: true },
  });
  if (!application) return { error: "Application not found." };

  // §49 FACTUAL INFORMATION — assembled deterministically from real rows, never AI-generated.
  const facts: string[] = [
    `Role: ${application.job.title} at ${application.job.company}.`,
    application.job.location ? `Location: ${application.job.location}.` : `Location: not stated by the source.`,
    application.job.workMode ? `Work mode: ${application.job.workMode}.` : `Work mode: not stated by the source.`,
  ];
  if (application.job.requirements && typeof application.job.requirements === "object") {
    const req = application.job.requirements as { required?: string[]; preferred?: string[] };
    if (req.required?.length) facts.push(`Required (per the real posting): ${req.required.join(", ")}.`);
    if (req.preferred?.length) facts.push(`Preferred (per the real posting): ${req.preferred.join(", ")}.`);
  }
  if (application.job.technologies.length > 0) facts.push(`Technologies mentioned in the posting: ${application.job.technologies.join(", ")}.`);

  // §50 — real company research, only if a confident, existing match exists. Never fabricated.
  let companyResearchAvailable = false;
  const domain = application.job.companyDomain;
  const company = domain
    ? await prisma.company.findFirst({ where: { organizationId: application.organizationId, domain }, orderBy: { createdAt: "desc" } })
    : await prisma.company.findFirst({ where: { organizationId: application.organizationId, name: { equals: application.job.company, mode: "insensitive" } }, orderBy: { createdAt: "desc" } });

  if (company) {
    const intelligence = await prisma.companyIntelligence.findFirst({ where: { companyId: company.id }, orderBy: { createdAt: "desc" } });
    if (intelligence) {
      companyResearchAvailable = true;
      facts.push(`Company research (real, verified — ${intelligence.confidenceScore}% confidence): ${intelligence.businessSummary}`);
      if (intelligence.hiringSignals.length > 0) facts.push(`Real hiring signals on file: ${intelligence.hiringSignals.join("; ")}.`);
    }
  }
  if (!companyResearchAvailable) {
    facts.push("No verified company research is on file for this employer in GrowthOS — company-specific preparation notes below are limited to what the job posting itself states.");
  }

  const profileSkills = Array.isArray(application.careerProfile.skills) ? (application.careerProfile.skills as Array<{ name?: string }>).map((s) => s.name).filter(Boolean) : [];
  facts.push(`Candidate's own verified skills on file: ${profileSkills.length > 0 ? profileSkills.join(", ") : "none recorded."}`);

  if (!isAIConnected()) {
    return { facts, aiGenerated: null, companyResearchAvailable };
  }

  const context = `JOB:\n${application.job.title} at ${application.job.company}\n${application.job.description.slice(0, 3000)}\n\nCOMPANY RESEARCH:\n${facts.find((f) => f.startsWith("Company research")) ?? "None available."}\n\nCANDIDATE'S VERIFIED SKILLS:\n${profileSkills.join(", ") || "None recorded."}\n\nCANDIDATE'S VERIFIED PROJECTS:\n${JSON.stringify(application.careerProfile.projects ?? [])}`;

  const result = await generateStructured({
    system: SYSTEM_PROMPT,
    userContent: context.slice(0, 8000),
    maxTokens: 1200,
    effort: "low",
    schema: PreparationSchema,
  });
  await recordAIUsage(application.organizationId, result.provider, result.model, result.inputTokens, result.outputTokens, "career:interview-preparation");

  return { facts, aiGenerated: result.parsed, companyResearchAvailable };
}
