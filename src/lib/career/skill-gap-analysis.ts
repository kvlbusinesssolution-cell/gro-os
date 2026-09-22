/**
 * Phase 22 (Career Learning + Job Market Intelligence) — §24 skill gap
 * analysis. Compares real job requirements (across this profile's actual
 * JobMatch rows) against the profile's own verified skills, and keeps
 * MARKET DEMAND strictly separate from USER SKILL GAP (§24) — a skill can
 * be in high market demand without the user "missing" it, and a skill
 * absent from the profile is only ever called a gap when the profile
 * genuinely lacks evidence for it, never guessed.
 */

import { prisma } from "@/lib/prisma";

export interface SkillGapEntry {
  skill: string;
  relevantJobCount: number;
  // §71 — UNKNOWN/NEEDS_VERIFICATION when the profile simply lacks enough
  // evidence, never conflated with a confirmed "missing".
  userEvidenceStatus: "PRESENT" | "MISSING" | "NEEDS_VERIFICATION";
  importance: "REQUIRED" | "PREFERRED";
}

export async function getSkillGapAnalysis(organizationId: string, careerProfileId: string): Promise<{ kind: "OBSERVATION"; gaps: SkillGapEntry[]; marketDemandNote: string }> {
  const profile = await prisma.careerProfile.findUnique({ where: { id: careerProfileId }, select: { organizationId: true, skills: true } });
  if (!profile || profile.organizationId !== organizationId) return { kind: "OBSERVATION", gaps: [], marketDemandNote: "Career profile not found." };

  const profileSkills = Array.isArray(profile.skills) ? (profile.skills as Array<{ name?: string }>).map((s) => (s.name ?? "").toLowerCase()).filter(Boolean) : [];
  const verified = new Set(profileSkills);

  const matches = await prisma.jobMatch.findMany({
    where: { organizationId, careerProfileId },
    select: { job: { select: { requirements: true, technologies: true } } },
  });

  const required = new Map<string, number>();
  const preferred = new Map<string, number>();
  for (const m of matches) {
    const req = m.job.requirements as { required?: string[]; preferred?: string[] } | null;
    for (const s of req?.required ?? []) required.set(s.toLowerCase(), (required.get(s.toLowerCase()) ?? 0) + 1);
    for (const s of req?.preferred ?? []) preferred.set(s.toLowerCase(), (preferred.get(s.toLowerCase()) ?? 0) + 1);
  }

  const gaps: SkillGapEntry[] = [];
  for (const [skill, count] of required.entries()) {
    gaps.push({
      skill,
      relevantJobCount: count,
      userEvidenceStatus: verified.has(skill) ? "PRESENT" : profileSkills.length === 0 ? "NEEDS_VERIFICATION" : "MISSING",
      importance: "REQUIRED",
    });
  }
  for (const [skill, count] of preferred.entries()) {
    if (required.has(skill)) continue;
    gaps.push({
      skill,
      relevantJobCount: count,
      userEvidenceStatus: verified.has(skill) ? "PRESENT" : profileSkills.length === 0 ? "NEEDS_VERIFICATION" : "MISSING",
      importance: "PREFERRED",
    });
  }

  gaps.sort((a, b) => b.relevantJobCount - a.relevantJobCount);

  return {
    kind: "OBSERVATION",
    gaps,
    marketDemandNote: `relevantJobCount reflects MARKET DEMAND across ${matches.length} real matched jobs for this profile — not a claim about how many jobs the user is eligible for.`,
  };
}
