import { notFound } from "next/navigation";
import { Megaphone } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { AdPlacementButton } from "../../_components/ad-placement-button";

const PLACEMENT_LABEL: Record<string, string> = {
  SEARCH_RESULTS_BANNER: "Search Results Banner",
  LISTING_PAGE_BANNER: "Other Listing Pages Banner",
};

export default async function ListingAdvertisingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/business-growth/${id}/advertising`);

  const listing = await prisma.businessListing.findUnique({
    where: { id },
    include: { adPlacements: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!listing || listing.organizationId !== membership.organizationId) notFound();

  const now = new Date();

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <Megaphone className="size-6 text-primary" /> Advertising — {listing.businessName}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Real dedicated sponsored banner slots — shown on the public directory search results, or on other businesses&apos; listing pages.
            Real impressions and clicks are tracked for every placement.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Buy a placement</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {listing.status !== "PUBLISHED" ? (
              <p className="text-sm text-muted-foreground">Publish this listing first — an ad placement needs a real published page to send clicks to.</p>
            ) : (
              <>
                <AdPlacementButton listingId={listing.id} placement="SEARCH_RESULTS_BANNER" />
                <AdPlacementButton listingId={listing.id} placement="LISTING_PAGE_BANNER" />
              </>
            )}
          </CardContent>
        </Card>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Placement</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Starts</TableHead>
              <TableHead>Ends</TableHead>
              <TableHead>Impressions</TableHead>
              <TableHead>Clicks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listing.adPlacements.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  No ad placements yet.
                </TableCell>
              </TableRow>
            )}
            {listing.adPlacements.map((placement) => {
              const isActive = placement.startsAt <= now && placement.endsAt >= now;
              return (
                <TableRow key={placement.id}>
                  <TableCell>{PLACEMENT_LABEL[placement.placement] ?? placement.placement}</TableCell>
                  <TableCell>
                    <Badge variant={isActive ? "default" : "outline"}>{isActive ? "Active" : "Expired"}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{placement.startsAt.toLocaleDateString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{placement.endsAt.toLocaleDateString()}</TableCell>
                  <TableCell>{placement.impressions}</TableCell>
                  <TableCell>{placement.clicks}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Container>
    </main>
  );
}
