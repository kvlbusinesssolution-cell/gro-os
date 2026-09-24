import { notFound } from "next/navigation";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { DealForm } from "../../_components/deal-form";
import { DealRowActions } from "../../_components/deal-row-actions";

export default async function ListingDealsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/business-growth/${id}/deals`);

  const listing = await prisma.businessListing.findUnique({ where: { id }, include: { deals: { orderBy: { createdAt: "desc" } } } });
  if (!listing || listing.organizationId !== membership.organizationId) notFound();

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Deals — {listing.businessName}</h1>

        <Card>
          <CardHeader>
            <CardTitle>New deal</CardTitle>
          </CardHeader>
          <CardContent>
            <DealForm listingId={listing.id} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          {listing.deals.length === 0 && <p className="text-sm text-muted-foreground">No deals yet.</p>}
          {listing.deals.map((deal) => (
            <Card key={deal.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{deal.title}</span>
                    <Badge variant={deal.status === "PUBLISHED" ? "default" : "outline"}>{deal.status}</Badge>
                  </div>
                  {deal.discountLabel && <p className="text-xs text-muted-foreground">{deal.discountLabel}</p>}
                  <p className="text-xs text-muted-foreground">{deal.claimCount} claims</p>
                </div>
                <DealRowActions dealId={deal.id} status={deal.status} />
              </CardContent>
            </Card>
          ))}
        </div>
      </Container>
    </main>
  );
}
