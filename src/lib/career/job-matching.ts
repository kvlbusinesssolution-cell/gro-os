/**
 * Phase 19 (AI Job Discovery + Job Matching Engine) — the real, deterministic
 * matching core (§16-30). Every dimension is computed from real, structured
 * inputs — never an AI-invented score. This module has NO network/AI
 * dependency at all, by design: fully unit-testable against fixed inputs,
 * matching the spec's own worked examples (§49) exactly.
 *
 * Documented overall-score weighting (must stay in sync with this comment
 * if ever changed):
 *   skill 25% · experience 15% · role 15% · location 15% · technology 10%
 *   · preference 10% · industry 5% · careerLevel 5%
 * Salary is NOT weighted into overallScore (§23 — too often UNKNOWN/
 * unreliable to blend into a single number); it is reported as its own
 * explicit dimension instead. A dimension that is UNKNOWN contributes ZERO
 * to the score and is excluded from the weight total (renormalized across
 * only the dimensions that actually have evidence) — UNKNOWN is never
 * silently treated as a pass (§17, §33).
 */

export type MatchDimensionStatus = "MATCHED" | "PARTIAL" | "MISSING" | "MISMATCH" | "CONFLICT" | "UNKNOWN";

export interface MatchDimension {
  status: MatchDimensionStatus;
  evidence: string[];
}

export interface JobMatchInput {
  // ===== Career profile (real, user-verified fields only) =====
  verifiedSkills: string[]; // normalized skill names the user has confirmed
  targetRoles: string[];
  currentRole: string | null;
  yearsOfExperience: number | null;
  industries: string[];
  targetCountries: string[];
  targetCities: string[];
  workMode: "REMOTE" | "HYBRID" | "ONSITE" | "ANY" | null;
  relocationPreference: "WILLING" | "UNWILLING" | "CONDITIONAL" | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  preferredTechnologies: string[];
  excludedTechnologies: string[];
  preferredCompanies: string[];
  excludedCompanies: string[];
  careerLevel: string | null;

  // ===== Job (real, canonical fields only) =====
  job: {
    company: string;
    title: string;
    location: string | null;
    country: string | null;
    city: string | null;
    workMode: "REMOTE" | "HYBRID" | "ONSITE" | "ANY" | null;
    technologies: string[];
    industry: string | null;
    careerLevel: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
    experienceMinYears: number | null;
    experienceMaxYears: number | null;
    // { required: string[], preferred: string[] } — real, source-extracted only.
    requiredTechnologies: string[];
    preferredTechnologiesFromJob: string[];
  };
}

export interface JobMatchResult {
  overallScore: number;
  dimensions: {
    skill: MatchDimension;
    experience: MatchDimension;
    role: MatchDimension;
    industry: MatchDimension;
    location: MatchDimension;
    salary: MatchDimension;
    technology: MatchDimension;
    careerLevel: MatchDimension;
    preference: MatchDimension;
  };
  eligibility: "LIKELY_ELIGIBLE" | "POSSIBLE" | "REVIEW_REQUIRED" | "LIKELY_NOT_ELIGIBLE" | "UNKNOWN";
  explanation: {
    whyMatched: string[];
    whatIsMissing: string[];
    whatIsRisky: string[];
    whatShouldBeCustomized: string[];
  };
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function normSet(arr: string[]): Set<string> {
  return new Set(arr.map(normalize).filter(Boolean));
}

/** §18 skill match — MATCHED/PARTIAL/MISSING against real required job technologies, never a proficiency-level claim. */
function matchSkills(input: JobMatchInput): MatchDimension {
  const required = input.job.requiredTechnologies;
  if (required.length === 0) return { status: "UNKNOWN", evidence: ["Job description did not state required skills."] };

  const verified = normSet(input.verifiedSkills);
  const matched = required.filter((r) => verified.has(normalize(r)));
  const missing = required.filter((r) => !verified.has(normalize(r)));

  const evidence = [
    ...matched.map((s) => `${s} — verified in your profile`),
    ...missing.map((s) => `${s} — not found in your verified skills`),
  ];

  if (missing.length === 0) return { status: "MATCHED", evidence };
  if (matched.length === 0) return { status: "MISSING", evidence };
  return { status: "PARTIAL", evidence };
}

/** §19 experience match — real range comparison, never a rounded-up "close enough" pass. */
function matchExperience(input: JobMatchInput): MatchDimension {
  const { experienceMinYears, experienceMaxYears } = input.job;
  if (experienceMinYears == null && experienceMaxYears == null) {
    return { status: "UNKNOWN", evidence: ["Job did not state required years of experience."] };
  }
  if (input.yearsOfExperience == null) {
    return { status: "UNKNOWN", evidence: ["Your profile has no verified years of experience."] };
  }
  const required = experienceMinYears ?? 0;
  const evidence = [`Job requires ${experienceMinYears ?? "?"}${experienceMaxYears ? `-${experienceMaxYears}` : "+"} years; your profile shows ${input.yearsOfExperience}.`];
  if (input.yearsOfExperience >= required) return { status: "MATCHED", evidence };
  if (input.yearsOfExperience >= required - 1) return { status: "PARTIAL", evidence }; // real, small, disclosed gap
  return { status: "MISSING", evidence };
}

/** §20 role match — real token-overlap between target roles and the job title, distinguishable AI inference is layered on top by the caller, not here. */
function matchRole(input: JobMatchInput): MatchDimension {
  if (input.targetRoles.length === 0) return { status: "UNKNOWN", evidence: ["No target roles configured in your profile."] };
  const jobTitleTokens = normalize(input.job.title).split(/\s+/).filter((t) => t.length > 2);
  let bestOverlap = 0;
  let bestRole = "";
  for (const role of input.targetRoles) {
    const roleTokens = new Set(normalize(role).split(/\s+/).filter((t) => t.length > 2));
    const overlap = jobTitleTokens.filter((t) => roleTokens.has(t)).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestRole = role;
    }
  }
  const evidence = [`Job title "${input.job.title}" vs. your target role "${bestRole || input.targetRoles[0]}".`];
  if (bestOverlap === 0) return { status: "MISSING", evidence };
  if (bestOverlap === 1) return { status: "PARTIAL", evidence };
  return { status: "MATCHED", evidence };
}

/** §21 industry match. */
function matchIndustry(input: JobMatchInput): MatchDimension {
  if (!input.job.industry) return { status: "UNKNOWN", evidence: ["Job source did not state an industry."] };
  if (input.industries.length === 0) return { status: "UNKNOWN", evidence: ["No target industries configured in your profile."] };
  const matched = input.industries.some((i) => normalize(i) === normalize(input.job.industry!));
  return {
    status: matched ? "MATCHED" : "MISSING",
    evidence: [`Job industry "${input.job.industry}" vs. your target industries: ${input.industries.join(", ")}.`],
  };
}

/** §22 location match — excluded companies aside, explicit exclusions/relocation are real hard signals, never inferred. */
function matchLocation(input: JobMatchInput): MatchDimension {
  if (input.job.workMode === "REMOTE" && (input.workMode === "REMOTE" || input.workMode === "ANY" || input.workMode == null)) {
    return { status: "MATCHED", evidence: ["Job is remote; your work-mode preference accepts remote."] };
  }
  if (!input.job.country && !input.job.city) {
    return { status: "UNKNOWN", evidence: ["Job did not state a location."] };
  }
  const countryMatch = input.job.country && input.targetCountries.some((c) => normalize(c) === normalize(input.job.country!));
  const cityMatch = input.job.city && input.targetCities.some((c) => normalize(c) === normalize(input.job.city!));
  if (countryMatch || cityMatch) {
    return { status: "MATCHED", evidence: [`Job location (${input.job.city ?? ""} ${input.job.country ?? ""}).trim() matches your target geography.`] };
  }
  if (input.relocationPreference === "WILLING") {
    return { status: "PARTIAL", evidence: [`Job location is outside your target geography, but you're willing to relocate.`] };
  }
  return { status: "MISMATCH", evidence: [`Job location (${input.job.city ?? ""} ${input.job.country ?? ""}).trim() is outside your target geography and you have not indicated willingness to relocate.`] };
}

/** §23 salary match — only ever evaluated with real numbers on both sides; currency mismatch is honestly UNKNOWN, never converted with an unverified rate. */
function matchSalary(input: JobMatchInput): MatchDimension {
  if (input.job.salaryMin == null && input.job.salaryMax == null) {
    return { status: "UNKNOWN", evidence: ["Job did not disclose a salary."] };
  }
  if (input.salaryMin == null && input.salaryMax == null) {
    return { status: "UNKNOWN", evidence: ["No salary preference configured in your profile."] };
  }
  if (input.salaryCurrency && input.job.salaryCurrency && normalize(input.salaryCurrency) !== normalize(input.job.salaryCurrency)) {
    return { status: "UNKNOWN", evidence: [`Currency mismatch (job: ${input.job.salaryCurrency}, preference: ${input.salaryCurrency}) — not converted without a verified exchange rate.`] };
  }
  const jobMax = input.job.salaryMax ?? input.job.salaryMin!;
  const jobMin = input.job.salaryMin ?? input.job.salaryMax!;
  const prefMin = input.salaryMin ?? 0;
  const prefMax = input.salaryMax ?? Infinity;
  const overlaps = jobMax >= prefMin && jobMin <= prefMax;
  return {
    status: overlaps ? "MATCHED" : "MISMATCH",
    evidence: [`Job salary ${jobMin}-${jobMax} ${input.job.salaryCurrency ?? ""} vs. your preference ${input.salaryMin ?? "?"}-${input.salaryMax ?? "?"} ${input.salaryCurrency ?? ""}.`],
  };
}

/** §24 technology match — excluded technologies are a real CONFLICT, never silently ignored. */
function matchTechnology(input: JobMatchInput): MatchDimension {
  const jobTech = normSet(input.job.technologies);
  const excluded = normSet(input.excludedTechnologies);
  const conflicting = input.job.technologies.filter((t) => excluded.has(normalize(t)));
  if (conflicting.length > 0) {
    return { status: "CONFLICT", evidence: [`Job uses excluded technologies: ${conflicting.join(", ")}.`] };
  }
  if (jobTech.size === 0) return { status: "UNKNOWN", evidence: ["Job did not list technologies."] };
  const preferred = normSet(input.preferredTechnologies);
  const overlap = input.job.technologies.filter((t) => preferred.has(normalize(t)));
  if (preferred.size === 0) return { status: "UNKNOWN", evidence: ["No preferred technologies configured in your profile."] };
  if (overlap.length === 0) return { status: "MISSING", evidence: [`Job technologies (${input.job.technologies.join(", ")}) don't overlap your preferences.`] };
  if (overlap.length === preferred.size) return { status: "MATCHED", evidence: [`Job matches all your preferred technologies: ${overlap.join(", ")}.`] };
  return { status: "PARTIAL", evidence: [`Job matches some preferred technologies: ${overlap.join(", ")}.`] };
}

/** §25 career level match. */
function matchCareerLevel(input: JobMatchInput): MatchDimension {
  if (!input.job.careerLevel) return { status: "UNKNOWN", evidence: ["Job did not state a seniority/career level."] };
  if (!input.careerLevel) return { status: "UNKNOWN", evidence: ["No career level set in your profile."] };
  const matched = normalize(input.job.careerLevel) === normalize(input.careerLevel);
  return { status: matched ? "MATCHED" : "PARTIAL", evidence: [`Job level "${input.job.careerLevel}" vs. your profile level "${input.careerLevel}".`] };
}

/** §26 preference match — excluded company is an explicit, real, hard negative that nothing else may override. */
function matchPreference(input: JobMatchInput): MatchDimension {
  const excludedCompanies = normSet(input.excludedCompanies);
  if (excludedCompanies.has(normalize(input.job.company))) {
    return { status: "MISMATCH", evidence: [`${input.job.company} is on your excluded-companies list.`] };
  }
  const preferredCompanies = normSet(input.preferredCompanies);
  if (preferredCompanies.has(normalize(input.job.company))) {
    return { status: "MATCHED", evidence: [`${input.job.company} is on your preferred-companies list.`] };
  }
  return { status: "UNKNOWN", evidence: [`${input.job.company} is neither preferred nor excluded.`] };
}

const WEIGHTS: Record<Exclude<keyof JobMatchResult["dimensions"], "salary">, number> = {
  skill: 25,
  experience: 15,
  role: 15,
  location: 15,
  technology: 10,
  preference: 10,
  industry: 5,
  careerLevel: 5,
};

function dimensionScore(status: MatchDimensionStatus): number | null {
  switch (status) {
    case "MATCHED":
      return 100;
    case "PARTIAL":
      return 50;
    case "MISSING":
    case "MISMATCH":
    case "CONFLICT":
      return 0;
    case "UNKNOWN":
      return null; // excluded from weighted average entirely — never treated as a pass
  }
}

function computeEligibility(dims: JobMatchResult["dimensions"]): JobMatchResult["eligibility"] {
  if (dims.preference.status === "MISMATCH" || dims.technology.status === "CONFLICT") return "LIKELY_NOT_ELIGIBLE";
  if (dims.skill.status === "UNKNOWN" || dims.experience.status === "UNKNOWN") return "REVIEW_REQUIRED";
  if (dims.skill.status === "MISSING" || dims.experience.status === "MISSING" || dims.location.status === "MISMATCH") return "LIKELY_NOT_ELIGIBLE";
  // Reaching here already guarantees experience/location aren't MISSING/MISMATCH (excluded above).
  if (dims.skill.status === "MATCHED") return "LIKELY_ELIGIBLE";
  return "POSSIBLE";
}

export function computeJobMatch(input: JobMatchInput): JobMatchResult {
  const dimensions = {
    skill: matchSkills(input),
    experience: matchExperience(input),
    role: matchRole(input),
    industry: matchIndustry(input),
    location: matchLocation(input),
    salary: matchSalary(input), // not weighted into overallScore — reported separately
    technology: matchTechnology(input),
    careerLevel: matchCareerLevel(input),
    preference: matchPreference(input),
  };

  let weightedSum = 0;
  let weightTotal = 0;
  for (const [key, weight] of Object.entries(WEIGHTS) as Array<[keyof typeof WEIGHTS, number]>) {
    const score = dimensionScore(dimensions[key].status);
    if (score === null) continue; // UNKNOWN excluded, never zero-filled
    weightedSum += score * weight;
    weightTotal += weight;
  }
  const overallScore = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;

  const eligibility = computeEligibility(dimensions);

  const whyMatched = Object.entries(dimensions)
    .filter(([, d]) => d.status === "MATCHED")
    .flatMap(([, d]) => d.evidence);
  const whatIsMissing = Object.entries(dimensions)
    .filter(([, d]) => d.status === "MISSING")
    .flatMap(([, d]) => d.evidence);
  const whatIsRisky = Object.entries(dimensions)
    .filter(([, d]) => d.status === "PARTIAL" || d.status === "CONFLICT" || d.status === "MISMATCH")
    .flatMap(([, d]) => d.evidence);
  const whatShouldBeCustomized =
    dimensions.skill.status === "PARTIAL" || dimensions.technology.status === "PARTIAL"
      ? ["Consider highlighting your experience with the matched skills/technologies above more prominently."]
      : [];

  return {
    overallScore,
    dimensions,
    eligibility,
    explanation: { whyMatched, whatIsMissing, whatIsRisky, whatShouldBeCustomized },
  };
}
