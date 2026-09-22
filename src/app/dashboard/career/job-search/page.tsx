import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import { DiscoveryPanel } from "./_components/discovery-panel";

export default async function JobSearchPage({ searchParams }: { searchParams: Promise<{ profile?: string }> }) {
  const { userId, membership } = await requireActiveMembership("/dashboard/career/job-search");
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
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Create a career profile first, with at least some target roles/technologies set, before searching for jobs.{" "}
              <Link href="/dashboard/career/profile" className="text-primary hover:underline">
                Create one
              </Link>
              .
            </CardContent>
          </Card>
        </Container>
      </main>
    );
  }

  const activeProfile = profiles.find((p) => p.id === params.profile) ?? profiles[0];

  const recentRuns = await prisma.jobDiscoveryRun.findMany({
    where: { careerProfileId: activeProfile.id },
    orderBy: { startedAt: "desc" },
    take: 5,
  });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <Link href="/dashboard/career" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to Career
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Job Search</h1>
          <p className="text-sm text-muted-foreground">Configure and run real job discovery for a career profile.</p>
        </div>

        {profiles.length > 1 && (
          <form method="GET" className="flex items-center gap-2">
            <Select name="profile" defaultValue={activeProfile.id} className="w-64" onChange={(e) => e.currentTarget.form?.submit()}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </form>
        )}

        <DiscoveryPanel
          careerProfileId={activeProfile.id}
          discoveryEnabled={activeProfile.discoveryEnabled}
          discoveryFrequency={activeProfile.discoveryFrequency}
          minMatchThreshold={activeProfile.minMatchThreshold}
        />

        <Card glass>
          <CardContent className="flex flex-col gap-3 p-5">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <History className="size-4" /> Recent discovery runs
            </p>
            {recentRuns.length === 0 ? (
              <p className="text-xs text-muted-foreground">No discovery runs yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {recentRuns.map((run) => (
                  <div key={run.id} className="flex items-center justify-between border-b border-border py-1.5 text-xs last:border-0">
                    <span className="text-muted-foreground">{run.startedAt.toLocaleString()} — {run.provider} ({run.triggeredBy.toLowerCase()})</span>
                    <span className={run.status === "COMPLETED" ? "text-emerald-600 dark:text-emerald-400" : run.status === "RUNNING" ? "text-muted-foreground" : "text-destructive"}>
                      {run.status} — {run.resultCount} found, {run.newJobsCount} new
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Link href={`/dashboard/career/jobs?profile=${activeProfile.id}`} className="text-sm font-medium text-primary hover:underline">
          View matched jobs →
        </Link>
      </Container>
    </main>
  );
}
