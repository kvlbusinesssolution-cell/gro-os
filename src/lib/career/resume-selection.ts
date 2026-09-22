/**
 * Phase 20 — §8 real, explainable resume selection.
 *
 * Real architecture note: unlike the spec's own example ("Senior React
 * Developer v3" selected from several distinctly-named resumes), THIS
 * codebase already put role-targeting on CareerProfile itself (Phase 18:
 * "Lets one user maintain multiple, isolated target-role profiles §6") —
 * CareerResume is version history WITHIN one profile, not multiple
 * differently-targeted resumes competing for the same application.
 * Building a second, parallel multi-resume-per-role system would directly
 * violate the spec's own "do not create duplicate CareerProfile" rule.
 * "Selection" here therefore means: the latest genuinely usable
 * (VERIFIED > PROCESSED > REVIEW_REQUIRED) version of THIS profile's
 * resume — with the explanation grounded in real overlap against the
 * job's requirements, never a fabricated justification.
 */

import { prisma } from "@/lib/prisma";

const USABLE_STATUS_RANK: Record<string, number> = {
  VERIFIED: 3,
  PROCESSED: 2,
  REVIEW_REQUIRED: 1,
};

export interface ResumeSelectionResult {
  resumeId: string | null;
  reason: string;
}

export async function selectResumeForApplication(careerProfileId: string, jobRequiredTechnologies: string[]): Promise<ResumeSelectionResult> {
  const resumes = await prisma.careerResume.findMany({
    where: { careerProfileId, status: { in: ["VERIFIED", "PROCESSED", "REVIEW_REQUIRED"] } },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true, aiExtractedProfile: true, originalFilename: true },
  });

  if (resumes.length === 0) {
    return { resumeId: null, reason: "No processed resume is available for this career profile — upload and process a resume before applying." };
  }

  const ranked = [...resumes].sort((a, b) => {
    const rankDiff = (USABLE_STATUS_RANK[b.status] ?? 0) - (USABLE_STATUS_RANK[a.status] ?? 0);
    if (rankDiff !== 0) return rankDiff;
    return b.version - a.version;
  });

  const best = ranked[0];
  const reasons: string[] = [`Selected "${best.originalFilename}" (version ${best.version}, status ${best.status}) — the most recently processed, highest-confidence resume on file.`];

  if (jobRequiredTechnologies.length > 0 && best.aiExtractedProfile && typeof best.aiExtractedProfile === "object" && !Array.isArray(best.aiExtractedProfile)) {
    const profile = best.aiExtractedProfile as { skills?: unknown };
    // §Phase 31 — a real, previously-unhandled malformed-resume crash:
    // aiExtractedProfile.skills is trusted AI-extraction output, not a
    // validated schema — a partial/corrupt extraction can genuinely leave
    // it as a non-array value. Never assume its shape; a resume this
    // malformed simply doesn't contribute a skill-overlap explanation
    // rather than crashing the whole application-prepare pipeline.
    const rawSkills = Array.isArray(profile.skills) ? profile.skills : [];
    const skillNames = new Set(
      rawSkills
        .map((s) => (typeof s === "string" ? s : typeof s === "object" && s !== null ? ((s as { name?: unknown }).name ?? "") : ""))
        .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
        .filter(Boolean),
    );
    const overlap = jobRequiredTechnologies.filter((t) => skillNames.has(t.trim().toLowerCase()));
    if (overlap.length > 0) {
      reasons.push(`Contains ${overlap.length} of ${jobRequiredTechnologies.length} required technologies: ${overlap.join(", ")}.`);
    }
  }

  return { resumeId: best.id, reason: reasons.join(" ") };
}
