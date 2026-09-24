import { notFound } from "next/navigation";

import { Container } from "@/components/ui/container";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { ReviewModerationRow } from "../../_components/review-moderation-row";

export default async function ListingReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/business-growth/${id}/reviews`);

  const listing = await prisma.businessListing.findUnique({ where: { id }, include: { reviews: { orderBy: { createdAt: "desc" } } } });
  if (!listing || listing.organizationId !== membership.organizationId) notFound();

  const pending = listing.reviews.filter((r) => r.status === "PENDING");
  const decided = listing.reviews.filter((r) => r.status !== "PENDING");

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reviews — {listing.businessName}</h1>
          <p className="text-sm text-muted-foreground">
            {listing.averageRating.toFixed(1)} average · {listing.reviewCount} approved reviews
          </p>
        </div>

        {pending.length > 0 && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">Awaiting moderation</h2>
            {pending.map((review) => (
              <ReviewModerationRow key={review.id} review={review} />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Decided</h2>
          {decided.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet.</p>}
          {decided.map((review) => (
            <ReviewModerationRow key={review.id} review={review} />
          ))}
        </div>
      </Container>
    </main>
  );
}
