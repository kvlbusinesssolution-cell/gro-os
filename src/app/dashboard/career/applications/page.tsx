import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import { PolicyPanel } from "./_components/policy-panel";

const STATUS_VARIANT: Record<string, "accent" | "outline" | "secondary"> = {
  CONFIRMED: "accent",
  SUBMITTED: "accent",
  INTERVIEW: "accent",
  OFFER: "accent",
  READY_FOR_REVIEW: "secondary",
  USER_APPROVAL_REQUIRED: "secondary",
  PLATFORM_RESTRICTED: "outline",
  FAILED: "outline",
  FAILED_REQUIRES_REVIEW: "outline",
  REJECTED: "outline",
  WITHDRAWN: "outline",
};

export default async function CareerApplicationsPage({ searchParams }: { searchParams: Promise<{ profile?: string }> }) {
  const { userId, membership } = await requireActiveMembership("/dashboard/career/applications");
  const params = await searchParams;

  const profiles = await prisma.careerProfile.findMany({ where: { userId, organizationId: membership.organizationId, status: "ACTIVE" }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] });
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

  const applications = await prisma.jobApplication.findMany({
    where: { careerProfileId: activeProfile.id, organizationId: membership.organizationId },
    include: { job: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <Link href="/dashboard/career" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to Career
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Applications</h1>
          <p className="text-sm text-muted-foreground">
            Every real application — its eligibility check, documents, submission method, and true confirmation status. Nothing here is
            marked submitted or confirmed without real evidence.
          </p>
        </div>

        <PolicyPanel
          careerProfileId={activeProfile.id}
          applicationAutomationMode={activeProfile.applicationAutomationMode}
          maxApplicationsPerDay={activeProfile.maxApplicationsPerDay}
          maxApplicationsPerWeek={activeProfile.maxApplicationsPerWeek}
          minEligibilityForAutoApply={activeProfile.minEligibilityForAutoApply}
          applicationRequireApproval={activeProfile.applicationRequireApproval}
        />

        {applications.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <FileText className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                No applications yet. Open a{" "}
                <Link href={`/dashboard/career/jobs?profile=${activeProfile.id}`} className="text-primary hover:underline">
                  matched job
                </Link>{" "}
                and prepare an application.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {applications.map((app) => (
              <Link key={app.id} href={`/dashboard/career/applications/${app.id}`}>
                <Card glass className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">{app.job.title}</p>
                      <p className="text-xs text-muted-foreground">{app.job.company}</p>
                    </div>
                    <Badge variant={STATUS_VARIANT[app.status] ?? "outline"}>{app.status.replace(/_/g, " ")}</Badge>
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
