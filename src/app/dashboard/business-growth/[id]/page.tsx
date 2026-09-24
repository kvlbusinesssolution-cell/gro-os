import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import { ListingForm } from "../_components/listing-form";
import { PhotoUploader } from "../_components/photo-uploader";
import { PublishListingButton } from "../_components/publish-listing-button";
import { TrustScorePanel } from "../_components/trust-score-panel";
import { ReputationCertificateButton } from "../_components/reputation-certificate-button";

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/business-growth/${id}`);

  const listing = await prisma.businessListing.findUnique({
    where: { id },
    include: { photos: { orderBy: { sortOrder: "asc" } } },
  });
  if (!listing || listing.organizationId !== membership.organizationId) notFound();

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{listing.businessName}</h1>
              <Badge variant={listing.status === "PUBLISHED" ? "default" : "outline"}>{listing.status}</Badge>
            </div>
            {listing.status === "PUBLISHED" && (
              <Link href={`/listings/${listing.slug}`} target="_blank" className="text-sm text-primary hover:underline">
                View public page
              </Link>
            )}
          </div>
          <PublishListingButton listingId={listing.id} status={listing.status} />
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <Link href={`/dashboard/business-growth/${id}/deals`} className="text-primary hover:underline">
            Deals
          </Link>
          <Link href={`/dashboard/business-growth/${id}/catalog`} className="text-primary hover:underline">
            Catalog
          </Link>
          <Link href={`/dashboard/business-growth/${id}/reviews`} className="text-primary hover:underline">
            Reviews
          </Link>
          <Link href={`/dashboard/business-growth/${id}/leads`} className="text-primary hover:underline">
            Leads
          </Link>
          <Link href={`/dashboard/business-growth/${id}/analytics`} className="text-primary hover:underline">
            Analytics
          </Link>
          <Link href={`/dashboard/business-growth/${id}/market`} className="text-primary hover:underline">
            Market Comparison
          </Link>
          <Link href={`/dashboard/business-growth/${id}/advertising`} className="text-primary hover:underline">
            Advertising
          </Link>
          <Link href={`/dashboard/business-growth/${id}/website`} className="text-primary hover:underline">
            AI Website
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <ReputationCertificateButton listingId={listing.id} hasReviews={listing.reviewCount > 0} />
        </div>

        <TrustScorePanel
          listing={{
            isVerified: listing.isVerified,
            averageRating: listing.averageRating,
            reviewCount: listing.reviewCount,
            description: listing.description,
            photoCount: listing.photos.length,
            phone: listing.phone,
            whatsappNumber: listing.whatsappNumber,
            website: listing.website,
            openingHours: listing.openingHours,
          }}
        />

        <Card>
          <CardHeader>
            <CardTitle>Photos</CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoUploader listingId={listing.id} photos={listing.photos} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <ListingForm
              listingId={listing.id}
              initial={{
                businessName: listing.businessName,
                tagline: listing.tagline ?? "",
                description: listing.description ?? "",
                category: listing.category,
                addressLine1: listing.addressLine1,
                addressLine2: listing.addressLine2 ?? "",
                city: listing.city,
                state: listing.state ?? "",
                postalCode: listing.postalCode ?? "",
                country: listing.country,
                phone: listing.phone ?? "",
                whatsappNumber: listing.whatsappNumber ?? "",
                contactEmail: listing.contactEmail ?? "",
                website: listing.website ?? "",
                priceRange: listing.priceRange ?? "",
                latitude: listing.latitude ?? undefined,
                longitude: listing.longitude ?? undefined,
                videoUrl: listing.videoUrl ?? "",
                metaTitle: listing.metaTitle ?? "",
                metaDescription: listing.metaDescription ?? "",
              }}
            />
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
