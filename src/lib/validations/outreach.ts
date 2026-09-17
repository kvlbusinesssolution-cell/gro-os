import { z } from "zod";

const requiredEmail = z.string().trim().toLowerCase().email("Enter a valid email address.");

// Exported so other real recipient-address inputs (e.g. Compose's Cc/Bcc,
// src/app/dashboard/outreach/_lib/compose-actions.ts) reuse the exact same
// validation instead of inventing a second email regex.
export const emailAddressSchema = requiredEmail;

export const contactStatusSchema = z.enum(["NEW", "CONTACTED", "REPLIED", "INTERESTED", "NOT_INTERESTED", "MEETING_BOOKED", "UNSUBSCRIBED"]);
export type ContactStatusInput = z.infer<typeof contactStatusSchema>;

const optionalUrl = z.string().trim().url("Enter a valid URL.").optional().or(z.literal(""));

export const contactSchema = z.object({
  firstName: z.string().trim().min(1, "Give the contact a first name."),
  lastName: z.string().trim().max(100).optional().or(z.literal("")),
  email: requiredEmail,
  jobTitle: z.string().trim().max(150).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  country: z.string().trim().max(100).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  companyId: z.string().trim().optional().or(z.literal("")),
  tags: z.array(z.string().trim().min(1)).max(20).default([]),
  status: contactStatusSchema.default("NEW"),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  // ===== CRM Contact Management fields (additive to the Outreach fields above) =====
  linkedin: optionalUrl,
  department: z.string().trim().max(120).optional().or(z.literal("")),
  relationshipScore: z.coerce.number().int().min(0).max(100).optional(),
});

export type ContactInput = z.input<typeof contactSchema>;

export const campaignTypeSchema = z.enum(["STANDARD", "INDUSTRY", "COUNTRY", "CUSTOM", "TAG_BASED"]);
export const approvalModeSchema = z.enum(["MANUAL", "SEMI_AUTOMATIC", "AUTOMATIC"]);

export const campaignSchema = z.object({
  name: z.string().trim().min(1, "Give the campaign a name."),
  type: campaignTypeSchema.default("STANDARD"),
  targetIndustry: z.string().trim().max(120).optional().or(z.literal("")),
  targetCountry: z.string().trim().max(100).optional().or(z.literal("")),
  targetCompanySize: z.string().trim().max(50).optional().or(z.literal("")),
  goal: z.string().trim().max(2000).optional().or(z.literal("")),
  approvalMode: approvalModeSchema.default("MANUAL"),
});

export type CampaignInput = z.input<typeof campaignSchema>;

export const draftChannelSchema = z.enum(["EMAIL", "LINKEDIN"]);
export const emailToneSchema = z.enum(["PROFESSIONAL", "ENTERPRISE", "FRIENDLY", "FORMAL", "CONSULTATIVE"]);
export const draftPurposeSchema = z.enum([
  "INTRODUCTION",
  "FOLLOW_UP",
  "MEETING_REQUEST",
  "PRODUCT_INTRODUCTION",
  "PROPOSAL_REQUEST",
  "CASE_STUDY",
  "THANK_YOU",
  "REMINDER",
  "RE_ENGAGEMENT",
  "CONNECTION_REQUEST",
  "CONVERSATION_SUMMARY",
]);

export const sequenceStepSchema = z.object({
  order: z.number().int().nonnegative(),
  type: z.enum(["EMAIL", "WAIT", "LINKEDIN", "REMINDER", "MEETING_REQUEST"]),
  delayDays: z.number().int().nonnegative().default(0),
  purpose: draftPurposeSchema.optional(),
  tone: emailToneSchema.optional(),
});
export type SequenceStepInput = z.input<typeof sequenceStepSchema>;

export const sequenceSchema = z.object({
  name: z.string().trim().min(1, "Give the sequence a name."),
  campaignId: z.string().trim().optional().or(z.literal("")),
  steps: z.array(sequenceStepSchema).min(1, "A sequence needs at least one step."),
});
export type SequenceInput = z.input<typeof sequenceSchema>;
