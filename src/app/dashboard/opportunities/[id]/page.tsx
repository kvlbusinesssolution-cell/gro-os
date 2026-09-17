import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  CheckCircle2,
  FileCheck2,
  FileSignature,
  FileText,
  Link2,
  ListChecks,
  Receipt,
  Sparkles,
  Target,
  UserRound,
  XCircle,
} from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import type { DecisionMakerRole } from "@/generated/prisma/client";
import { formatCurrency } from "@/app/dashboard/_lib/format";
import { requireActiveMembership } from "@/app/dashboard/_lib/require-membership";
import {
  DECISION_MAKER_ROLE_LABEL,
  STATUS_BADGE_CLASSNAME,
  STATUS_LABEL,
  confidenceBadgeClassName,
  personalizationCheckRows,
} from "../_lib/opportunity-display";
import { OpportunityActions } from "../_components/opportunity-actions";
import { OpportunityOutreachButton } from "../_components/opportunity-outreach-button";
import { GenerateProposalButton } from "../_components/generate-proposal-button";
import { buildOpportunityBrief } from "@/lib/business-development/opportunity-brief";
import { matchDecisionMakerForOpportunity } from "@/lib/business-development/decision-maker-matching";
import { checkDraftPersonalizationQuality } from "@/lib/outreach/personalization-quality";

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/opportunities/${id}`);

  const opportunity = await prisma.leadOpportunity.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true, industry: true, headquartersCountry: true, organizationId: true } } },
  });

  if (!opportunity || opportunity.company.organizationId !== membership.organizationId) {
    notFound();
  }

  const brief = await buildOpportunityBrief(id);
  if (!brief) {
    notFound();
  }

  // Phase 3 — Target Contact: pick the single best decision-maker for this
  // opportunity's recommended service, out of whatever's already been
  // discovered for the company. Read-only: prepares contact info for
  // Phase 5, never sends anything.
  const decisionMakers = await prisma.decisionMaker.findMany({
    where: { companyId: opportunity.companyId },
    select: { id: true, name: true, role: true, source: true, sourceUrl: true, confidence: true },
  });
  const decisionMakerMatch = matchDecisionMakerForOpportunity(opportunity.recommendedService, decisionMakers);

  // Phase 5 — "Convert to Outreach" durable-state detection. Mirrors
  // resolveOutreachContact's own case-insensitive full-name-within-company
  // matching (decision-maker-outreach.ts) exactly, so "already converted"
  // reflects the SAME Contact that a real conversion would resolve/reuse —
  // this is a real server-side query against Postgres, not local component
  // state, so a stale UI can never claim "already converted" (or the
  // reverse) after a page reload.
  let outreachContactId: string | null = null;
  let outreachQuality: Awaited<ReturnType<typeof checkDraftPersonalizationQuality>> | null = null;

  if (decisionMakerMatch) {
    const nameKey = decisionMakerMatch.decisionMaker.name.trim().toLowerCase();
    const companyContacts = await prisma.contact.findMany({
      where: { companyId: opportunity.companyId },
      select: { id: true, firstName: true, lastName: true },
    });
    const matchedContact = companyContacts.find(
      (contact) => `${contact.firstName} ${contact.lastName ?? ""}`.trim().toLowerCase() === nameKey,
    );

    if (matchedContact) {
      const latestDraft = await prisma.emailDraft.findFirst({
        where: { contactId: matchedContact.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latestDraft) {
        outreachContactId = matchedContact.id;
        outreachQuality = await checkDraftPersonalizationQuality(latestDraft.id);
      }
    }
  }
  const alreadyConverted = outreachContactId != null;

  // "Generate Proposal" — already-exists detection. Keyed off the same
  // `companyId` that `generateProposalFromOpportunityCore` stamps onto
  // every `Proposal` it creates from this action, so this is a real,
  // durable check against Postgres (not local UI state): a page reload
  // always reflects whether a proposal genuinely already exists, and this
  // is the actual guard against the button spamming duplicate Proposals —
  // the server action itself has no such de-dup logic of its own.
  const existingProposal = await prisma.proposal.findFirst({
    where: { companyId: opportunity.companyId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  // "Deal & Document Status" — read-only summary. Looks up the Deal the
  // exact same way `generateProposalFromOpportunityCore` does (most recent
  // Deal for this opportunity's company, in this org) so "no deal yet"
  // here means the same thing it means to that action. Contract/Invoice/
  // Proposal statuses shown below are DERIVED by reading the most recent
  // linked record for that Deal, never a separate duplicated status field
  // (Deal has no proposalStatus/contractStatus/invoiceStatus columns).
  const deal = await prisma.deal.findFirst({
    where: { organizationId: membership.organizationId, companyId: opportunity.companyId },
    orderBy: { createdAt: "desc" },
    include: {
      dealStage: { select: { name: true } },
      proposals: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      contracts: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      invoices: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
    },
  });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <Link
          href="/dashboard/opportunities"
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to Opportunities
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
              <Building2 className="size-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{opportunity.title}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/companies/${opportunity.company.id}`} className="text-sm text-primary hover:underline">
                  {opportunity.company.name}
                </Link>
                {opportunity.company.industry && <Badge variant="outline">{opportunity.company.industry}</Badge>}
                {opportunity.company.headquartersCountry && <Badge variant="outline">{opportunity.company.headquartersCountry}</Badge>}
                <Badge variant="outline">{opportunity.category}</Badge>
                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASSNAME[opportunity.status]}`}
                >
                  {STATUS_LABEL[opportunity.status]}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <OpportunityActions opportunityId={opportunity.id} status={opportunity.status} />
            <OpportunityOutreachButton
              opportunityId={opportunity.id}
              hasDecisionMaker={decisionMakerMatch != null}
              alreadyConverted={alreadyConverted}
              existingContactId={outreachContactId ?? undefined}
            />
            <GenerateProposalButton
              opportunityId={opportunity.id}
              isDismissed={opportunity.status === "DISMISSED"}
              existingProposalId={existingProposal?.id}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card glass>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Confidence</p>
              <span
                className={`mt-1 inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-medium ${confidenceBadgeClassName(brief.confidence)}`}
              >
                {brief.confidence}%
              </span>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Estimated impact</p>
              <p className="mt-1 text-sm font-medium capitalize text-foreground">{opportunity.estimatedImpact}</p>
            </CardContent>
          </Card>
          <Card glass>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Estimated value</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {opportunity.estimatedValue != null ? formatCurrency(opportunity.estimatedValue) : "Not estimated"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Deal & Document Status — read-only summary. Placed here rather
            than on the Deal's own detail page because that page
            (/dashboard/crm/deals/[id]) already lists every linked
            Proposal/Quotation/Contract/Invoice/BusinessDocument with its
            real status (see its "Documents" card) — a second copy of that
            list there would be redundant. This opportunity page has no
            Deal-linked information at all today, so a compact summary
            here — with a real link through to the full Deal page — is the
            genuine gap. Every status shown is DERIVED by reading the most
            recently created linked record, never a duplicated/cached
            status field (Deal has no such columns). */}
        <Card glass>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Briefcase className="size-4" /> Deal &amp; Document Status
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {!deal ? (
              <p className="text-sm text-muted-foreground">
                No deal yet for this company — use &ldquo;Add to CRM&rdquo; above to create one.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Link href={`/dashboard/crm/deals/${deal.id}`} className="text-sm font-medium text-primary hover:underline">
                      {deal.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {deal.value != null ? formatCurrency(deal.value) : "Value not set"}
                      {" · "}
                      {deal.probability != null ? `${deal.probability}% probability` : "Probability not set"}
                      {" · "}
                      {deal.expectedCloseDate ? `Expected close ${deal.expectedCloseDate.toLocaleDateString()}` : "No expected close date"}
                    </p>
                  </div>
                  <Badge variant="outline">{deal.dealStage.name}</Badge>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <FileText className="size-3.5" /> Proposal
                    </span>
                    {deal.proposals[0] ? (
                      <Badge variant="outline">{deal.proposals[0].status}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not yet created</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <FileSignature className="size-3.5" /> Contract
                    </span>
                    {deal.contracts[0] ? (
                      <Badge variant="outline">{deal.contracts[0].status}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not yet created</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Receipt className="size-3.5" /> Invoice
                    </span>
                    {deal.invoices[0] ? (
                      <Badge variant="outline">{deal.invoices[0].status}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not yet created</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card glass>
            <CardHeader>
              <CardTitle className="text-base">Company overview</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">{brief.companyOverview}</CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="text-base">Detected problem</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">{brief.detectedProblem}</CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="text-base">Business context</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">{brief.businessContext}</CardContent>
          </Card>

          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="size-4" /> Recommended KVL service
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-0">
              {brief.recommendedService ? (
                <>
                  <Badge variant="accent" className="w-fit">
                    {brief.recommendedService.label}
                  </Badge>
                  {brief.serviceMatchScore != null && (
                    <p className="text-xs text-muted-foreground">Match score: {brief.serviceMatchScore}%</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No service matched yet.</p>
              )}
            </CardContent>
          </Card>

          {/* Evidence — the one factual field here, styled like company-evidence-panel.tsx's
              RAW_FACT rows (emerald) so it's never visually confused with the AI-interpretive
              fields (why-this-service / sales angle / next step) below, which use the same
              purple/primary "AI interpretation" treatment as that panel's AI_INTERPRETATION rows. */}
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 lg:col-span-2">
            <div className="flex items-center gap-1.5 p-6 pb-0 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <FileCheck2 className="size-3.5" /> Evidence — directly observed / researched
            </div>
            <div className="p-6 pt-3 text-sm text-foreground">{brief.evidence}</div>
          </div>

          {brief.whyThisService && (
            <div className="rounded-2xl border border-primary/20 bg-primary/5">
              <div className="flex items-center gap-1.5 p-6 pb-0 text-xs font-semibold text-primary">
                <Sparkles className="size-3.5" /> Why this service — AI interpretation, not verified
              </div>
              <div className="p-6 pt-3 text-sm text-foreground">{brief.whyThisService}</div>
            </div>
          )}

          {brief.recommendedSalesAngle && (
            <div className="rounded-2xl border border-primary/20 bg-primary/5">
              <div className="flex items-center gap-1.5 p-6 pb-0 text-xs font-semibold text-primary">
                <Sparkles className="size-3.5" /> Recommended sales angle — AI interpretation, not verified
              </div>
              <div className="p-6 pt-3 text-sm text-foreground">{brief.recommendedSalesAngle}</div>
            </div>
          )}

          {brief.recommendedNextStep && (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 lg:col-span-2">
              <div className="flex items-center gap-1.5 p-6 pb-0 text-xs font-semibold text-primary">
                <Sparkles className="size-3.5" /> Recommended next step — AI interpretation, not verified
              </div>
              <div className="p-6 pt-3 text-sm text-foreground">{brief.recommendedNextStep}</div>
            </div>
          )}
        </div>

        {/* Phase 3 — Target Contact. Read-only: prepares the contact for
            Phase 5's outreach, never sends anything itself, so this card is
            deliberately non-interactive (no "contact this person" action).
            Verified identity fields use the emerald "raw fact" treatment
            from company-evidence-panel.tsx; `whyThisPerson` (a scored
            explanation, not a verified fact) uses the same purple/primary
            "AI interpretation, not verified" treatment as the brief fields
            above. */}
        <Card glass>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="size-4" /> Target Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            {decisionMakerMatch ? (
              <>
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <FileCheck2 className="size-3.5" /> Verified contact details
                  </div>
                  <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-medium text-foreground">{decisionMakerMatch.decisionMaker.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {DECISION_MAKER_ROLE_LABEL[decisionMakerMatch.decisionMaker.role as DecisionMakerRole] ??
                          decisionMakerMatch.decisionMaker.role}{" "}
                        at{" "}
                        <Link href={`/dashboard/companies/${opportunity.company.id}`} className="text-primary hover:underline">
                          {opportunity.company.name}
                        </Link>
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${confidenceBadgeClassName(
                        Math.round(decisionMakerMatch.decisionMaker.confidence * 100),
                      )}`}
                    >
                      {Math.round(decisionMakerMatch.decisionMaker.confidence * 100)}% confidence
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>Source: {decisionMakerMatch.decisionMaker.source}</span>
                    {decisionMakerMatch.decisionMaker.sourceUrl && (
                      <a
                        href={decisionMakerMatch.decisionMaker.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline"
                      >
                        <Link2 className="size-3" /> View source
                      </a>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Sparkles className="size-3.5" /> Why this person — AI interpretation, not verified
                  </div>
                  <p className="mt-2 text-sm text-foreground">{decisionMakerMatch.whyThisPerson}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No public decision-maker identified yet for this company.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Phase 5 — Personalization Quality. A real, deterministic
            pre-send checklist over the actual generated `EmailDraft`
            (checkDraftPersonalizationQuality, personalization-quality.ts) —
            informational only. The actual Approve/Send gate stays entirely
            in the existing /dashboard/outreach review flow; this is a
            preview of what that reviewer will see, not a second gate. */}
        {outreachQuality && (
          <Card glass>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ListChecks className="size-4" /> Personalization Quality
                <span
                  className={`ml-1 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
                    outreachQuality.passed
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {outreachQuality.passed ? (
                    <>
                      <CheckCircle2 className="size-3.5" /> Passed
                    </>
                  ) : (
                    <>
                      <XCircle className="size-3.5" /> Needs review
                    </>
                  )}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-0">
              <p className="text-xs text-muted-foreground">
                A pre-send checklist for the latest generated draft — review before clicking Approve in{" "}
                {outreachContactId ? (
                  <Link href={`/dashboard/outreach/contacts/${outreachContactId}`} className="text-primary hover:underline">
                    Outreach
                  </Link>
                ) : (
                  "Outreach"
                )}
                .
              </p>
              <ul className="flex flex-col gap-1.5">
                {personalizationCheckRows(outreachQuality.checkedFields).map((row) => (
                  <li key={row.key} className="flex items-center gap-2 text-sm">
                    {row.passed ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <XCircle className="size-3.5 shrink-0 text-red-600 dark:text-red-400" />
                    )}
                    <span className={row.passed ? "text-foreground" : "text-muted-foreground"}>{row.label}</span>
                  </li>
                ))}
              </ul>
              {!outreachQuality.passed && outreachQuality.issues.length > 0 && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">Issues to review before approving</p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {outreachQuality.issues.map((issue, i) => (
                      <li key={i} className="text-sm text-foreground before:mr-1.5 before:content-['•']">
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </Container>
    </main>
  );
}
