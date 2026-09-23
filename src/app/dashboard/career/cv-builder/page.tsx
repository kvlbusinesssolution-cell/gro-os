import Link from "next/link";
import { ArrowLeft, FileEdit } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import { CVBuilderClient } from "./_components/cv-builder-client";

interface CVBuilderSearchParams {
  profile?: string;
}

/**
 * Phase 35 — CV/Resume Builder. Professional, multi-language, template-
 * based CV authoring, independent of the Career Agent's own upload/parse
 * pipeline (CareerResume) and per-application customized copies
 * (ApplicationDocument) — this is the "build one from scratch" system the
 * user explicitly asked for, separate from those two existing flows.
 */
export default async function CVBuilderPage({ searchParams }: { searchParams: Promise<CVBuilderSearchParams> }) {
  const { userId, membership } = await requireActiveMembership("/dashboard/career/cv-builder");
  const params = await searchParams;

  const profiles = await prisma.careerProfile.findMany({
    where: { userId, organizationId: membership.organizationId, status: "ACTIVE" },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  if (profiles.length === 0) {
    return (
      <main className="py-8">
        <Container className="flex flex-col gap-6">
          <Link href="/dashboard/career" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to Career
          </Link>
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <FileEdit className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">Create a career profile first, then come back to build a CV.</p>
              <Link href="/dashboard/career/profile" className="text-sm font-medium text-primary hover:underline">
                Create a career profile
              </Link>
            </CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  const activeProfile = profiles.find((p) => p.id === params.profile) ?? profiles[0];
  const cvs = await prisma.careerCV.findMany({ where: { careerProfileId: activeProfile.id }, orderBy: { updatedAt: "desc" } });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/dashboard/career" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3.5" /> Back to Career
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">CV Builder</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Build a professional CV from a real template, in any of 28 supported languages (Latin, Cyrillic, Greek, and
              Devanagari scripts — real, verified glyph rendering, not a claim of universal support). Generates a real PDF
              you can download.
            </p>
          </div>
        </div>

        <CVBuilderClient
          careerProfileId={activeProfile.id}
          profiles={profiles.map((p) => ({ id: p.id, name: p.name }))}
          initialCVs={cvs.map((cv) => ({
            id: cv.id,
            title: cv.title,
            language: cv.language,
            templateKey: cv.templateKey,
            content: cv.content,
            storageKey: cv.storageKey,
            generatedAt: cv.generatedAt ? cv.generatedAt.toISOString() : null,
            translatedFromId: cv.translatedFromId,
            updatedAt: cv.updatedAt.toISOString(),
          }))}
        />
      </Container>
    </main>
  );
}
