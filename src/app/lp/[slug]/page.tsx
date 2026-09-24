import { notFound } from "next/navigation";
import Image from "next/image";
import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import type { LandingPageBlock, LandingPageFormField } from "@/lib/validations/marketing";
import { ContentBlockRenderer } from "@/components/blocks/content-block-renderer";
import { LandingPageLeadForm } from "./_components/landing-page-lead-form";
import { recordLandingPageView } from "../_lib/public-actions";

async function getPublishedLandingPage(slug: string) {
  const page = await prisma.marketingLandingPage.findUnique({ where: { slug } });
  if (!page || page.status !== "PUBLISHED") return null;
  return page;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedLandingPage(slug);
  if (!page) return { title: "Page not found" };

  const title = page.metaTitle || page.title;
  const description = page.metaDescription || page.subheadline || page.headline;

  return {
    title,
    description,
    alternates: { canonical: `/lp/${page.slug}` },
    openGraph: { title, description, images: page.heroImageUrl ? [page.heroImageUrl] : undefined },
  };
}

export default async function LandingPagePublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPublishedLandingPage(slug);
  if (!page) notFound();

  void recordLandingPageView(page.id);

  const blocks = page.bodyBlocks as LandingPageBlock[];
  const formFields = page.formFields as LandingPageFormField[];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-16">
      <div className="flex flex-col gap-4 text-center">
        {page.heroImageUrl && (
          <Image src={page.heroImageUrl} alt="" width={768} height={400} className="mx-auto rounded-xl object-cover" unoptimized />
        )}
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{page.headline}</h1>
        {page.subheadline && <p className="text-lg text-muted-foreground">{page.subheadline}</p>}
      </div>

      <div className="flex flex-col gap-6">
        {blocks.map((block, i) => (
          <ContentBlockRenderer key={i} block={block} />
        ))}
      </div>

      <LandingPageLeadForm landingPageId={page.id} formFields={formFields} />
    </main>
  );
}
