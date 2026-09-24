import Link from "next/link";
import { Store } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../_lib/require-membership";
import { GrowthTokenBalanceBadge } from "./_components/growth-token-balance-badge";
import { ListingForm } from "./_components/listing-form";

const STATUS_VARIANT: Record<string, "outline" | "accent" | "default" | "secondary"> = {
  DRAFT: "outline",
  PUBLISHED: "default",
  UNPUBLISHED: "secondary",
  SUSPENDED: "outline",
};

export default async function BusinessGrowthPage() {
  const { membership } = await requireActiveMembership("/dashboard/business-growth");

  const listings = await prisma.businessListing.findMany({
    where: { organizationId: membership.organizationId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { reviews: true, leads: true, deals: true } } },
  });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
              <Store className="size-6 text-primary" /> Business Growth
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Real local-SEO tooling for your business — a public listing page with structured data, reviews, deals,
              and click-to-call/WhatsApp lead capture. This helps you be found and be trusted; no platform can
              guarantee a #1 Google ranking, but this is the real, honest mechanism that supports one.
            </p>
          </div>
          <GrowthTokenBalanceBadge organizationId={membership.organizationId} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create a listing</CardTitle>
          </CardHeader>
          <CardContent>
            <ListingForm />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          {listings.length === 0 && <p className="text-sm text-muted-foreground">No listings yet — create one above.</p>}
          {listings.map((listing) => (
            <Link key={listing.id} href={`/dashboard/business-growth/${listing.id}`}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{listing.businessName}</span>
                      <Badge variant={STATUS_VARIANT[listing.status] ?? "outline"}>{listing.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {listing.city}
                      {listing.state ? `, ${listing.state}` : ""} · {listing.category}
                    </p>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{listing._count.reviews} reviews</span>
                    <span>{listing._count.deals} deals</span>
                    <span>{listing._count.leads} leads</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </Container>
    </main>
  );
}
