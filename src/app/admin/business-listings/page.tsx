import Link from "next/link";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requirePlatformOwner } from "@/lib/billing/platform-admin";
import { ListingTrustActions } from "./_components/listing-trust-actions";
import { ReportRowActions } from "./_components/report-row-actions";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "accent"> = {
  DRAFT: "secondary",
  PUBLISHED: "default",
  UNPUBLISHED: "outline",
  SUSPENDED: "outline",
};

export default async function AdminBusinessListingsPage() {
  await requirePlatformOwner("/admin/business-listings");

  const [listings, pendingReports] = await Promise.all([
    prisma.businessListing.findMany({
      include: { organization: { select: { name: true } }, _count: { select: { reports: { where: { status: "PENDING" } } } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    prisma.businessListingReport.findMany({
      where: { status: "PENDING" },
      include: { businessListing: { select: { businessName: true, slug: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <Container className="flex flex-col gap-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Business Listings — Trust &amp; Safety</h1>
        <p className="text-sm text-muted-foreground">
          {listings.length} total listings · {pendingReports.length} reports awaiting review. Verification here is the platform's real "JD Trust"-style badge — it is never settable by an
          organization's own team.
        </p>
      </div>

      {pendingReports.length > 0 && (
        <Card glass className="border-primary/30">
          <CardHeader>
            <CardTitle>Pending reports</CardTitle>
            <CardDescription>Abuse/accuracy reports submitted from public listing pages.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {pendingReports.map((report) => (
              <div key={report.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="font-medium text-foreground">
                    <Link href={`/listings/${report.businessListing.slug}`} target="_blank" className="hover:underline">
                      {report.businessListing.businessName}
                    </Link>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {report.reason.replace(/_/g, " ")}
                    {report.details ? ` — ${report.details}` : ""}
                  </p>
                </div>
                <ReportRowActions reportId={report.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card glass>
        <CardHeader>
          <CardTitle>All listings</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Reports</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trust</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listings.map((listing) => (
                <TableRow key={listing.id}>
                  <TableCell>{listing.businessName}</TableCell>
                  <TableCell>{listing.organization.name}</TableCell>
                  <TableCell>{listing.city}</TableCell>
                  <TableCell>{listing.reviewCount > 0 ? listing.averageRating.toFixed(1) : "—"}</TableCell>
                  <TableCell>{listing._count.reports > 0 ? <Badge variant="outline">{listing._count.reports}</Badge> : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[listing.status]}>{listing.status}</Badge>
                  </TableCell>
                  <TableCell>{listing.isVerified ? <Badge variant="default">Verified</Badge> : <Badge variant="outline">Unverified</Badge>}</TableCell>
                  <TableCell>
                    <ListingTrustActions listingId={listing.id} isVerified={listing.isVerified} status={listing.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Container>
  );
}
