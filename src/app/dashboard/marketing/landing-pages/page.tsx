import Link from "next/link";
import { Megaphone } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import { LandingPageForm } from "../_components/landing-page-form";

const STATUS_VARIANT: Record<string, "outline" | "accent" | "default" | "secondary"> = {
  DRAFT: "outline",
  PUBLISHED: "default",
  UNPUBLISHED: "secondary",
};

export default async function LandingPagesPage() {
  const { membership } = await requireActiveMembership("/dashboard/marketing/landing-pages");

  const pages = await prisma.marketingLandingPage.findMany({
    where: { organizationId: membership.organizationId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { leads: true } } },
  });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <Megaphone className="size-6 text-primary" /> Marketing Landing Pages
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Build a real public landing page with a lead-capture form — every submission becomes a real CRM contact,
            picked up by your existing outreach tools. Publishing a page uses Growth Tokens; the form itself stays
            free to submit.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create a landing page</CardTitle>
          </CardHeader>
          <CardContent>
            <LandingPageForm />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3">
          {pages.length === 0 && <p className="text-sm text-muted-foreground">No landing pages yet — create one above.</p>}
          {pages.map((page) => (
            <Link key={page.id} href={`/dashboard/marketing/landing-pages/${page.id}`}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{page.title}</span>
                      <Badge variant={STATUS_VARIANT[page.status] ?? "outline"}>{page.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">/lp/{page.slug}</p>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{page.viewCount} views</span>
                    <span>{page._count.leads} leads</span>
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
