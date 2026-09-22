import Link from "next/link";
import { ArrowLeft, CalendarClock } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";

export default async function CareerInterviewsPage() {
  const { userId, membership } = await requireActiveMembership("/dashboard/career/interviews");

  const interviews = await prisma.careerInterview.findMany({
    where: { organizationId: membership.organizationId, careerProfile: { userId } },
    include: { application: { include: { job: true } } },
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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Interviews</h1>
          <p className="text-sm text-muted-foreground">
            Every interview here was created from a real recruiter message. No external calendar is connected in this
            deployment, so scheduling always needs your explicit approval below.
          </p>
        </div>

        {interviews.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <CalendarClock className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">No interviews yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {interviews.map((interview) => (
              <Link key={interview.id} href={`/dashboard/career/interviews/${interview.id}`}>
                <Card glass className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {interview.application.job.title} at {interview.application.job.company}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {interview.localDate && interview.localTime ? `${interview.localDate} ${interview.localTime} (${interview.timezone ?? "timezone unknown"})` : "Date/time not yet confirmed"}
                      </p>
                    </div>
                    <Badge variant={interview.status === "SCHEDULED" ? "accent" : "outline"}>{interview.status.replace(/_/g, " ")}</Badge>
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
