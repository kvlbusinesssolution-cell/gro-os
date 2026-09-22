/**
 * Phase 18 (AI Career Agent Foundation) — deterministic profile
 * completeness (§26). Every section below is checked against a REAL stored
 * field — never an AI-guessed or fabricated bonus. Documented calculation:
 * 7 equally-weighted sections, each worth ~14.3 points, section counted
 * complete only when it has real, non-empty data.
 */
export interface CareerProfileCompletenessInput {
  currentRole: string | null;
  location: string | null;
  yearsOfExperience: number | null;
  skills: unknown;
  education: unknown;
  experienceHasResume: boolean; // a real CareerResume with extractedText exists
  githubUrl: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  portfolioUrl: string | null;
  targetRoles: string[];
  industries: string[];
}

export interface CareerProfileCompletenessResult {
  score: number; // 0-100, rounded
  sections: Array<{ section: string; complete: boolean }>;
  missingSections: string[];
}

function hasContent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export function computeCareerProfileCompleteness(input: CareerProfileCompletenessInput): CareerProfileCompletenessResult {
  const sections: Array<{ section: string; complete: boolean }> = [
    { section: "Identity (current role, location)", complete: hasContent(input.currentRole) && hasContent(input.location) },
    { section: "Experience", complete: input.yearsOfExperience != null && input.yearsOfExperience >= 0 },
    { section: "Skills", complete: hasContent(input.skills) },
    { section: "Education", complete: hasContent(input.education) },
    { section: "Resume on file", complete: input.experienceHasResume },
    { section: "Links (GitHub/LinkedIn/website/portfolio)", complete: [input.githubUrl, input.linkedinUrl, input.websiteUrl, input.portfolioUrl].some(hasContent) },
    { section: "Preferences (target roles, industries)", complete: hasContent(input.targetRoles) && hasContent(input.industries) },
  ];

  const completeCount = sections.filter((s) => s.complete).length;
  const score = Math.round((completeCount / sections.length) * 100);
  const missingSections = sections.filter((s) => !s.complete).map((s) => s.section);

  return { score, sections, missingSections };
}
