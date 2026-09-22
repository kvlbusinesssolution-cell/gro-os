import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, CheckCircle2, AlertTriangle, HelpCircle, XCircle } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { MatchActions } from "./_components/match-actions";
import { PrepareApplicationButton } from "./_components/prepare-application-button";
import type { MatchDimension, MatchDimensionStatus } from "@/lib/career/job-matching";

const DIMENSION_LABEL: Record<string, string> = {
  skill: "Skills",
  experience: "Experience",
  role: "Role",
  industry: "Industry",
  location: "Location",
  salary: "Salary",
  technology: "Technology",
  careerLevel: "Career level",
  preference: "Company preference",
};

function statusIcon(status: MatchDimensionStatus) {
  switch (status) {
    case "MATCHED":
      return <CheckCircle2 className="size-4 text-emerald-500" />;
    case "PARTIAL":
      return <AlertTriangle className="size-4 text-amber-500" />;
    case "MISSING":
    case "MISMATCH":
    case "CONFLICT":
      return <XCircle className="size-4 text-destructive" />;
    default:
      return <HelpCircle className="size-4 text-muted-foreground" />;
  }
}

export default async function CareerJobDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ profile?: string }> }) {
  const { id } = await params;
  const { userId, membership } = await requireActiveMembership(`/dashboard/career/jobs/${id}`);
  const { profile: profileIdParam } = await searchParams;

  const job = await prisma.job.findUnique({ where: { id }, include: { sourceRecords: true } });
  if (!job) notFound();

  const profiles = await prisma.careerProfile.findMany({ where: { userId, organizationId: membership.organizationId, status: "ACTIVE" } });
  const activeProfile = profiles.find((p) => p.id === profileIdParam) ?? profiles.find((p) => p.isPrimary) ?? profiles[0];
  if (!activeProfile) notFound();

  const match = await prisma.jobMatch.findUnique({ where: { careerProfileId_jobId: { careerProfileId: activeProfile.id, jobId: job.id } } });
  // Real ownership/existence check — a job with no real match for THIS user's profile shows an honest empty state, never someone else's data.
  if (!match || match.organizationId !== membership.organizationId) notFound();

  const dimensions = match.dimensions as unknown as Record<string, MatchDimension>;
  const explanation = match.explanation as unknown as { whyMatched: string[]; whatIsMissing: string[]; whatIsRisky: string[]; whatShouldBeCustomized: string[] } | null;
  const primarySource = job.sourceRecords[0];
  const existingApplication = await prisma.jobApplication.findUnique({ where: { careerProfileId_jobId: { careerProfileId: activeProfile.id, jobId: job.id } }, select: { id: true } });

  return (
    <main className="py-8">
      <Container className="flex max-w-3xl flex-col gap-6">
        <Link href={`/dashboard/career/jobs?profile=${activeProfile.id}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Back to jobs
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{job.title}</h1>
            <p className="text-sm text-muted-foreground">
              {job.company} {job.location && `· ${job.location}`} {job.workMode && `· ${job.workMode}`}
            </p>
            {primarySource && (
              <a href={primarySource.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline">
                View original posting via {primarySource.provider} <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant={match.overallScore >= 70 ? "accent" : "outline"} className="text-base">
              {match.overallScore}% match
            </Badge>
            <MatchActions jobMatchId={match.id} currentStatus={match.status} />
            <PrepareApplicationButton careerProfileId={activeProfile.id} jobMatchId={match.id} existingApplicationId={existingApplication?.id ?? null} />
          </div>
        </div>

        <Card glass>
          <CardContent className="flex flex-col gap-3 p-5">
            <p className="text-sm font-medium text-foreground">Match breakdown</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {Object.entries(dimensions).map(([key, dim]) => (
                <div key={key} className="flex items-start gap-2 rounded-lg border border-border p-2.5">
                  {statusIcon(dim.status)}
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      {DIMENSION_LABEL[key] ?? key} — {dim.status.replace(/_/g, " ")}
                    </p>
                    {dim.evidence.slice(0, 1).map((e, i) => (
                      <p key={i} className="text-[11px] text-muted-foreground">
                        {e}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
              <HelpCircle className="size-3.5" />
              Eligibility: <span className="font-medium text-foreground">{match.eligibility.replace(/_/g, " ")}</span>
            </div>
          </CardContent>
        </Card>

        {explanation && (
          <Card glass>
            <CardContent className="flex flex-col gap-4 p-5">
              {explanation.whyMatched.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">WHY MATCHED</p>
                  <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                    {explanation.whyMatched.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {explanation.whatIsMissing.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-destructive">WHAT IS MISSING</p>
                  <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                    {explanation.whatIsMissing.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {explanation.whatIsRisky.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">WHAT IS RISKY</p>
                  <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                    {explanation.whatIsRisky.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {explanation.whatShouldBeCustomized.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-primary">WHAT SHOULD BE CUSTOMIZED</p>
                  <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                    {explanation.whatShouldBeCustomized.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card glass>
          <CardContent className="flex flex-col gap-2 p-5">
            <p className="text-sm font-medium text-foreground">Full description</p>
            <p className="whitespace-pre-line text-sm text-muted-foreground">{job.description}</p>
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
