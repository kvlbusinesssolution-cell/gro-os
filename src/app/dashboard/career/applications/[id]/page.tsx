import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../../_lib/require-membership";
import { ApplicationActionsPanel } from "./_components/application-actions-panel";

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, membership } = await requireActiveMembership(`/dashboard/career/applications/${id}`);

  const application = await prisma.jobApplication.findUnique({
    where: { id },
    include: { job: true, answers: true, documents: true, selectedResume: true },
  });
  if (!application || application.userId !== userId || application.organizationId !== membership.organizationId) notFound();

  const eligibilityDetail = (application.eligibilityDetail as Array<{ requirement: string; status: string; evidence: string }> | null) ?? [];
  const validationDetail = (application.validationDetail as Array<{ name: string; passed: boolean; detail: string }> | null) ?? [];
  const policyDecision = application.policyDecision as { decision: string; conditions: Array<{ name: string; passed: boolean; detail: string }> } | null;

  return (
    <main className="py-8">
      <Container className="flex max-w-3xl flex-col gap-6">
        <Link href="/dashboard/career/applications" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Back to applications
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{application.job.title}</h1>
            <p className="text-sm text-muted-foreground">{application.job.company}</p>
            {application.job.canonicalUrl && (
              <a href={application.job.canonicalUrl} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline">
                View original posting <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant="secondary" className="text-base">
              {application.status.replace(/_/g, " ")}
            </Badge>
            <ApplicationActionsPanel applicationId={application.id} status={application.status} />
          </div>
        </div>

        {application.blockedReason && (
          <Card glass>
            <CardContent className="p-4 text-sm text-amber-700 dark:text-amber-400">{application.blockedReason}</CardContent>
          </Card>
        )}

        <Card glass>
          <CardContent className="flex flex-col gap-2 p-5">
            <p className="text-sm font-medium text-foreground">Eligibility — {application.eligibilityStatus.replace(/_/g, " ")}</p>
            <ul className="flex flex-col gap-1">
              {eligibilityDetail.map((c, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  <span className={c.status === "SATISFIED" ? "text-emerald-600 dark:text-emerald-400" : c.status === "UNSATISFIED" ? "text-destructive" : "text-muted-foreground"}>
                    {c.status}
                  </span>{" "}
                  — {c.evidence}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card glass>
          <CardContent className="flex flex-col gap-2 p-5">
            <p className="text-sm font-medium text-foreground">
              Duplicate check: <span className="font-normal text-muted-foreground">{application.duplicateStatus.replace(/_/g, " ")}</span>
            </p>
            <p className="text-sm font-medium text-foreground">
              Suspicion screen: <span className="font-normal text-muted-foreground">{application.suspicionStatus.replace(/_/g, " ")}</span>
            </p>
            {application.suspicionEvidence.length > 0 && (
              <ul className="list-disc pl-4 text-xs text-muted-foreground">
                {application.suspicionEvidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            <p className="text-sm font-medium text-foreground">
              Selected resume: <span className="font-normal text-muted-foreground">{application.selectedResume?.originalFilename ?? "None"}</span>
            </p>
            {application.selectedResumeReason && <p className="text-xs text-muted-foreground">{application.selectedResumeReason}</p>}
          </CardContent>
        </Card>

        {validationDetail.length > 0 && (
          <Card glass>
            <CardContent className="flex flex-col gap-2 p-5">
              <p className="text-sm font-medium text-foreground">Validation — {application.validationResult ?? "not run"}</p>
              <ul className="flex flex-col gap-1">
                {validationDetail.map((c, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    <span className={c.passed ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>{c.passed ? "PASS" : "FAIL"}</span> — {c.name}: {c.detail}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {policyDecision && (
          <Card glass>
            <CardContent className="flex flex-col gap-2 p-5">
              <p className="text-sm font-medium text-foreground">Autonomy safety gate — {policyDecision.decision.replace(/_/g, " ")}</p>
              <ul className="flex flex-col gap-1">
                {policyDecision.conditions.map((c, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    <span className={c.passed ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>{c.passed ? "PASS" : "FAIL"}</span> — {c.name}: {c.detail}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {application.documents.length > 0 && (
          <Card glass>
            <CardContent className="flex flex-col gap-4 p-5">
              <p className="text-sm font-medium text-foreground">Documents</p>
              {application.documents.map((doc) => (
                <div key={doc.id} className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold text-foreground">{doc.type.replace(/_/g, " ")}</p>
                  {doc.content && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{doc.content.slice(0, 600)}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {application.answers.length > 0 && (
          <Card glass>
            <CardContent className="flex flex-col gap-3 p-5">
              <p className="text-sm font-medium text-foreground">Application answers</p>
              {application.answers.map((a) => (
                <div key={a.id} className="rounded-lg border border-border p-3">
                  <p className="text-xs font-medium text-foreground">{a.question}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.answer ?? "Awaiting your input"} <span className="text-[10px]">({a.source} · {a.status})</span>
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </Container>
    </main>
  );
}
