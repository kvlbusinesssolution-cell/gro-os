import { z } from "zod";

/**
 * Phase 18 (AI Career Agent Foundation) — real input validation for
 * CareerProfile create/update, same Zod-schema-per-form-action convention
 * as every other validations/*.ts file in this app.
 */
export const careerWorkModeSchema = z.enum(["REMOTE", "HYBRID", "ONSITE", "ANY"]);
export const careerEmploymentTypeSchema = z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "FREELANCE", "INTERNSHIP", "TEMPORARY"]);
export const careerRelocationPreferenceSchema = z.enum(["WILLING", "UNWILLING", "CONDITIONAL"]);

export const careerProfileSchema = z.object({
  name: z.string().trim().min(1, "Give this profile a name, e.g. \"Senior React Developer\".").max(120),
  currentRole: z.string().trim().max(150).optional().or(z.literal("")),
  careerLevel: z.string().trim().max(50).optional().or(z.literal("")),
  yearsOfExperience: z.number().min(0).max(60).optional(),
  location: z.string().trim().max(150).optional().or(z.literal("")),
  industries: z.array(z.string().trim().max(80)).max(20).optional(),
  portfolioUrl: z.string().trim().max(300).optional().or(z.literal("")),
  githubUrl: z.string().trim().max(300).optional().or(z.literal("")),
  linkedinUrl: z.string().trim().max(300).optional().or(z.literal("")),
  websiteUrl: z.string().trim().max(300).optional().or(z.literal("")),

  targetRoles: z.array(z.string().trim().max(120)).max(20).optional(),
  targetCountries: z.array(z.string().trim().max(80)).max(30).optional(),
  targetCities: z.array(z.string().trim().max(80)).max(30).optional(),
  workMode: careerWorkModeSchema.optional().or(z.literal("")),
  salaryMin: z.number().min(0).optional(),
  salaryMax: z.number().min(0).optional(),
  salaryCurrency: z.string().trim().max(10).optional().or(z.literal("")),
  employmentTypes: z.array(careerEmploymentTypeSchema).max(6).optional(),
  experienceLevelMinYears: z.number().min(0).max(60).optional(),
  experienceLevelMaxYears: z.number().min(0).max(60).optional(),
  preferredTechnologies: z.array(z.string().trim().max(60)).max(30).optional(),
  excludedTechnologies: z.array(z.string().trim().max(60)).max(30).optional(),
  preferredCompanies: z.array(z.string().trim().max(150)).max(30).optional(),
  excludedCompanies: z.array(z.string().trim().max(150)).max(30).optional(),
  relocationPreference: careerRelocationPreferenceSchema.optional().or(z.literal("")),
  noticePeriodDays: z.number().min(0).max(365).optional(),
});
export type CareerProfileInput = z.input<typeof careerProfileSchema>;

/**
 * Phase 19 (AI Job Discovery + Job Matching Engine) — real discovery
 * config validation.
 */
export const careerJobDiscoveryConfigSchema = z.object({
  discoveryEnabled: z.boolean(),
  discoveryFrequency: z.enum(["MANUAL_ONLY", "DAILY", "WEEKLY"]),
  minMatchThreshold: z.number().min(0).max(100),
});
export type CareerJobDiscoveryConfigInput = z.input<typeof careerJobDiscoveryConfigSchema>;

/**
 * Phase 20 (Autonomous AI Job Application Agent) — real automation-policy
 * validation for the 5 genuinely new fields kept on CareerProfile (§24).
 */
export const applicationPolicySchema = z.object({
  applicationAutomationMode: z.enum(["DISCOVERY_ONLY", "AI_PREPARE", "APPLY_WITH_APPROVAL", "AUTO_APPLY_APPROVED", "FULL_AUTONOMOUS"]),
  applicationRequireApproval: z.boolean(),
  maxApplicationsPerDay: z.number().int().min(1).max(100),
  maxApplicationsPerWeek: z.number().int().min(1).max(500),
  minEligibilityForAutoApply: z.enum(["ELIGIBLE", "LIKELY_ELIGIBLE", "REVIEW_REQUIRED", "LIKELY_NOT_ELIGIBLE", "NOT_ELIGIBLE", "UNKNOWN"]),
});
export type ApplicationPolicyInput = z.input<typeof applicationPolicySchema>;

/**
 * Phase 21 (Recruiter Communication + Interview Automation) — real
 * scheduling/follow-up policy validation for the 7 genuinely new fields
 * kept on CareerProfile (§19, §40).
 */
export const careerSchedulingPolicySchema = z.object({
  followUpEnabled: z.boolean(),
  followUpIntervalDays: z.array(z.number().int().min(0).max(120)).max(10),
  workingHoursStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .or(z.literal("")),
  workingHoursEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .or(z.literal("")),
  workingHoursTimezone: z.string().trim().max(60).optional().or(z.literal("")),
  workingDays: z.array(z.number().int().min(0).max(6)).max(7),
  autonomousSchedulingEnabled: z.boolean(),
});
export type CareerSchedulingPolicyInput = z.input<typeof careerSchedulingPolicySchema>;

export const interviewDecisionSchema = z.object({
  decision: z.enum(["ACCEPT", "REJECT", "SUGGEST_ALTERNATIVE", "REQUEST_ANOTHER_SLOT"]),
});
export type InterviewDecisionInput = z.input<typeof interviewDecisionSchema>;

export const manualClassificationSchema = z.object({
  classification: z.enum([
    "INTERVIEW_REQUEST",
    "SCREENING",
    "MORE_INFORMATION",
    "REJECTED",
    "OFFER",
    "SALARY_DISCUSSION",
    "AVAILABILITY_REQUEST",
    "DOCUMENT_REQUEST",
    "FOLLOW_UP",
    "GENERAL_RESPONSE",
    "UNKNOWN",
  ]),
});
export type ManualClassificationInput = z.input<typeof manualClassificationSchema>;
