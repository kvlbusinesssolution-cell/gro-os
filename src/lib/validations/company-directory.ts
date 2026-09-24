import { z } from "zod";

import { optionalUrlOrInternalPath } from "./shared";

const optionalUrl = z.string().trim().url("Enter a valid URL.").optional().or(z.literal(""));
const optionalEmail = z.string().trim().toLowerCase().email("Enter a valid email address.").optional().or(z.literal(""));

export const companyStatusSchema = z.enum(["PROSPECT", "LEAD", "CLIENT", "CHURNED"]);
export type CompanyStatusInput = z.infer<typeof companyStatusSchema>;

export const companySchema = z.object({
  name: z.string().trim().min(1, "Give the company a name."),
  industry: z.string().trim().max(120).optional().or(z.literal("")),
  website: optionalUrl,
  email: optionalEmail,
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  employeeCount: z.coerce.number().int().nonnegative("Employee count can't be negative.").optional(),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  status: companyStatusSchema.default("PROSPECT"),

  // ===== Company Intelligence profile fields =====
  logo: optionalUrlOrInternalPath,
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  headquartersCountry: z.string().trim().max(100).optional().or(z.literal("")),
  headquartersState: z.string().trim().max(100).optional().or(z.literal("")),
  headquartersCity: z.string().trim().max(100).optional().or(z.literal("")),
  estimatedRevenue: z.coerce.number().nonnegative().optional(),
  foundedYear: z.coerce.number().int().min(1800).max(2100).optional(),
  technologies: z.array(z.string().trim().min(1)).max(30).default([]),
  products: z.array(z.string().trim().min(1)).max(30).default([]),
  servicesOffered: z.array(z.string().trim().min(1)).max(30).default([]),
  targetCustomers: z.string().trim().max(2000).optional().or(z.literal("")),
  linkedinUrl: optionalUrl,
  facebookUrl: optionalUrl,
  twitterUrl: optionalUrl,
  instagramUrl: optionalUrl,
  googleMapsUrl: optionalUrl,
  contactFormUrl: optionalUrl,
  businessType: z.string().trim().max(50).optional().or(z.literal("")),
  remoteHybrid: z.string().trim().max(50).optional().or(z.literal("")),
  publicPrivate: z.string().trim().max(50).optional().or(z.literal("")),
  growthRate: z.coerce.number().optional(),
  fundingStage: z.string().trim().max(100).optional().or(z.literal("")),
  fundingAmount: z.coerce.number().nonnegative().optional(),
  fundingDate: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.date().optional()),
  language: z.string().trim().max(50).optional().or(z.literal("")),

  // Attribution — which ReferralPartner (if any) referred this company in.
  // Cross-org ownership is NOT validated here (this schema has no org
  // context) — createCompany/updateCompany re-check it against the real
  // ReferralPartner row before persisting. See actions.ts.
  referralPartnerId: z.string().trim().optional().or(z.literal("")),
});

export type CompanyInput = z.input<typeof companySchema>;

export const clientStatusSchema = z.enum(["ACTIVE", "INACTIVE", "CHURNED"]);
export type ClientStatusInput = z.infer<typeof clientStatusSchema>;

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Give the client a name."),
  companyId: z.string().trim().optional().or(z.literal("")),
  email: optionalEmail,
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  status: clientStatusSchema.default("ACTIVE"),
  contractValue: z.coerce.number().nonnegative("Contract value can't be negative.").optional(),
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
});

export type ClientInput = z.infer<typeof clientSchema>;
