import { z } from "zod";

// Mirrors enum CareerCVTemplate in prisma/schema.prisma.
export const cvTemplateSchema = z.enum(["CLASSIC", "MODERN", "MINIMAL"]);
export type CVTemplate = z.infer<typeof cvTemplateSchema>;

/**
 * Real, verified-renderable language list — deliberately NOT "every
 * language". The bundled embedded font (assets/fonts/cv/NotoSans-*.ttf) was
 * checked for actual glyph coverage AND real rendering correctness (a
 * pdftoppm-rendered test page was visually inspected) before any language
 * was added here: Latin/Latin-Extended script (most of Western/Central/
 * Northern Europe + Vietnamese + Turkish + Indonesian), Cyrillic, Greek, and
 * Devanagari (verified to shape real conjuncts correctly, e.g.
 * "सॉफ्टवेयर"/"इंजीनियर", not just have the glyphs present). Arabic, Hebrew,
 * and CJK scripts are honestly excluded — no embedded font covers them, and
 * Arabic/Hebrew would additionally need right-to-left layout this renderer
 * doesn't implement. Extending this list requires embedding a real font
 * proven to render that script's script correctly, never just adding a code.
 */
export const CV_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "pl", label: "Polish" },
  { code: "cs", label: "Czech" },
  { code: "sk", label: "Slovak" },
  { code: "hu", label: "Hungarian" },
  { code: "ro", label: "Romanian" },
  { code: "hr", label: "Croatian" },
  { code: "tr", label: "Turkish" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "bg", label: "Bulgarian" },
  { code: "sr", label: "Serbian" },
  { code: "el", label: "Greek" },
  { code: "hi", label: "Hindi" },
  { code: "mr", label: "Marathi" },
  { code: "ne", label: "Nepali" },
] as const;

export type CVLanguageCode = (typeof CV_LANGUAGES)[number]["code"];
const CV_LANGUAGE_CODES = CV_LANGUAGES.map((l) => l.code) as [CVLanguageCode, ...CVLanguageCode[]];
export const cvLanguageSchema = z.enum(CV_LANGUAGE_CODES);

export function cvLanguageLabel(code: string): string {
  return CV_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

const linkSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: z.string().trim().url().max(400),
});

const personalInfoSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required.").max(120),
  headline: z.string().trim().max(160).optional().default(""),
  email: z.string().trim().max(200).optional().default(""),
  phone: z.string().trim().max(60).optional().default(""),
  location: z.string().trim().max(160).optional().default(""),
  links: z.array(linkSchema).max(6).default([]),
});

const experienceEntrySchema = z.object({
  company: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(160),
  location: z.string().trim().max(160).optional().default(""),
  startDate: z.string().trim().max(40).optional().default(""),
  endDate: z.string().trim().max(40).optional().default(""),
  current: z.boolean().default(false),
  bullets: z.array(z.string().trim().min(1).max(400)).max(12).default([]),
});

const educationEntrySchema = z.object({
  institution: z.string().trim().min(1).max(160),
  degree: z.string().trim().max(160).optional().default(""),
  field: z.string().trim().max(160).optional().default(""),
  startDate: z.string().trim().max(40).optional().default(""),
  endDate: z.string().trim().max(40).optional().default(""),
  notes: z.string().trim().max(400).optional().default(""),
});

const certificationEntrySchema = z.object({
  name: z.string().trim().min(1).max(200),
  issuer: z.string().trim().max(160).optional().default(""),
  date: z.string().trim().max(40).optional().default(""),
});

const languageSpokenEntrySchema = z.object({
  name: z.string().trim().min(1).max(80),
  proficiency: z.string().trim().max(60).optional().default(""),
});

const projectEntrySchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional().default(""),
  url: z.string().trim().max(400).optional().default(""),
});

export const cvContentSchema = z.object({
  personal: personalInfoSchema,
  summary: z.string().trim().max(1200).optional().default(""),
  experience: z.array(experienceEntrySchema).max(20).default([]),
  education: z.array(educationEntrySchema).max(10).default([]),
  skills: z.array(z.string().trim().min(1).max(60)).max(60).default([]),
  certifications: z.array(certificationEntrySchema).max(20).default([]),
  languagesSpoken: z.array(languageSpokenEntrySchema).max(15).default([]),
  projects: z.array(projectEntrySchema).max(15).default([]),
});
export type CVContent = z.infer<typeof cvContentSchema>;

export const createCVSchema = z.object({
  careerProfileId: z.string().trim().min(1),
  title: z.string().trim().min(1, "Title is required.").max(160),
  language: cvLanguageSchema,
  templateKey: cvTemplateSchema.default("CLASSIC"),
  content: cvContentSchema,
});
export type CreateCVInput = z.infer<typeof createCVSchema>;

export const updateCVSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  language: cvLanguageSchema.optional(),
  templateKey: cvTemplateSchema.optional(),
  content: cvContentSchema.optional(),
});
export type UpdateCVInput = z.infer<typeof updateCVSchema>;

export const translateCVSchema = z.object({
  targetLanguage: cvLanguageSchema,
});
