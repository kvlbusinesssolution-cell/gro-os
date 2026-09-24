import { z } from "zod";

// ===== Landing page content blocks =====
// A structured block list, never free-form HTML — no XSS surface, no
// WYSIWYG dependency, matches this codebase's lean-dependency style.

const paragraphBlockSchema = z.object({ type: z.literal("paragraph"), content: z.string().trim().min(1).max(3000) });
const imageBlockSchema = z.object({
  type: z.literal("image"),
  url: z.string().trim().url().max(500),
  alt: z.string().trim().max(200).optional().or(z.literal("")),
});
const testimonialBlockSchema = z.object({
  type: z.literal("testimonial"),
  quote: z.string().trim().min(1).max(1000),
  author: z.string().trim().min(1).max(200),
});
const bulletsBlockSchema = z.object({
  type: z.literal("bullets"),
  items: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
});

export const landingPageBlockSchema = z.discriminatedUnion("type", [
  paragraphBlockSchema,
  imageBlockSchema,
  testimonialBlockSchema,
  bulletsBlockSchema,
]);
export type LandingPageBlock = z.infer<typeof landingPageBlockSchema>;

// ===== Embedded lead-capture form =====

// `role` is how submitLandingPageLead (public-actions.ts) maps an
// arbitrarily-labeled form field back onto Contact's own required
// firstName/email columns, regardless of what the marketer named/labeled
// the field — never guessed from the field's key/label text.
export const landingPageFormFieldSchema = z.object({
  key: z.string().trim().min(1).max(60).regex(/^[a-zA-Z0-9_]+$/, "Field key: letters, numbers, underscore only."),
  label: z.string().trim().min(1, "Give the field a label.").max(120),
  type: z.enum(["text", "email", "phone", "textarea"]),
  required: z.boolean(),
  role: z.enum(["name", "email", "phone", "other"]).default("other"),
});
export type LandingPageFormField = z.infer<typeof landingPageFormFieldSchema>;

// ===== Landing page (dashboard editor input) =====

export const marketingLandingPageInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the page a title.").max(200),
    headline: z.string().trim().min(1, "Add a headline.").max(200),
    subheadline: z.string().trim().max(300).optional().or(z.literal("")),
    heroImageUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
    bodyBlocks: z.array(landingPageBlockSchema).max(30).default([]),
    formFields: z.array(landingPageFormFieldSchema).min(1, "Add at least one form field.").max(15),
    metaTitle: z.string().trim().max(200).optional().or(z.literal("")),
    metaDescription: z.string().trim().max(300).optional().or(z.literal("")),
  })
  // A submitted lead becomes a real Contact (firstName + email are both
  // required on that model) — so the form must have exactly one required
  // "name" field and exactly one required "email" field for
  // submitLandingPageLead to ever have something real to create one from.
  .refine((data) => data.formFields.filter((f) => f.role === "name" && f.required).length === 1, {
    message: "Add exactly one required field with role \"name\".",
    path: ["formFields"],
  })
  .refine((data) => data.formFields.filter((f) => f.role === "email" && f.required).length === 1, {
    message: "Add exactly one required field with role \"email\".",
    path: ["formFields"],
  });
export type MarketingLandingPageInput = z.infer<typeof marketingLandingPageInputSchema>;

// ===== Public form submission =====
// `fields` is keyed by each form field's own `key` — validated generically
// here (max length per value); required-field/type-specific checks happen
// in the action itself against the page's own real formFields definition,
// since that definition is per-page, not knowable at this schema's
// compile time.

export const landingPageLeadSubmissionSchema = z.object({
  fields: z.record(z.string(), z.string().trim().max(2000)),
  companyWebsite: z.string().max(0, "").optional().or(z.literal("")), // honeypot — a real visitor never sees or fills this field
});
export type LandingPageLeadSubmissionInput = z.infer<typeof landingPageLeadSubmissionSchema>;
