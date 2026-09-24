import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { LandingPageForm } from "../../_components/landing-page-form";
import { PublishLandingPageButton } from "../../_components/publish-landing-page-button";
import { LeadMagnetUploader } from "../../_components/lead-magnet-uploader";
import type { MarketingLandingPageInput } from "@/lib/validations/marketing";

export default async function LandingPageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/marketing/landing-pages/${id}`);

  const page = await prisma.marketingLandingPage.findUnique({ where: { id } });
  if (!page || page.organizationId !== membership.organizationId) notFound();

  const initial: Partial<MarketingLandingPageInput> = {
    title: page.title,
    headline: page.headline,
    subheadline: page.subheadline ?? "",
    heroImageUrl: page.heroImageUrl ?? "",
    bodyBlocks: page.bodyBlocks as MarketingLandingPageInput["bodyBlocks"],
    formFields: page.formFields as MarketingLandingPageInput["formFields"],
    metaTitle: page.metaTitle ?? "",
    metaDescription: page.metaDescription ?? "",
  };

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{page.title}</h1>
              <Badge variant={page.status === "PUBLISHED" ? "default" : "outline"}>{page.status}</Badge>
            </div>
            {page.status === "PUBLISHED" && (
              <Link href={`/lp/${page.slug}`} target="_blank" className="text-sm text-primary hover:underline">
                View public page
              </Link>
            )}
          </div>
          <PublishLandingPageButton landingPageId={page.id} status={page.status} />
        </div>

        <Link href={`/dashboard/marketing/landing-pages/${id}/leads`} className="text-sm text-primary hover:underline">
          View captured leads
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>Lead magnet</CardTitle>
          </CardHeader>
          <CardContent>
            <LeadMagnetUploader landingPageId={page.id} currentFilename={page.leadMagnetAssetFilename} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Edit page</CardTitle>
          </CardHeader>
          <CardContent>
            <LandingPageForm landingPageId={page.id} initial={initial} />
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
