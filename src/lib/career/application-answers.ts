/**
 * Phase 20 — §12/§13/§38 real application-answer preparation.
 *
 * Deliberately deterministic, no AI call: every supported question maps to
 * a real, structured CareerProfile/CareerResume field. This is SAFER than
 * an AI-generated answer for exactly the kind of factual question this
 * module handles (years of experience, notice period, salary expectation,
 * etc.) — there is no ambiguity for an LLM to usefully resolve, and a
 * deterministic mapping can never hallucinate a number that isn't on file.
 *
 * §13 — sensitive questions (work authorization, sponsorship, disability,
 * veteran status, demographic info, legal/criminal declarations,
 * citizenship, visa status) are classified FIRST, by keyword match, and
 * ALWAYS routed to USER_INPUT_REQUIRED regardless of whether the profile
 * happens to have a matching field — never auto-answered.
 */

export type ApplicationAnswerSource = "USER_VERIFIED" | "RESUME" | "CAREER_PROFILE" | "USER_PREFERENCE" | "JOB_SOURCE" | "USER_INPUT" | "UNKNOWN";
export type ApplicationAnswerStatus = "VERIFIED" | "REVIEW_REQUIRED" | "USER_INPUT_REQUIRED";

export interface PreparedAnswer {
  question: string;
  answer: string | null;
  source: ApplicationAnswerSource;
  status: ApplicationAnswerStatus;
  isSensitive: boolean;
}

export interface AnswerProfileInput {
  yearsOfExperience: number | null;
  currentRole: string | null;
  location: string | null;
  relocationPreference: "WILLING" | "UNWILLING" | "CONDITIONAL" | null;
  noticePeriodDays: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  education: Array<{ degree?: string; institution?: string; graduationYear?: number }>;
  certifications: Array<{ name?: string }>;
  skills: string[];
}

const SENSITIVE_KEYWORDS = [
  "work authorization",
  "authorized to work",
  "sponsorship",
  "visa",
  "citizen",
  "disability",
  "veteran",
  "race",
  "ethnicity",
  "gender identity",
  "sexual orientation",
  "pregnan",
  "criminal",
  "felony",
  "convicted",
  "legal declaration",
  "background check",
];

export function isSensitiveQuestion(question: string): boolean {
  const q = question.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => q.includes(kw));
}

function classify(question: string): { key: string | null } {
  const q = question.toLowerCase();
  if (/years?.{0,15}experience/.test(q)) return { key: "years_experience" };
  if (/notice period/.test(q)) return { key: "notice_period" };
  if (/relocat/.test(q)) return { key: "relocation" };
  if (/salary|compensation/.test(q)) return { key: "salary" };
  if (/current (location|city|country)/.test(q) || /where.{0,15}(based|located)/.test(q)) return { key: "location" };
  if (/current role|current (job )?title/.test(q)) return { key: "current_role" };
  if (/education|degree/.test(q)) return { key: "education" };
  if (/certificat/.test(q)) return { key: "certifications" };
  if (/availab/.test(q)) return { key: "availability" };
  return { key: null };
}

/** §12/§13/§38 — real, provenance-tagged answer preparation. Sensitive questions never reach the answer-generation logic below. */
export function prepareApplicationAnswer(question: string, profile: AnswerProfileInput): PreparedAnswer {
  if (isSensitiveQuestion(question)) {
    return { question, answer: null, source: "UNKNOWN", status: "USER_INPUT_REQUIRED", isSensitive: true };
  }

  const { key } = classify(question);

  switch (key) {
    case "years_experience":
      return profile.yearsOfExperience != null
        ? { question, answer: `${profile.yearsOfExperience} years`, source: "CAREER_PROFILE", status: "VERIFIED", isSensitive: false }
        : { question, answer: null, source: "UNKNOWN", status: "REVIEW_REQUIRED", isSensitive: false };
    case "notice_period":
      return profile.noticePeriodDays != null
        ? { question, answer: `${profile.noticePeriodDays} days`, source: "CAREER_PROFILE", status: "VERIFIED", isSensitive: false }
        : { question, answer: null, source: "UNKNOWN", status: "REVIEW_REQUIRED", isSensitive: false };
    case "relocation":
      return profile.relocationPreference
        ? { question, answer: profile.relocationPreference, source: "USER_PREFERENCE", status: "VERIFIED", isSensitive: false }
        : { question, answer: null, source: "UNKNOWN", status: "REVIEW_REQUIRED", isSensitive: false };
    case "salary":
      return profile.salaryMin != null || profile.salaryMax != null
        ? {
            question,
            answer: `${profile.salaryMin ?? "?"}-${profile.salaryMax ?? "?"} ${profile.salaryCurrency ?? ""}`.trim(),
            source: "USER_PREFERENCE",
            status: "VERIFIED",
            isSensitive: false,
          }
        : { question, answer: null, source: "UNKNOWN", status: "REVIEW_REQUIRED", isSensitive: false };
    case "location":
      return profile.location
        ? { question, answer: profile.location, source: "CAREER_PROFILE", status: "VERIFIED", isSensitive: false }
        : { question, answer: null, source: "UNKNOWN", status: "REVIEW_REQUIRED", isSensitive: false };
    case "current_role":
      return profile.currentRole
        ? { question, answer: profile.currentRole, source: "CAREER_PROFILE", status: "VERIFIED", isSensitive: false }
        : { question, answer: null, source: "UNKNOWN", status: "REVIEW_REQUIRED", isSensitive: false };
    case "education":
      return profile.education.length > 0
        ? { question, answer: profile.education.map((e) => [e.degree, e.institution].filter(Boolean).join(" — ")).join("; "), source: "RESUME", status: "VERIFIED", isSensitive: false }
        : { question, answer: null, source: "UNKNOWN", status: "REVIEW_REQUIRED", isSensitive: false };
    case "certifications":
      return profile.certifications.length > 0
        ? { question, answer: profile.certifications.map((c) => c.name).filter(Boolean).join(", "), source: "RESUME", status: "VERIFIED", isSensitive: false }
        : { question, answer: null, source: "UNKNOWN", status: "REVIEW_REQUIRED", isSensitive: false };
    default:
      // §12/§38 — no confident, real mapping to a verified field. Never
      // guessed via free-text AI generation for a question we can't
      // ground deterministically.
      return { question, answer: null, source: "UNKNOWN", status: "REVIEW_REQUIRED", isSensitive: false };
  }
}
