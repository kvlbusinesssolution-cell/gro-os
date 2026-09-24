import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  FileText,
  FolderKanban,
  Users2,
  Globe,
  Mail,
  Phone,
  MessageSquare,
  MapPin,
  Building2,
  Link2,
  Handshake,
} from "lucide-react";

import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/app/dashboard/_lib/format";
import { requireActiveMembership } from "@/app/dashboard/_lib/require-membership";
import { partnerTypeLabel } from "@/app/dashboard/referral-partners/_lib/referral-partner-display";
import { LeadScoreBadge } from "@/app/dashboard/_components/lead-score-badge";
import { WatchlistPicker } from "@/app/dashboard/_components/watchlist-picker";
import { CompanyEditForm } from "../_components/company-edit-form";
import { LeadScorePanel } from "../_components/lead-score-panel";
import { CompanyIntelligencePanel } from "../_components/company-intelligence-panel";
import { CompanyTimeline } from "../_components/company-timeline";
import { CompanyMap } from "../_components/company-map";
import { CrmActionsPanel } from "../_components/crm-actions-panel";
import { CompanyEvidencePanel } from "../_components/company-evidence-panel";
import { CompanyEnrichmentButton } from "../_components/company-enrichment-button";
import { CompanyDiscoveryPanel } from "../_components/company-discovery-panel";
import { CompanyConversationsPanel, type ConversationThreadView } from "../_components/company-conversations-panel";
import { CompanyOpportunitiesPanel, type CompanyOpportunityRow } from "../_components/company-opportunities-panel";
import { CompanyDealsPanel, type CompanyDealRow } from "../_components/company-deals-panel";
import { CompanyDecisionMakersPanel, type CompanyDecisionMakerRow } from "../_components/company-decision-makers-panel";
import { CompanyDocumentsPanel, type CompanyDocumentRow } from "../_components/company-documents-panel";
import { CompanyTasksPanel, type CompanyTaskRow, type CompanyReminderRow } from "../_components/company-tasks-panel";
import { CompanyIntentScorePanel, type CompanyIntentScoreView, type IntentSignalView } from "../_components/company-intent-score-panel";
import { CompanyIntentHistoryPanel } from "../_components/company-intent-history-panel";
import { CompanyRecommendedActionPanel } from "../_components/company-recommended-action-panel";
import { CompanyIntentRecalculateButton } from "../_components/company-intent-recalculate-button";
import { getIntentRecommendedAction } from "@/lib/business-development/intent-recommendation";
import { CompanyResearchReportPanel } from "../_components/company-research-report-panel";
import { buildCompanyResearchReport } from "@/lib/business-development/company-research";
import { Client360SummaryPanel } from "../_components/client-360-summary-panel";
import { AskAiAboutClientPanel } from "../_components/ask-ai-about-client-panel";
import { LinkedInIntelligencePanel } from "../_components/linkedin-intelligence-panel";
import { getCompanyLinkedInIntelligence } from "@/lib/business-development/linkedin-intelligence";
import { buildClientSummary } from "@/lib/business-development/client-360";
import { ExportMenu } from "../_components/export-menu";
import { getCompanyCompleteTimeline } from "@/lib/business-development/company-complete-timeline";
import { summarizeCompanyConversation } from "@/lib/business-development/company-conversation-summary";
import { suggestNextActionForCompany } from "@/lib/business-development/company-next-action";
import { classifyEvidenceFreshness } from "@/lib/business-development/evidence-freshness";
import type { OpportunityScoreBreakdown } from "@/lib/business-development/opportunity-priority";
import type { TaskStatus } from "@/generated/prisma/client";

/** Plain helpers, not components — deliberately kept OUTSIDE CompanyDetailPage's body so "now" is read here, never inside the component's own render (React's purity rules flag `Date.now()` calls made directly inside a component). */
const DONE_TASK_STATUSES: TaskStatus[] = ["COMPLETED", "CANCELLED"];
function isOverdueTask(dueDate: Date | null, status: TaskStatus): boolean {
  return dueDate !== null && dueDate.getTime() < Date.now() && !DONE_TASK_STATUSES.includes(status);
}
function isPastReminder(remindAt: Date): boolean {
  return remindAt.getTime() < Date.now();
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { membership } = await requireActiveMembership(`/dashboard/companies/${id}`);

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      leads: { orderBy: { createdAt: "desc" }, take: 10 },
      clients: { orderBy: { createdAt: "desc" }, take: 10 },
      projects: { orderBy: { createdAt: "desc" }, take: 10 },
      proposals: { orderBy: { createdAt: "desc" }, take: 10 },
      leadScore: true,
      intelligenceRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      researchNotes: { orderBy: { createdAt: "desc" }, take: 20 },
      timelineEvents: { orderBy: { occurredAt: "desc" }, take: 50 },
      watchlistEntries: { select: { watchlistId: true } },
      evidence: { orderBy: { discoveredAt: "desc" }, take: 100 },
      referralPartner: { select: { id: true, name: true, type: true, commissionRatePercent: true } },
      intentScore: true,
      decisionMakers: { orderBy: { confidence: "desc" } },
      leadOpportunities: { orderBy: { createdAt: "desc" } },
      deals: {
        orderBy: { createdAt: "desc" },
        include: {
          dealStage: { select: { name: true } },
          owner: { select: { name: true, email: true } },
        },
      },
      tasks: {
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { assignedToUser: { select: { name: true, email: true } } },
      },
      reminders: { orderBy: { remindAt: "desc" }, take: 20 },
      contracts: { orderBy: { createdAt: "desc" }, take: 20 },
      invoices: { orderBy: { issueDate: "desc" }, take: 20 },
      quotations: { orderBy: { createdAt: "desc" }, take: 20 },
      subscriptions: { orderBy: { startDate: "desc" }, take: 20 },
      websiteScans: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          seoAudit: { select: { seoScore: true } },
          performanceAudit: { select: { performanceScore: true } },
          securityAudit: { select: { securityScore: true } },
          uxAudit: { select: { uxScore: true } },
          technologies: true,
        },
      },
    },
  });

  if (!company || company.organizationId !== membership.organizationId) {
    notFound();
  }

  const [watchlists, members, referralPartners, conversationContacts, completeTimeline, conversationSummary, nextAction] =
    await Promise.all([
      prisma.watchlist.findMany({
        where: { organizationId: membership.organizationId },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.membership.findMany({
        where: { organizationId: membership.organizationId, status: "ACTIVE" },
        select: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      // Only ACTIVE partners are offered for a NEW attribution (a CANDIDATE
      // hasn't been confirmed as a real relationship yet) — see
      // resolveReferralPartnerId's doc comment in companies/actions.ts. The
      // company's own currently-set partner is always included too (even if
      // since deactivated) via `company.referralPartner` below, so an existing
      // attribution is never silently hidden or dropped by re-saving the form.
      prisma.referralPartner.findMany({
        where: { organizationId: membership.organizationId, status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      // Phase 3 Email + Complete Client Conversation Center — this
      // company's real per-contact email/reply activity, used below to
      // compute the "Email & Conversations" stats and the per-contact
      // conversation list. Never a second source of truth for anything
      // sibling agents own (outreach/inbox.ts) — just a read of the same
      // real EmailDraft/Reply rows, scoped to this company's contacts.
      prisma.contact.findMany({
        where: { companyId: id, organizationId: membership.organizationId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          emailDrafts: {
            select: { id: true, subject: true, sentAt: true, createdAt: true, firstOpenedAt: true, firstClickedAt: true },
          },
          replies: { select: { id: true, receivedAt: true } },
        },
      }),
      getCompanyCompleteTimeline(membership.organizationId, id),
      summarizeCompanyConversation(membership.organizationId, id),
      suggestNextActionForCompany(membership.organizationId, id),
    ]);

  const canDelete = membership.role === "OWNER" || membership.role === "ADMIN";
  // If the company's currently-set partner isn't (or is no longer) ACTIVE,
  // still surface it as a selectable option in the edit form's dropdown so
  // saving the form without touching this field doesn't silently clear it.
  const referralPartnerOptions =
    company.referralPartner && !referralPartners.some((p) => p.id === company.referralPartner!.id)
      ? [...referralPartners, { id: company.referralPartner.id, name: company.referralPartner.name }]
      : referralPartners;
  const socialLinks = (company.socialLinks ?? {}) as { linkedin?: string; facebook?: string; twitter?: string; instagram?: string };
  const hasHQ = company.headquartersCity || company.headquartersState || company.headquartersCountry;
  const latestReport = company.intelligenceRuns[0] ?? null;
  const latestScanRow = company.websiteScans[0] ?? null;
  const latestScan = latestScanRow
    ? {
        id: latestScanRow.id,
        scannedAt: latestScanRow.scannedAt ? latestScanRow.scannedAt.toISOString() : null,
        seoScore: latestScanRow.seoAudit?.seoScore ?? null,
        performanceScore: latestScanRow.performanceAudit?.performanceScore ?? null,
        securityScore: latestScanRow.securityAudit?.securityScore ?? null,
        uxScore: latestScanRow.uxAudit?.uxScore ?? null,
        technologies: latestScanRow.technologies,
      }
    : null;

  // ===== Email & Conversations stats + per-contact thread list (real
  // EmailDraft/Reply data for this company's contacts only) =====
  let totalEmails = 0;
  let sentCount = 0;
  let openedCount = 0;
  let clickedCount = 0;
  let receivedCount = 0;
  let lastContactAt: Date | null = null;
  let lastReplyAt: Date | null = null;
  const conversationThreads: ConversationThreadView[] = [];

  for (const contact of conversationContacts) {
    totalEmails += contact.emailDrafts.length;
    receivedCount += contact.replies.length;

    let contactLastActivity: Date | null = null;
    let contactLastSubject: string | null = null;

    for (const draft of contact.emailDrafts) {
      if (draft.sentAt) {
        sentCount += 1;
        if (!lastContactAt || draft.sentAt > lastContactAt) lastContactAt = draft.sentAt;
        if (!contactLastActivity || draft.sentAt > contactLastActivity) {
          contactLastActivity = draft.sentAt;
          contactLastSubject = draft.subject;
        }
      } else if (!contactLastActivity || draft.createdAt > contactLastActivity) {
        contactLastActivity = draft.createdAt;
        contactLastSubject = draft.subject;
      }
      if (draft.firstOpenedAt) openedCount += 1;
      if (draft.firstClickedAt) clickedCount += 1;
    }

    for (const reply of contact.replies) {
      if (!lastReplyAt || reply.receivedAt > lastReplyAt) lastReplyAt = reply.receivedAt;
      if (!contactLastActivity || reply.receivedAt > contactLastActivity) contactLastActivity = reply.receivedAt;
    }

    if (contactLastActivity) {
      conversationThreads.push({
        contactId: contact.id,
        contactName: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email,
        contactEmail: contact.email,
        lastActivityAt: contactLastActivity.toISOString(),
        emailCount: contact.emailDrafts.length,
        replyCount: contact.replies.length,
        lastSubject: contactLastSubject,
      });
    }
  }
  conversationThreads.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

  const emailStats = {
    totalEmails,
    sent: sentCount,
    received: receivedCount,
    lastContactAt: lastContactAt ? (lastContactAt as Date).toISOString() : null,
    lastReplyAt: lastReplyAt ? (lastReplyAt as Date).toISOString() : null,
    // Never divide by zero into a fabricated 0% — no sent emails means no
    // real denominator to compute a rate from.
    openRate: sentCount > 0 ? Math.round((openedCount / sentCount) * 100) : null,
    clickRate: sentCount > 0 ? Math.round((clickedCount / sentCount) * 100) : null,
    replyRate: sentCount > 0 ? Math.round((receivedCount / sentCount) * 100) : null,
  };

  const completeTimelineView = completeTimeline.map((entry) => ({
    ...entry,
    occurredAt: entry.occurredAt.toISOString(),
  }));

  // ===== New panels' data shaping — every field below reads real, already-
  // fetched relations; nothing here is fabricated or recomputed from a
  // different source of truth. =====
  const opportunityRows: CompanyOpportunityRow[] = company.leadOpportunities.map((o) => ({
    id: o.id,
    title: o.title,
    description: o.description,
    estimatedValue: o.estimatedValue,
    opportunityScore: o.opportunityScore,
    opportunityScoreBreakdown: (o.opportunityScoreBreakdown as unknown as OpportunityScoreBreakdown | null) ?? null,
    priority: o.priority,
    priorityReasoning: o.priorityReasoning,
    status: o.status,
    recommendedService: o.recommendedService,
    nextStep: o.nextStep,
    createdAt: o.createdAt.toISOString(),
  }));

  const dealRows: CompanyDealRow[] = company.deals.map((d) => ({
    id: d.id,
    name: d.name,
    value: d.value,
    probability: d.probability,
    stageName: d.dealStage.name,
    expectedCloseDate: d.expectedCloseDate ? d.expectedCloseDate.toISOString() : null,
    ownerName: d.owner?.name ?? d.owner?.email ?? null,
    priority: d.priority,
  }));

  const decisionMakerRows: CompanyDecisionMakerRow[] = company.decisionMakers.map((dm) => ({
    id: dm.id,
    name: dm.name,
    role: dm.role,
    source: dm.source,
    sourceUrl: dm.sourceUrl,
    confidence: dm.confidence,
  }));

  const documentRows: CompanyDocumentRow[] = [
    ...company.contracts.map((c) => ({
      id: c.id,
      kind: "CONTRACT" as const,
      number: c.contractNumber,
      title: c.title,
      status: c.status,
      amount: c.value,
      date: (c.startDate ?? c.createdAt).toISOString(),
      href: `/dashboard/proposal/contracts/${c.id}`,
    })),
    ...company.invoices.map((i) => ({
      id: i.id,
      kind: "INVOICE" as const,
      number: i.invoiceNumber,
      title: "Invoice",
      status: i.status,
      amount: i.grandTotal,
      date: i.issueDate.toISOString(),
      href: `/dashboard/proposal/invoices/${i.id}`,
    })),
    ...company.quotations.map((q) => ({
      id: q.id,
      kind: "QUOTATION" as const,
      number: q.quotationNumber,
      title: q.title,
      status: q.status,
      amount: q.grandTotal,
      date: q.createdAt.toISOString(),
      href: `/dashboard/proposal/quotations/${q.id}`,
    })),
    ...company.subscriptions.map((s) => ({
      id: s.id,
      kind: "SUBSCRIPTION" as const,
      number: null,
      title: s.name,
      status: s.status,
      amount: s.amount,
      date: s.startDate.toISOString(),
      href: null,
    })),
  ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const taskRows: CompanyTaskRow[] = company.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    isOverdue: isOverdueTask(t.dueDate, t.status),
    assignedToName: t.assignedToUser?.name ?? t.assignedToUser?.email ?? null,
  }));

  const reminderRows: CompanyReminderRow[] = company.reminders.map((r) => ({
    id: r.id,
    title: r.title,
    remindAt: r.remindAt.toISOString(),
    dismissed: r.dismissed,
    isPast: isPastReminder(r.remindAt),
  }));

  const intentScoreView: CompanyIntentScoreView | null = company.intentScore
    ? {
        score: company.intentScore.score,
        band: company.intentScore.band,
        signals: company.intentScore.signals as unknown as IntentSignalView[],
        reasoning: company.intentScore.reasoning,
        scoredAt: company.intentScore.scoredAt.toISOString(),
        buyingStage: company.intentScore.buyingStage,
        buyingStageReasoning: company.intentScore.buyingStageReasoning,
        buyingStageConfidence: company.intentScore.buyingStageConfidence,
      }
    : null;

  const intentHistory = await prisma.intentScoreHistory.findMany({ where: { companyId: company.id }, orderBy: { calculatedAt: "asc" } });
  const recommendedAction = await getIntentRecommendedAction(company.id);
  const researchReport = await buildCompanyResearchReport(company.id);
  const clientSummary = await buildClientSummary(company.organizationId, company.id);
  const linkedinIntelligence = await getCompanyLinkedInIntelligence(company.organizationId, company.id);

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <Link
          href="/dashboard/companies"
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to Companies
        </Link>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {company.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logo} alt="" className="size-12 rounded-xl border border-border object-cover" />
              ) : (
                <span className="flex size-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
                  <Building2 className="size-6" />
                </span>
              )}
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{company.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{company.status}</Badge>
                  {company.industry && <Badge variant="outline">{company.industry}</Badge>}
                  {company.leadScore && <LeadScoreBadge band={company.leadScore.band} score={company.leadScore.overallScore} />}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ExportMenu companyId={company.id} />
              <WatchlistPicker
                companyId={company.id}
                watchlists={watchlists}
                memberOf={company.watchlistEntries.map((w) => w.watchlistId)}
              />
            </div>
          </div>
          <div className="gold-shimmer-line" />
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="opportunities">Opportunities ({opportunityRows.length})</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
            <TabsTrigger value="discovery">Discovery &amp; Evidence</TabsTrigger>
            <TabsTrigger value="conversations">Conversations ({emailStats.totalEmails + emailStats.received})</TabsTrigger>
            <TabsTrigger value="timeline">Timeline ({company.timelineEvents.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Client360SummaryPanel summary={clientSummary} />
              <AskAiAboutClientPanel companyId={company.id} />
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="flex flex-col gap-4 lg:col-span-2">
                {company.description && (
                  <Card glass>
                    <CardContent className="p-5 text-sm text-muted-foreground">{company.description}</CardContent>
                  </Card>
                )}

                {(company.technologies.length > 0 || company.products.length > 0 || company.servicesOffered.length > 0) && (
                  <Card glass>
                    <CardHeader>
                      <CardTitle className="text-base">Technology, products &amp; services</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 pt-0">
                      {company.technologies.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-xs font-semibold text-foreground">Technologies</p>
                          <div className="flex flex-wrap gap-1.5">
                            {company.technologies.map((t) => (
                              <Badge key={t} variant="accent">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {company.products.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-xs font-semibold text-foreground">Products</p>
                          <div className="flex flex-wrap gap-1.5">
                            {company.products.map((t) => (
                              <Badge key={t} variant="outline">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {company.servicesOffered.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-xs font-semibold text-foreground">Services offered</p>
                          <div className="flex flex-wrap gap-1.5">
                            {company.servicesOffered.map((t) => (
                              <Badge key={t} variant="outline">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {company.targetCustomers && (
                        <div>
                          <p className="mb-1 text-xs font-semibold text-foreground">Target customers</p>
                          <p className="text-sm text-muted-foreground">{company.targetCustomers}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {company.foundedYear && (
                    <Card glass>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground">Founded</p>
                        <p className="text-lg font-semibold text-foreground">{company.foundedYear}</p>
                      </CardContent>
                    </Card>
                  )}
                  {company.estimatedRevenue != null && (
                    <Card glass>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground">Estimated revenue</p>
                        <p className="text-lg font-semibold text-foreground">{formatCurrency(company.estimatedRevenue)}</p>
                      </CardContent>
                    </Card>
                  )}
                  {company.employeeCount != null && (
                    <Card glass>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground">Employees</p>
                        <p className="text-lg font-semibold text-foreground">{company.employeeCount.toLocaleString()}</p>
                      </CardContent>
                    </Card>
                  )}
                  {company.growthRate != null && (
                    <Card glass>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground">Growth rate</p>
                        <p className="text-lg font-semibold text-foreground">{company.growthRate}%</p>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {hasHQ && (
                  <Card glass>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <MapPin className="size-4" /> Headquarters
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 pt-0">
                      <p className="text-sm text-muted-foreground">
                        {[company.headquartersCity, company.headquartersState, company.headquartersCountry]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                      {company.latitude != null && company.longitude != null ? (
                        <CompanyMap lat={company.latitude} lng={company.longitude} name={company.name} />
                      ) : (
                        <p className="text-xs text-muted-foreground">No map pin yet — not geocoded.</p>
                      )}
                      {company.googleMapsUrl && (
                        <a
                          href={company.googleMapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          Open in Google Maps
                        </a>
                      )}
                    </CardContent>
                  </Card>
                )}

                <CompanyEditForm
                  companyId={company.id}
                  organizationId={company.organizationId}
                  canDelete={canDelete}
                  initial={{
                    name: company.name,
                    industry: company.industry ?? "",
                    website: company.website ?? "",
                    email: company.email ?? "",
                    phone: company.phone ?? "",
                    address: company.address ?? "",
                    employeeCount: company.employeeCount != null ? String(company.employeeCount) : "",
                    notes: company.notes ?? "",
                    status: company.status,
                    logo: company.logo ?? "",
                    description: company.description ?? "",
                    headquartersCountry: company.headquartersCountry ?? "",
                    headquartersState: company.headquartersState ?? "",
                    headquartersCity: company.headquartersCity ?? "",
                    estimatedRevenue: company.estimatedRevenue != null ? String(company.estimatedRevenue) : "",
                    foundedYear: company.foundedYear != null ? String(company.foundedYear) : "",
                    technologies: company.technologies.join(", "),
                    products: company.products.join(", "),
                    servicesOffered: company.servicesOffered.join(", "),
                    targetCustomers: company.targetCustomers ?? "",
                    linkedinUrl: socialLinks.linkedin ?? "",
                    facebookUrl: socialLinks.facebook ?? "",
                    twitterUrl: socialLinks.twitter ?? "",
                    instagramUrl: socialLinks.instagram ?? "",
                    googleMapsUrl: company.googleMapsUrl ?? "",
                    contactFormUrl: company.contactFormUrl ?? "",
                    businessType: company.businessType ?? "",
                    remoteHybrid: company.remoteHybrid ?? "",
                    publicPrivate: company.publicPrivate ?? "",
                    growthRate: company.growthRate != null ? String(company.growthRate) : "",
                    fundingStage: company.fundingStage ?? "",
                    fundingAmount: company.fundingAmount != null ? String(company.fundingAmount) : "",
                    fundingDate: company.fundingDate ? company.fundingDate.toISOString().slice(0, 10) : "",
                    language: company.language ?? "",
                    referralPartnerId: company.referralPartnerId ?? "",
                  }}
                  referralPartners={referralPartnerOptions}
                />
              </div>

              <div className="order-first flex flex-col gap-4 lg:order-none">
                <CrmActionsPanel
                  companyId={company.id}
                  hasLead={company.leads.length > 0}
                  ownerUserId={company.ownerUserId}
                  priority={company.priority}
                  members={members.map((m) => m.user)}
                />

                {company.referralPartner && (
                  <Card glass>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Handshake className="size-4" /> Referral partner
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <Link
                        href={`/dashboard/referral-partners/${company.referralPartner.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {company.referralPartner.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {partnerTypeLabel(company.referralPartner.type)} · {company.referralPartner.commissionRatePercent}%
                        commission rate
                      </p>
                    </CardContent>
                  </Card>
                )}

                <Card glass>
                  <CardHeader>
                    <CardTitle className="text-base">Contact intelligence</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2.5 pt-0 text-sm">
                    <div className="flex items-center gap-2">
                      <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                      {company.website ? (
                        <a href={company.website} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">
                          {company.website}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">Not available</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                      {company.email ? <span className="truncate">{company.email}</span> : <span className="text-muted-foreground">Not available</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                      {company.phone ? <span>{company.phone}</span> : <span className="text-muted-foreground">Not available</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                      {company.contactFormUrl ? (
                        <a href={company.contactFormUrl} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">
                          Contact form
                        </a>
                      ) : (
                        <span className="text-muted-foreground">Not available</span>
                      )}
                    </div>
                    {(socialLinks.linkedin || socialLinks.facebook || socialLinks.twitter || socialLinks.instagram) && (
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        {socialLinks.linkedin && (
                          <a
                            href={socialLinks.linkedin}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                          >
                            <Link2 className="size-3.5" /> LinkedIn
                          </a>
                        )}
                        {socialLinks.facebook && (
                          <a
                            href={socialLinks.facebook}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                          >
                            <Link2 className="size-3.5" /> Facebook
                          </a>
                        )}
                        {socialLinks.twitter && (
                          <a
                            href={socialLinks.twitter}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                          >
                            <Link2 className="size-3.5" /> Twitter / X
                          </a>
                        )}
                        {socialLinks.instagram && (
                          <a
                            href={socialLinks.instagram}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                          >
                            <Link2 className="size-3.5" /> Instagram
                          </a>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <LeadScorePanel companyId={company.id} score={company.leadScore ? { ...company.leadScore, scoredAt: company.leadScore.scoredAt.toISOString() } : null} />

                <CompanyIntentScorePanel intentScore={intentScoreView} />
                <CompanyIntentRecalculateButton companyId={company.id} />
                <CompanyRecommendedActionPanel action={recommendedAction} />
                <CompanyIntentHistoryPanel
                  history={intentHistory.map((h) => ({
                    previousScore: h.previousScore,
                    newScore: h.newScore,
                    scoreChange: h.scoreChange,
                    previousBand: h.previousBand,
                    newBand: h.newBand,
                    previousStage: h.previousStage,
                    newStage: h.newStage,
                    reason: h.reason,
                    triggerSignal: h.triggerSignal,
                    calculatedAt: h.calculatedAt.toISOString(),
                  }))}
                />

                <Card glass>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Users2 className="size-4" /> Leads ({company.leads.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 pt-0">
                    {company.leads.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No leads linked yet.</p>
                    ) : (
                      company.leads.map((lead) => (
                        <div key={lead.id} className="flex items-center justify-between text-sm">
                          <span className="text-foreground">{lead.name}</span>
                          {lead.estimatedValue != null && (
                            <span className="text-xs text-muted-foreground">{formatCurrency(lead.estimatedValue)}</span>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card glass>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FolderKanban className="size-4" /> Projects ({company.projects.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 pt-0">
                    {company.projects.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No projects linked yet.</p>
                    ) : (
                      company.projects.map((project) => (
                        <Link key={project.id} href={`/dashboard/projects/${project.id}`} className="flex items-center justify-between text-sm hover:text-primary">
                          <span>{project.name}</span>
                          <Badge variant="outline">{project.status}</Badge>
                        </Link>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card glass>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileText className="size-4" /> Proposals ({company.proposals.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 pt-0">
                    {company.proposals.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No proposals linked yet.</p>
                    ) : (
                      company.proposals.map((proposal) => (
                        <Link key={proposal.id} href={`/dashboard/proposal/proposals/${proposal.id}`} className="flex items-center justify-between text-sm hover:text-primary">
                          <span className="truncate">{proposal.title}</span>
                          <Badge variant="outline">{proposal.status}</Badge>
                        </Link>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="opportunities">
            <CompanyOpportunitiesPanel opportunities={opportunityRows} />
          </TabsContent>

          <TabsContent value="pipeline">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <CompanyDealsPanel deals={dealRows} />
              <CompanyDecisionMakersPanel decisionMakers={decisionMakerRows} />
              <CompanyDocumentsPanel documents={documentRows} />
              <CompanyTasksPanel tasks={taskRows} reminders={reminderRows} />
            </div>
          </TabsContent>

          <TabsContent value="intelligence">
            <CompanyIntelligencePanel
              companyId={company.id}
              latestReport={
                latestReport
                  ? {
                      ...latestReport,
                      createdAt: latestReport.createdAt.toISOString(),
                    }
                  : null
              }
              notes={company.researchNotes.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() }))}
            />
            {linkedinIntelligence && (
              <div className="mt-6">
                <LinkedInIntelligencePanel data={linkedinIntelligence} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="discovery">
            <div className="mb-4">
              <CompanyResearchReportPanel companyId={company.id} report={researchReport} />
            </div>
            <div className="mb-4">
              <CompanyEnrichmentButton
                companyId={company.id}
                enrichmentStatus={company.enrichmentStatus}
                lastEnrichedAt={company.lastEnrichedAt ? company.lastEnrichedAt.toISOString() : null}
                enrichmentFailureReason={company.enrichmentFailureReason}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <CompanyDiscoveryPanel
                website={company.website}
                socialLinks={socialLinks}
                technologies={company.technologies}
                latestScan={latestScan}
                sourceCount={company.sourceCount}
                discoverySources={company.discoverySources}
                lastDiscoveredAt={company.lastDiscoveredAt.toISOString()}
                createdAt={company.createdAt.toISOString()}
              />
              <CompanyEvidencePanel
                evidence={company.evidence.map((e) => ({
                  ...e,
                  discoveredAt: e.discoveredAt.toISOString(),
                  freshness: classifyEvidenceFreshness(e.discoveredAt, new Date(), company.leadOpportunities.length > 0),
                }))}
              />
            </div>
          </TabsContent>

          <TabsContent value="conversations">
            <CompanyConversationsPanel
              companyId={company.id}
              stats={emailStats}
              threads={conversationThreads}
              timeline={completeTimelineView}
              summary={conversationSummary}
              nextAction={nextAction}
            />
          </TabsContent>

          <TabsContent value="timeline">
            <CompanyTimeline
              events={company.timelineEvents.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() }))}
            />
          </TabsContent>
        </Tabs>
      </Container>
    </main>
  );
}
