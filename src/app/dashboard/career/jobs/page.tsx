import Link from "next/link";
import { ArrowLeft, Briefcase, ExternalLink } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import type { CareerJobStatus } from "@/generated/prisma/client";

interface JobsPageSearchParams {
  profile?: string;
  status?: string;
  minScore?: string;
}

const STATUS_OPTIONS: CareerJobStatus[] = ["DISCOVERED", "MATCHED", "SHORTLISTED", "NOT_MATCHED", "REVIEW_REQUIRED"];

export default async function CareerJobsPage({ searchParams }: { searchParams: Promise<JobsPageSearchParams> }) {
  const { userId, membership } = await requireActiveMembership("/dashboard/career/jobs");
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
            <CardContent className="p-8 text-center text-sm text-muted-foreground">Create a career profile first.</CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  const activeProfile = profiles.find((p) => p.id === params.profile) ?? profiles[0];
  const statusFilter = params.status && STATUS_OPTIONS.includes(params.status as CareerJobStatus) ? (params.status as CareerJobStatus) : undefined;
  const minScore = params.minScore ? Number(params.minScore) : activeProfile.minMatchThreshold;

  const matches = await prisma.jobMatch.findMany({
    where: {
      careerProfileId: activeProfile.id,
      organizationId: membership.organizationId,
      overallScore: { gte: minScore },
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    orderBy: { overallScore: "desc" },
    include: { job: true },
    take: 100,
  });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <Link href="/dashboard/career" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to Career
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Matched Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Real jobs matched against &quot;{activeProfile.name}&quot; — every score is deterministic and explainable, every
            listing links back to its real source.
          </p>
        </div>

        <Card glass>
          <CardContent className="p-4">
            <form method="GET" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="profile" value={activeProfile.id} />
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Status</span>
                <Select name="status" defaultValue={statusFilter ?? ""} className="w-44">
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Min. match score</span>
                <input
                  type="number"
                  name="minScore"
                  min={0}
                  max={100}
                  defaultValue={minScore}
                  className="h-11 w-24 rounded-lg border border-input bg-transparent px-3 text-sm text-foreground"
                />
              </label>
              <button type="submit" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Apply
              </button>
            </form>
          </CardContent>
        </Card>

        {matches.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <Briefcase className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                No matched jobs yet.{" "}
                <Link href={`/dashboard/career/job-search?profile=${activeProfile.id}`} className="text-primary hover:underline">
                  Run a real job search
                </Link>{" "}
                to discover some.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {matches.map((match) => (
              <Link key={match.id} href={`/dashboard/career/jobs/${match.job.id}?profile=${activeProfile.id}`}>
                <Card glass className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">{match.job.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {match.job.company} {match.job.location && `· ${match.job.location}`} {match.job.workMode && `· ${match.job.workMode}`}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        via Remotive <ExternalLink className="size-3" />
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={match.overallScore >= 70 ? "accent" : "outline"}>{match.overallScore}% match</Badge>
                      <Badge variant="secondary">{match.status.replace(/_/g, " ")}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Container>
    </main>
  );
}
