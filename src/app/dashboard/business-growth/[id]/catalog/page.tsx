import { notFound } from "next/navigation";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { CatalogForm } from "../../_components/catalog-form";
import { CatalogRowActions } from "../../_components/catalog-row-actions";

export default async function ListingCatalogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/business-growth/${id}/catalog`);

  const listing = await prisma.businessListing.findUnique({
    where: { id },
    include: { catalogItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  if (!listing || listing.organizationId !== membership.organizationId) notFound();

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Catalog — {listing.businessName}</h1>
          <p className="text-sm text-muted-foreground">Products &amp; services price list — shown on your public listing page once published.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>New item</CardTitle>
          </CardHeader>
          <CardContent>
            <CatalogForm listingId={listing.id} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          {listing.catalogItems.length === 0 && <p className="text-sm text-muted-foreground">No catalog items yet.</p>}
          {listing.catalogItems.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  {item.photoStorageKey && (
                    // eslint-disable-next-line @next/next/no-img-element -- served from a local, non-domain-configured API route
                    <img src={`/api/listings/catalog-photos/${item.id}`} alt="" className="size-14 rounded-lg object-cover" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{item.name}</span>
                      <Badge variant={item.status === "PUBLISHED" ? "default" : "outline"}>{item.status}</Badge>
                    </div>
                    {item.price != null && (
                      <p className="text-xs text-muted-foreground">
                        ₹{item.price}
                        {item.priceUnit ? ` ${item.priceUnit}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <CatalogRowActions itemId={item.id} status={item.status} />
              </CardContent>
            </Card>
          ))}
        </div>
      </Container>
    </main>
  );
}
