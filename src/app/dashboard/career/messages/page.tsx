import Link from "next/link";
import { ArrowLeft, Inbox } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import type { RecruiterMessageClassificationType } from "@/generated/prisma/client";

/**
 * Phase 21 (§29/§30) — Career Inbox: real, evidence-backed VIEWS over the
 * existing Reply/RecruiterCommunication data. No second inbox — this reads
 * the same `Reply` rows the CRM inbox does, filtered to Contacts tagged
 * "career-application" (§30: never mixes unrelated sales email in).
 */

type View = "ALL" | "RECRUITERS" | "APPLICATIONS" | "INTERVIEWS" | "OFFERS" | "REJECTED" | "FOLLOW-UPS" | "UNKNOWN";

const VIEWS: View[] = ["ALL", "RECRUITERS", "APPLICATIONS", "INTERVIEWS", "OFFERS", "REJECTED", "FOLLOW-UPS", "UNKNOWN"];

function classificationsForView(view: View): RecruiterMessageClassificationType[] | undefined {
  switch (view) {
    case "INTERVIEWS":
      return ["INTERVIEW_REQUEST", "SCREENING", "AVAILABILITY_REQUEST"];
    case "OFFERS":
      return ["OFFER"];
    case "REJECTED":
      return ["REJECTED"];
    case "FOLLOW-UPS":
      return ["FOLLOW_UP"];
    case "UNKNOWN":
      return ["UNKNOWN"];
    default:
      return undefined;
  }
}

export default async function CareerMessagesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { userId, membership } = await requireActiveMembership("/dashboard/career/messages");
  const params = await searchParams;
  const view = (VIEWS.includes(params.view as View) ? params.view : "ALL") as View;

  const profiles = await prisma.careerProfile.findMany({ where: { userId, organizationId: membership.organizationId }, select: { id: true } });
  const profileIds = profiles.map((p) => p.id);

  const classifications = classificationsForView(view);

  const communications = await prisma.recruiterCommunication.findMany({
    where: {
      organizationId: membership.organizationId,
      OR: [{ application: { careerProfileId: { in: profileIds } } }, { application: null, applicationId: null }],
      ...(view === "APPLICATIONS" ? { applicationId: { not: null } } : {}),
      ...(classifications ? { classification: { in: classifications } } : {}),
    },
    include: { reply: { include: { contact: true } }, application: { include: { job: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // §31 — RECRUITERS view further requires a real applicationId link (a genuinely known recruiter, not an UNMATCHED sender).
  const filtered = view === "RECRUITERS" ? communications.filter((c) => c.applicationId) : communications;

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div>
          <Link href="/dashboard/career" className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to Career
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Career Inbox</h1>
          <p className="text-sm text-muted-foreground">Real recruiter communication, classified and matched to your applications — nothing here is fabricated.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {VIEWS.map((v) => (
            <Link key={v} href={`/dashboard/career/messages?view=${v}`}>
              <Badge variant={v === view ? "accent" : "outline"}>{v.replace(/-/g, " ")}</Badge>
            </Link>
          ))}
        </div>

        {filtered.length === 0 ? (
          <Card glass>
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <Inbox className="size-8 text-muted-foreground" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">No messages in this view yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {filtered.map((c) => (
              <Card key={c.id} glass>
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {c.reply.contact.firstName} {c.reply.contact.lastName} <span className="text-xs text-muted-foreground">&lt;{c.reply.contact.email}&gt;</span>
                    </p>
                    {c.application ? (
                      <p className="text-xs text-muted-foreground">
                        {c.application.job.title} at {c.application.job.company}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{c.matchStatus === "UNMATCHED" ? "No matching application found." : "Match ambiguous — review required."}</p>
                    )}
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{c.reply.content}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={c.reviewRequired ? "outline" : "accent"}>{(c.manualClassification ?? c.classification).replace(/_/g, " ")}</Badge>
                    <span className="text-[11px] text-muted-foreground">{c.classificationConfidence} confidence</span>
                    {c.reviewRequired && <span className="text-[11px] text-amber-500">Review required</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Container>
    </main>
  );
}
