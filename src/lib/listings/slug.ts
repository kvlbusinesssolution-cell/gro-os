import type { PrismaClient } from "@/generated/prisma/client";
import { slugify } from "@/lib/slug";

function randomSuffix(length = 5): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

/**
 * Generates a public slug for a new BusinessListing, appending a short
 * random suffix on collision until a free one is found. Model-agnostic
 * sibling to src/lib/slug.ts's generateUniqueOrgSlug (which is hardcoded to
 * the Organization model) — collision-checks against `businessListing`
 * instead. Seeds the base slug from businessName + city when a city is
 * given, since two different branches of the same client commonly share a
 * business name and would otherwise collide immediately.
 */
export async function generateUniqueListingSlug(
  prisma: Pick<PrismaClient, "businessListing">,
  businessName: string,
  city?: string | null,
): Promise<string> {
  const base = slugify(city ? `${businessName}-${city}` : businessName);

  const existing = await prisma.businessListing.findUnique({ where: { slug: base } });
  if (!existing) return base;

  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${base}-${randomSuffix()}`;
    const collision = await prisma.businessListing.findUnique({ where: { slug: candidate } });
    if (!collision) return candidate;
  }

  // Extremely unlikely fallback — timestamp guarantees uniqueness.
  return `${base}-${Date.now().toString(36)}`;
}
