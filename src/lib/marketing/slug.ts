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
 * Generates a public slug for a new MarketingLandingPage, appending a short
 * random suffix on collision until a free one is found — same pattern as
 * src/lib/listings/slug.ts's generateUniqueListingSlug, adapted to
 * marketingLandingPage's own global (not per-city) uniqueness.
 */
export async function generateUniqueLandingPageSlug(
  prisma: Pick<PrismaClient, "marketingLandingPage">,
  title: string,
): Promise<string> {
  const base = slugify(title);

  const existing = await prisma.marketingLandingPage.findUnique({ where: { slug: base } });
  if (!existing) return base;

  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${base}-${randomSuffix()}`;
    const collision = await prisma.marketingLandingPage.findUnique({ where: { slug: candidate } });
    if (!collision) return candidate;
  }

  return `${base}-${Date.now().toString(36)}`;
}
