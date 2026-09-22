import { prisma } from "@/lib/prisma";

export type SearchResultKind =
  | "meeting"
  | "task"
  | "decision"
  | "lead"
  | "conversation"
  | "notification"
  | "agent"
  | "company"
  | "client"
  | "project"
  | "proposal"
  | "document"
  | "article"
  | "watchlist"
  | "savedSearch"
  | "companyIntelligence"
  | "websiteScan"
  | "contact"
  | "campaign"
  | "deal"
  | "quotation"
  | "contract"
  | "invoice"
  | "businessDocument"
  | "projectRisk"
  | "ingestedDocument"
  // Phase 23 — Career engine entities (Section 14's "Jobs, Candidates,
  // Applications" requirement; there is no separate Candidate model in
  // this codebase — CareerProfile is the equivalent real entity, see the
  // Phase 23 report section K).
  | "job"
  | "careerApplication"
  | "careerProfile";

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const RESULT_LIMIT_PER_KIND = 5;

/**
 * Global search across everything an organization actually has real rows
 * for. Every result is a live DB row.
 */
export async function globalSearch(organizationId: string, query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const [
    meetings,
    tasks,
    decisions,
    leads,
    conversations,
    notifications,
    agents,
    companies,
    clients,
    projects,
    proposals,
    documents,
    articles,
    watchlists,
    savedSearches,
    companyIntelligenceRuns,
    websiteScans,
    contacts,
    campaigns,
    deals,
    quotations,
    contracts,
    invoices,
    businessDocuments,
    projectRisks,
    ingestedDocuments,
    careerJobs,
    careerApplications,
    careerProfiles,
  ] = await Promise.all([
    prisma.meeting.findMany({
      where: { organizationId, OR: [{ title: { contains: q, mode: "insensitive" } }, { agenda: { contains: q, mode: "insensitive" } }] },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.task.findMany({
      where: { organizationId, OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.decision.findMany({
      where: { organizationId, OR: [{ topic: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.lead.findMany({
      where: {
        pipelineStage: { workspace: { organizationId } },
        OR: [{ name: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }],
      },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentConversation.findMany({
      where: { organizationId, OR: [{ content: { contains: q, mode: "insensitive" } }, { reason: { contains: q, mode: "insensitive" } }] },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.notification.findMany({
      where: { organizationId, OR: [{ title: { contains: q, mode: "insensitive" } }, { message: { contains: q, mode: "insensitive" } }] },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.aIAgentInstance.findMany({
      where: { organizationId, name: { contains: q, mode: "insensitive" } },
      take: RESULT_LIMIT_PER_KIND,
    }),
    prisma.company.findMany({
      // Phase 24 (requirement #13, searchability): domain/website added —
      // a user searching "acme.com" previously never matched a company
      // whose name doesn't literally contain that string, even though
      // domain is often the more reliable real-world search key for a B2B
      // data tool.
      where: {
        organizationId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { industry: { contains: q, mode: "insensitive" } },
          { domain: { contains: q, mode: "insensitive" } },
          { website: { contains: q, mode: "insensitive" } },
        ],
      },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.client.findMany({
      where: { organizationId, OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.project.findMany({
      where: { organizationId, OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.proposal.findMany({
      where: { organizationId, title: { contains: q, mode: "insensitive" } },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.document.findMany({
      where: { organizationId, name: { contains: q, mode: "insensitive" } },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.knowledgeArticle.findMany({
      where: {
        knowledgeBase: { workspace: { organizationId } },
        OR: [{ title: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }],
      },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.watchlist.findMany({
      where: { organizationId, OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.savedSearch.findMany({
      where: { organizationId, name: { contains: q, mode: "insensitive" } },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.companyIntelligence.findMany({
      where: {
        company: { organizationId },
        OR: [{ businessSummary: { contains: q, mode: "insensitive" } }, { recommendedSolution: { contains: q, mode: "insensitive" } }],
      },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
      include: { company: { select: { id: true, name: true } } },
    }),
    prisma.websiteScan.findMany({
      where: {
        organizationId,
        OR: [
          { url: { contains: q, mode: "insensitive" } },
          { websiteName: { contains: q, mode: "insensitive" } },
          { companyNameInput: { contains: q, mode: "insensitive" } },
        ],
      },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.contact.findMany({
      where: {
        organizationId,
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ],
      },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.campaign.findMany({
      where: { organizationId, name: { contains: q, mode: "insensitive" } },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.deal.findMany({
      where: { organizationId, name: { contains: q, mode: "insensitive" } },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.quotation.findMany({
      where: { organizationId, OR: [{ title: { contains: q, mode: "insensitive" } }, { quotationNumber: { contains: q, mode: "insensitive" } }] },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.contract.findMany({
      where: { organizationId, OR: [{ title: { contains: q, mode: "insensitive" } }, { contractNumber: { contains: q, mode: "insensitive" } }] },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.invoice.findMany({
      where: { organizationId, invoiceNumber: { contains: q, mode: "insensitive" } },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.businessDocument.findMany({
      where: { organizationId, title: { contains: q, mode: "insensitive" } },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.projectRisk.findMany({
      where: { organizationId, OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    // RAG-ingested source documents (see src/lib/rag/*) — separate from the
    // "document" kind above, which is the org's uploaded-file Document model.
    prisma.ingestedDocument.findMany({
      where: { organizationId, title: { contains: q, mode: "insensitive" } },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    // Job is deliberately NOT organizationId-scoped (Phase 19: a real
    // external job posting is the same fact regardless of discovering
    // org) — scoped here to jobs this org has actually matched against,
    // via JobMatch, so search stays meaningfully org-relevant rather than
    // surfacing every org's discovered jobs.
    prisma.job.findMany({
      where: {
        OR: [{ title: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }],
        matches: { some: { organizationId } },
      },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    prisma.jobApplication.findMany({
      where: { organizationId, job: { OR: [{ title: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }] } },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
      include: { job: { select: { title: true, company: true } } },
    }),
    prisma.careerProfile.findMany({
      where: { organizationId, OR: [{ name: { contains: q, mode: "insensitive" } }, { currentRole: { contains: q, mode: "insensitive" } }] },
      take: RESULT_LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const results: SearchResult[] = [
    ...meetings.map((m) => ({
      kind: "meeting" as const,
      id: m.id,
      title: m.title,
      subtitle: m.status,
      href: `/board/meetings/${m.id}`,
    })),
    ...tasks.map((t) => ({
      kind: "task" as const,
      id: t.id,
      title: t.title,
      subtitle: t.status,
      href: `/board/tasks`,
    })),
    ...decisions.map((d) => ({
      kind: "decision" as const,
      id: d.id,
      title: d.topic,
      subtitle: d.status,
      href: d.meetingId ? `/board/meetings/${d.meetingId}` : `/board`,
    })),
    ...leads.map((l) => ({
      kind: "lead" as const,
      id: l.id,
      title: l.name,
      subtitle: l.company ?? undefined,
      href: `/board`,
    })),
    ...conversations.map((c) => ({
      kind: "conversation" as const,
      id: c.id,
      title: c.reason,
      subtitle: c.content.slice(0, 80),
      href: `/board/chat`,
    })),
    ...notifications.map((n) => ({
      kind: "notification" as const,
      id: n.id,
      title: n.title,
      subtitle: n.message.slice(0, 80),
      href: `/board`,
    })),
    ...agents.map((a) => ({
      kind: "agent" as const,
      id: a.id,
      title: a.name,
      subtitle: a.type,
      href: `/board`,
    })),
    ...companies.map((c) => ({
      kind: "company" as const,
      id: c.id,
      title: c.name,
      subtitle: c.industry ?? undefined,
      href: `/dashboard/companies/${c.id}`,
    })),
    ...clients.map((c) => ({
      kind: "client" as const,
      id: c.id,
      title: c.name,
      subtitle: c.email ?? undefined,
      href: `/dashboard/crm/pipeline`,
    })),
    ...projects.map((p) => ({
      kind: "project" as const,
      id: p.id,
      title: p.name,
      subtitle: p.status,
      href: `/dashboard/projects/${p.id}`,
    })),
    ...proposals.map((p) => ({
      kind: "proposal" as const,
      id: p.id,
      title: p.title,
      subtitle: p.status,
      href: `/dashboard/proposal/proposals/${p.id}`,
    })),
    ...documents.map((d) => ({
      kind: "document" as const,
      id: d.id,
      title: d.name,
      subtitle: d.folder ?? undefined,
      href: `/dashboard/documents`,
    })),
    ...articles.map((a) => ({
      kind: "article" as const,
      id: a.id,
      title: a.title,
      subtitle: a.tags.slice(0, 3).join(", ") || undefined,
      href: `/dashboard/knowledge-base/${a.id}`,
    })),
    ...watchlists.map((w) => ({
      kind: "watchlist" as const,
      id: w.id,
      title: w.name,
      subtitle: w.description ?? undefined,
      href: `/dashboard/watchlists/${w.id}`,
    })),
    ...savedSearches.map((s) => ({
      kind: "savedSearch" as const,
      id: s.id,
      title: s.name,
      subtitle: "Saved search",
      href: `/dashboard/lead-finder`,
    })),
    ...companyIntelligenceRuns.map((r) => ({
      kind: "companyIntelligence" as const,
      id: r.id,
      title: `Intelligence report: ${r.company.name}`,
      subtitle: r.businessSummary.slice(0, 80),
      href: `/dashboard/companies/${r.company.id}`,
    })),
    ...websiteScans.map((s) => ({
      kind: "websiteScan" as const,
      id: s.id,
      title: s.websiteName || s.companyNameInput || s.url,
      subtitle: s.status,
      href: `/dashboard/website-scanner/${s.id}`,
    })),
    ...contacts.map((c) => ({
      kind: "contact" as const,
      id: c.id,
      title: `${c.firstName} ${c.lastName ?? ""}`.trim(),
      subtitle: c.email,
      href: `/dashboard/outreach/contacts/${c.id}`,
    })),
    ...campaigns.map((c) => ({
      kind: "campaign" as const,
      id: c.id,
      title: c.name,
      subtitle: c.status,
      href: `/dashboard/outreach/campaigns/${c.id}`,
    })),
    ...deals.map((d) => ({
      kind: "deal" as const,
      id: d.id,
      title: d.name,
      subtitle: d.value != null ? String(d.value) : undefined,
      href: `/dashboard/crm/deals/${d.id}`,
    })),
    ...quotations.map((q) => ({
      kind: "quotation" as const,
      id: q.id,
      title: q.title,
      subtitle: q.quotationNumber,
      href: `/dashboard/proposal/quotations/${q.id}`,
    })),
    ...contracts.map((c) => ({
      kind: "contract" as const,
      id: c.id,
      title: c.title,
      subtitle: c.contractNumber,
      href: `/dashboard/proposal/contracts/${c.id}`,
    })),
    ...invoices.map((inv) => ({
      kind: "invoice" as const,
      id: inv.id,
      title: inv.invoiceNumber,
      subtitle: inv.status,
      href: `/dashboard/proposal/invoices/${inv.id}`,
    })),
    ...businessDocuments.map((d) => ({
      kind: "businessDocument" as const,
      id: d.id,
      title: d.title,
      subtitle: d.kind.replace(/_/g, " "),
      href: `/dashboard/proposal/documents/${d.id}`,
    })),
    ...projectRisks.map((r) => ({
      kind: "projectRisk" as const,
      id: r.id,
      title: r.title,
      subtitle: `${r.severity} · ${r.category.replace(/_/g, " ")}`,
      href: `/dashboard/projects/${r.projectId}/risks`,
    })),
    ...ingestedDocuments.map((d) => ({
      kind: "ingestedDocument" as const,
      id: d.id,
      title: d.title,
      subtitle: d.status,
      href: `/dashboard/knowledge-base/documents/${d.id}`,
    })),
    ...careerJobs.map((j) => ({
      kind: "job" as const,
      id: j.id,
      title: j.title,
      subtitle: j.company,
      href: `/dashboard/career/jobs/${j.id}`,
    })),
    ...careerApplications.map((a) => ({
      kind: "careerApplication" as const,
      id: a.id,
      title: `${a.job.title} @ ${a.job.company}`,
      subtitle: a.status,
      href: `/dashboard/career/applications/${a.id}`,
    })),
    ...careerProfiles.map((p) => ({
      kind: "careerProfile" as const,
      id: p.id,
      title: p.name,
      subtitle: p.currentRole ?? undefined,
      href: `/dashboard/career/profile/${p.id}`,
    })),
  ];

  return results;
}
