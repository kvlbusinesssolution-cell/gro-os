import Link from "next/link";
import { notFound } from "next/navigation";
import { Globe2 } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { MicrositeActionsPanel } from "../../_components/microsite-actions-panel";
import { MicrositePageEditor } from "../../_components/microsite-page-editor";
import type { LandingPageBlock } from "@/lib/validations/marketing";

const PAGE_ORDER = ["home", "about", "services", "contact"];

export default async function ListingWebsitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/business-growth/${id}/website`);

  const listing = await prisma.businessListing.findUnique({
    where: { id },
    include: { microsite: { include: { pages: true } } },
  });
  if (!listing || listing.organizationId !== membership.organizationId) notFound();

  const microsite = listing.microsite;
  const pages = microsite ? [...microsite.pages].sort((a, b) => PAGE_ORDER.indexOf(a.pageSlug) - PAGE_ORDER.indexOf(b.pageSlug)) : [];

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <Globe2 className="size-6 text-primary" /> AI Website Builder — {listing.businessName}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            A real, free AI-drafted multi-page website built entirely from your own listing data — real name, category, services, and reviews.
            The AI only phrases and organizes what&apos;s real; it never invents a service or review. Publishing is Growth-Token gated.
          </p>
          {microsite && (
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={microsite.status === "PUBLISHED" ? "default" : "outline"}>{microsite.status}</Badge>
              {microsite.status === "PUBLISHED" && (
                <Link href={`/site/${microsite.slug}`} target="_blank" className="text-sm text-primary hover:underline">
                  View public website
                </Link>
              )}
            </div>
          )}
        </div>

        <MicrositeActionsPanel listingId={listing.id} micrositeId={microsite?.id ?? null} status={microsite?.status ?? null} hasPages={pages.length > 0} />

        {pages.length > 0 && microsite && (
          <div className="flex flex-col gap-4">
            {pages.map((page) => (
              <MicrositePageEditor
                key={page.id}
                micrositeId={microsite.id}
                pageSlug={page.pageSlug}
                initialTitle={page.title}
                initialBlocks={page.bodyBlocks as LandingPageBlock[]}
              />
            ))}
          </div>
        )}
      </Container>
    </main>
  );
}
