import Link from "next/link";
import { notFound } from "next/navigation";
import { Trophy } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";

/**
 * Real "Competitor Intelligence" for a listing (JustDial-parity feature #2)
 * — deliberately built from this platform's own real, comparable data
 * (other PUBLISHED listings in the same category + city), never an AI
 * guess or scraped third-party data about a business that hasn't listed
 * here. Ranked purely by real averageRating/reviewCount, the same fields
 * shown publicly — an owner sees exactly what a real visitor sees about
 * their real local competition on this platform.
 */
export default async function ListingMarketComparisonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/business-growth/${id}/market`);

  const listing = await prisma.businessListing.findUnique({ where: { id } });
  if (!listing || listing.organizationId !== membership.organizationId) notFound();

  const peers = await prisma.businessListing.findMany({
    where: { status: "PUBLISHED", city: listing.city, category: listing.category, id: { not: listing.id } },
    select: { id: true, businessName: true, averageRating: true, reviewCount: true, isFeatured: true, isVerified: true, priceRange: true, slug: true },
    orderBy: [{ averageRating: "desc" }, { reviewCount: "desc" }],
    take: 20,
  });

  const all = [{ id: listing.id, businessName: listing.businessName, averageRating: listing.averageRating, reviewCount: listing.reviewCount, isFeatured: listing.isFeatured, isVerified: listing.isVerified, priceRange: listing.priceRange, slug: listing.slug, isSelf: true }, ...peers.map((p) => ({ ...p, isSelf: false }))].sort(
    (a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount,
  );
  const rank = all.findIndex((row) => row.isSelf) + 1;

  const peerAverage = peers.length > 0 ? peers.reduce((sum, p) => sum + p.averageRating, 0) / peers.length : null;

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <Trophy className="size-6 text-primary" /> Market Comparison — {listing.businessName}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Real, published {listing.category} listings in {listing.city} — the same public data every visitor sees, so you know exactly where you
            stand.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">Your rank</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold text-foreground">
              #{rank} of {all.length}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">Your rating</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold text-foreground">{listing.reviewCount > 0 ? listing.averageRating.toFixed(1) : "—"}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">Peer average rating</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold text-foreground">{peerAverage !== null ? peerAverage.toFixed(1) : "No peers yet"}</CardContent>
          </Card>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Reviews</TableHead>
              <TableHead>Price range</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {all.map((row) => (
              <TableRow key={row.id} className={row.isSelf ? "bg-primary/5" : undefined}>
                <TableCell className="font-medium text-foreground">
                  {row.isSelf ? (
                    row.businessName
                  ) : (
                    <Link href={`/listings/${row.slug}`} target="_blank" className="hover:underline">
                      {row.businessName}
                    </Link>
                  )}
                  {row.isSelf && (
                    <Badge variant="outline" className="ml-2">
                      You
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{row.reviewCount > 0 ? row.averageRating.toFixed(1) : "—"}</TableCell>
                <TableCell>{row.reviewCount}</TableCell>
                <TableCell>{row.priceRange ?? "—"}</TableCell>
                <TableCell className="flex gap-1">
                  {row.isVerified && <Badge variant="outline">Verified</Badge>}
                  {row.isFeatured && <Badge variant="default">Featured</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Container>
    </main>
  );
}
