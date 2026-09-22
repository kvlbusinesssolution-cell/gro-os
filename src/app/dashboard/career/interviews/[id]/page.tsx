import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { generateInterviewPreparation } from "@/lib/career/interview-preparation";
import { InterviewDecisionActions } from "./_components/interview-decision-actions";

export default async function CareerInterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId, membership } = await requireActiveMembership("/dashboard/career/interviews");
  const { id } = await params;

  const interview = await prisma.careerInterview.findUnique({
    where: { id },
    include: { application: { include: { job: true } }, careerProfile: true },
  });
  if (!interview || interview.organizationId !== membership.organizationId || interview.careerProfile.userId !== userId) notFound();

  const preparation = await generateInterviewPreparation(interview.applicationId);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <Link href="/dashboard/career/interviews" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to Interviews
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {interview.application.job.title} at {interview.application.job.company}
          </h1>
          <Badge variant={interview.status === "SCHEDULED" ? "accent" : "outline"}>{interview.status.replace(/_/g, " ")}</Badge>
        </div>

        <Card glass>
          <CardContent className="grid grid-cols-1 gap-3 p-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Proposed date/time (as extracted, never re-guessed)</p>
              <p className="text-foreground">{interview.localDate ?? "Not stated"} {interview.localTime ?? ""}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Timezone</p>
              <p className="text-foreground">{interview.timezone ?? "Not stated — TIMEZONE_REQUIRED"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Meeting link</p>
              <p className="text-foreground">{interview.meetingLink ?? "Not provided"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Interviewer</p>
              <p className="text-foreground">{interview.interviewerName ?? "Not stated"}</p>
            </div>
            {interview.notes && (
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-foreground">{interview.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {(interview.status === "PENDING_APPROVAL" || interview.status === "REQUESTED") && (
          <Card glass>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-sm font-medium text-foreground">This interview needs your decision — no calendar integration is connected, so nothing is auto-confirmed.</p>
              <InterviewDecisionActions interviewId={interview.id} />
            </CardContent>
          </Card>
        )}

        <Card glass>
          <CardContent className="flex flex-col gap-4 p-4">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-foreground">Factual information</h2>
              <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                {"facts" in preparation && preparation.facts.map((fact, i) => <li key={i}>{fact}</li>)}
              </ul>
            </div>
            {"aiGenerated" in preparation && preparation.aiGenerated ? (
              <div className="flex flex-col gap-3">
                <div>
                  <h2 className="mb-1 text-sm font-semibold text-foreground">Likely topics (AI-generated — not a guarantee)</h2>
                  <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                    {preparation.aiGenerated.likelyTopics.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
                <div>
                  <h2 className="mb-1 text-sm font-semibold text-foreground">Potential questions (AI-generated — not a guarantee)</h2>
                  <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                    {preparation.aiGenerated.potentialQuestions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
                <div>
                  <h2 className="mb-1 text-sm font-semibold text-foreground">Questions you could ask (AI-generated)</h2>
                  <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                    {preparation.aiGenerated.candidateQuestions.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">AI preparation is unavailable right now (no AI provider connected) — only the factual information above is shown.</p>
            )}
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
