import { z } from "zod";

import { PartnerType } from "@/generated/prisma/enums";

const optionalUrl = z.string().trim().url("Enter a valid URL.").optional().or(z.literal(""));
const optionalEmail = z.string().trim().toLowerCase().email("Enter a valid email address.").optional().or(z.literal(""));

/**
 * Validates the manual "Add Partner" form (referral-partners/_components/add-partner-dialog.tsx)
 * and its createReferralPartner(Core) server action. Same shape/convention as
 * companySchema in company-directory.ts — trimmed strings, `.optional().or(z.literal(""))`
 * for blank-but-present fields, z.coerce for numeric inputs coming off an <input>.
 */
export const createReferralPartnerSchema = z.object({
  name: z.string().trim().min(1, "Give the partner a name."),
  type: z.nativeEnum(PartnerType).optional(),
  email: optionalEmail,
  website: optionalUrl,
  notes: z.string().trim().max(4000).optional().or(z.literal("")),
  commissionRatePercent: z.coerce.number().min(0, "Commission rate can't be negative.").max(100, "Commission rate can't exceed 100%.").optional(),
});

export type CreateReferralPartnerInput = z.input<typeof createReferralPartnerSchema>;
