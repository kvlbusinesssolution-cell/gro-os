import { z } from "zod";

// ===== Business hours =====

const dayHoursSchema = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm."),
  close: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm."),
  closed: z.boolean(),
});

export const businessHoursSchema = z.object({
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
  sun: dayHoursSchema,
});

// ===== Business Listing =====

export const businessListingInputSchema = z.object({
  businessName: z.string().trim().min(1, "Give the business a name.").max(200),
  tagline: z.string().trim().max(200).optional().or(z.literal("")),
  description: z.string().trim().max(5000).optional().or(z.literal("")),
  category: z.string().trim().min(1, "Pick a category.").max(100),
  categories: z.array(z.string().trim().min(1).max(100)).max(10).optional(),

  addressLine1: z.string().trim().min(1, "Enter the street address.").max(300),
  addressLine2: z.string().trim().max(300).optional().or(z.literal("")),
  city: z.string().trim().min(1, "Enter the city.").max(120),
  state: z.string().trim().max(120).optional().or(z.literal("")),
  postalCode: z.string().trim().max(20).optional().or(z.literal("")),
  country: z.string().trim().min(1, "Enter the country.").max(120),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),

  phone: z.string().trim().max(30).optional().or(z.literal("")),
  whatsappNumber: z.string().trim().max(30).optional().or(z.literal("")),
  contactEmail: z.string().trim().email("Enter a valid email.").max(200).optional().or(z.literal("")),
  website: z.string().trim().url("Enter a valid URL.").max(300).optional().or(z.literal("")),
  priceRange: z.string().trim().max(20).optional().or(z.literal("")),
  openingHours: businessHoursSchema.optional(),
  videoUrl: z.string().trim().url("Enter a valid video URL.").max(500).optional().or(z.literal("")),

  metaTitle: z.string().trim().max(70).optional().or(z.literal("")),
  metaDescription: z.string().trim().max(160).optional().or(z.literal("")),
});
export type BusinessListingInput = z.infer<typeof businessListingInputSchema>;

// ===== Business Deal =====

export const businessDealInputSchema = z.object({
  title: z.string().trim().min(1, "Give the deal a title.").max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  discountLabel: z.string().trim().max(60).optional().or(z.literal("")),
  termsAndConditions: z.string().trim().max(2000).optional().or(z.literal("")),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});
export type BusinessDealInput = z.infer<typeof businessDealInputSchema>;

// ===== Public review submission =====

export const submitReviewSchema = z.object({
  reviewerName: z.string().trim().min(1, "Enter your name.").max(120),
  reviewerEmail: z.string().trim().email("Enter a valid email.").max(200).optional().or(z.literal("")),
  rating: z.coerce.number().int().min(1, "Pick a rating.").max(5),
  title: z.string().trim().max(150).optional().or(z.literal("")),
  body: z.string().trim().max(3000).optional().or(z.literal("")),
  // Honeypot — a real visitor never fills this in; a value here means bot traffic.
  companyWebsite: z.string().max(0, "").optional().or(z.literal("")),
});
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;

// ===== Public lead capture =====

export const captureLeadSchema = z.object({
  type: z.enum(["CALL_CLICK", "WHATSAPP_CLICK", "ENQUIRY_FORM"]),
  dealId: z.string().trim().optional().or(z.literal("")),
  name: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email.").max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  companyWebsite: z.string().max(0, "").optional().or(z.literal("")),
});
export type CaptureLeadInput = z.infer<typeof captureLeadSchema>;

// ===== Public "Get Quotes" — one message fanned out to matching businesses =====

export const requestQuotesSchema = z.object({
  category: z.string().trim().min(1, "Pick a category.").max(100),
  city: z.string().trim().min(1, "Pick a city.").max(120),
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().email("Enter a valid email.").max(200).optional().or(z.literal("")),
  phone: z.string().trim().min(1, "Enter a phone number.").max(30),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  companyWebsite: z.string().max(0, "").optional().or(z.literal("")),
});
export type RequestQuotesInput = z.infer<typeof requestQuotesSchema>;

// ===== Catalog item (products/services price list) =====

export const businessCatalogItemInputSchema = z.object({
  name: z.string().trim().min(1, "Give the item a name.").max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  price: z.coerce.number().min(0, "Price can't be negative.").max(10_000_000).optional(),
  priceUnit: z.string().trim().max(40).optional().or(z.literal("")),
});
export type BusinessCatalogItemInput = z.infer<typeof businessCatalogItemInputSchema>;

// ===== Public listing report (abuse/accuracy) =====

export const reportListingSchema = z.object({
  reason: z.enum(["INCORRECT_INFO", "PERMANENTLY_CLOSED", "SPAM_OR_SCAM", "INAPPROPRIATE_CONTENT", "DUPLICATE", "OTHER"]),
  details: z.string().trim().max(2000).optional().or(z.literal("")),
  reporterEmail: z.string().trim().email("Enter a valid email.").max(200).optional().or(z.literal("")),
  companyWebsite: z.string().max(0, "").optional().or(z.literal("")),
});
export type ReportListingInput = z.infer<typeof reportListingSchema>;
