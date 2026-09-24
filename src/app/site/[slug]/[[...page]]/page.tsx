import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { ContentBlockRenderer } from "@/components/blocks/content-block-renderer";
import type { LandingPageBlock } from "@/lib/validations/marketing";

const PAGE_NAV = [
  { slug: "home", label: "Home" },
  { slug: "about", label: "About" },
  { slug: "services", label: "Services" },
  { slug: "contact", label: "Contact" },
];

async function getPublishedMicrositePage(slug: string, pageSlug: string) {
  const microsite = await prisma.businessMicrosite.findUnique({
    where: { slug },
    include: { businessListing: { select: { businessName: true, slug: true } }, pages: { where: { pageSlug } } },
  });
  if (!microsite || microsite.status !== "PUBLISHED") return null;
  const page = microsite.pages[0];
  if (!page) return null;
  return { microsite, page };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; page?: string[] }> }): Promise<Metadata> {
  const { slug, page: pageSegments } = await params;
  const pageSlug = pageSegments?.[0] ?? "home";
  const result = await getPublishedMicrositePage(slug, pageSlug);
  if (!result) return { title: "Website not found" };

  return {
    title: `${result.page.title} — ${result.microsite.businessListing.businessName}`,
    alternates: { canonical: `/site/${slug}${pageSlug === "home" ? "" : `/${pageSlug}`}` },
  };
}

/** JustDial-parity "AI Business Website Builder" public render — only ever serves a PUBLISHED BusinessMicrosite's real, previously-generated pages. */
export default async function MicrositePage({ params }: { params: Promise<{ slug: string; page?: string[] }> }) {
  const { slug, page: pageSegments } = await params;
  const pageSlug = pageSegments?.[0] ?? "home";
  const result = await getPublishedMicrositePage(slug, pageSlug);
  if (!result) notFound();

  const { microsite, page } = result;
  const blocks = page.bodyBlocks as LandingPageBlock[];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-16">
      <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <span className="font-semibold text-foreground">{microsite.businessListing.businessName}</span>
        <div className="flex gap-4 text-sm">
          {PAGE_NAV.map((nav) => (
            <Link key={nav.slug} href={nav.slug === "home" ? `/site/${slug}` : `/site/${slug}/${nav.slug}`} className="text-muted-foreground hover:text-primary">
              {nav.label}
            </Link>
          ))}
        </div>
      </nav>

      <h1 className="text-3xl font-semibold tracking-tight text-foreground">{page.title}</h1>

      <div className="flex flex-col gap-6">
        {blocks.map((block, i) => (
          <ContentBlockRenderer key={i} block={block} />
        ))}
      </div>

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        Built with KVL GrowthOS —{" "}
        <Link href={`/listings/${microsite.businessListing.slug}`} className="hover:underline">
          view full business listing
        </Link>
      </footer>
    </main>
  );
}
