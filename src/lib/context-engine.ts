import { prisma } from "@/lib/prisma";
import { withCache } from "@/lib/cache/redis-cache";
import { retrieveContext } from "@/lib/rag/retrieval";
import { computeGrowthSignals } from "@/lib/ai/executive-briefing";
import { EXECUTIVE_AGENT_TYPES, type ExecutiveAgentType } from "@/lib/ai/personas";

/**
 * The Context Engine — assembles ONE real context string for grounding an AI
 * agent call from multiple live sources (CRM, Projects, Meetings, Decisions,
 * Knowledge Base, Organization preferences). Every section below is either a
 * real Prisma query result or omitted entirely; nothing here ever fabricates
 * example data. Each section is clearly labeled with a `## Heading` so a
 * downstream prompt (or a human debugging one) can tell exactly where a
 * fact came from.
 *
 * Intentionally NOT wired into src/lib/ai/agent-runtime.ts here — that file
 * is owned by a parallel task this session. A later integration step calls
 * `buildAgentContext` from wherever an agent turn is assembled.
 */

export interface AgentContextOptions {
  /** Reserved for a future agent-scoped section (e.g. recent conversations for this specific agent); included in the cache key today so a future addition doesn't require a cache-key migration. */
  agentId?: string;
  dealId?: string;
  projectId?: string;
  clientQuery?: string;
  /**
   * The calling agent's real AIAgentInstance.type, when known. Only used to
   * decide whether to include `buildGrowthIntelligenceSection` below — every
   * other section here is unconditional and unaffected by this field. Kept
   * optional so every pre-existing caller that doesn't pass it behaves
   * byte-for-byte as before (no growth-intelligence section, same as today).
   */
  agentType?: ExecutiveAgentType;
}

const CONTEXT_CACHE_TTL_SECONDS = 60;

function formatDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

async function buildDealSection(organizationId: string, dealId: string): Promise<string | null> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    select: {
      name: true,
      value: true,
      probability: true,
      expectedCloseDate: true,
      notes: true,
      dealStage: { select: { name: true } },
      company: { select: { name: true, industry: true } },
      contact: { select: { firstName: true, lastName: true, email: true, jobTitle: true } },
    },
  });
  if (!deal) return null;

  const recentTasks = await prisma.task.findMany({
    where: { dealId, organizationId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { title: true, status: true, dueDate: true },
  });

  const lines: string[] = ["## Deal Context", `- Deal: ${deal.name} (stage: ${deal.dealStage.name})`];
  if (deal.value !== null) lines.push(`- Value: ${deal.value}`);
  if (deal.probability !== null) lines.push(`- Win probability: ${deal.probability}%`);
  const closeDate = formatDate(deal.expectedCloseDate);
  if (closeDate) lines.push(`- Expected close date: ${closeDate}`);
  if (deal.company) lines.push(`- Company: ${deal.company.name}${deal.company.industry ? ` (${deal.company.industry})` : ""}`);
  if (deal.contact) {
    const contactName = [deal.contact.firstName, deal.contact.lastName].filter(Boolean).join(" ");
    lines.push(`- Contact: ${contactName}${deal.contact.jobTitle ? `, ${deal.contact.jobTitle}` : ""} <${deal.contact.email}>`);
  }
  if (deal.notes) lines.push(`- Notes: ${deal.notes}`);
  if (recentTasks.length > 0) {
    lines.push("- Recent related tasks:");
    for (const task of recentTasks) {
      const due = formatDate(task.dueDate);
      lines.push(`  - ${task.title} [${task.status}]${due ? ` — due ${due}` : ""}`);
    }
  }
  return lines.join("\n");
}

async function buildProjectSection(organizationId: string, projectId: string): Promise<string | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      name: true,
      status: true,
      healthStatus: true,
      progress: true,
      dueDate: true,
      budget: true,
      company: { select: { name: true } },
      client: { select: { name: true } },
    },
  });
  if (!project) return null;

  const [openMilestones, openRisks, upcomingTasks] = await Promise.all([
    prisma.milestone.findMany({
      where: { projectId, project: { organizationId }, status: { not: "COMPLETED" } },
      orderBy: { dueDate: "asc" },
      take: 10,
      select: { name: true, status: true, dueDate: true },
    }),
    prisma.projectRisk.findMany({
      where: { projectId, organizationId, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { title: true, category: true, severity: true },
    }),
    prisma.task.findMany({
      where: {
        projectId,
        organizationId,
        dueDate: { gte: new Date() },
        status: { notIn: ["COMPLETED", "CANCELLED", "ARCHIVED"] },
      },
      orderBy: { dueDate: "asc" },
      take: 5,
      select: { title: true, dueDate: true },
    }),
  ]);

  const lines: string[] = [
    "## Project Context",
    `- Project: ${project.name} (status: ${project.status}, health: ${project.healthStatus}, progress: ${project.progress}%)`,
  ];
  if (project.company) lines.push(`- Company: ${project.company.name}`);
  if (project.client) lines.push(`- Client: ${project.client.name}`);
  const projectDue = formatDate(project.dueDate);
  if (projectDue) lines.push(`- Project due date: ${projectDue}`);
  if (project.budget !== null) lines.push(`- Budget: ${project.budget}`);

  if (openMilestones.length > 0) {
    lines.push("- Open milestones:");
    for (const milestone of openMilestones) {
      const due = formatDate(milestone.dueDate);
      lines.push(`  - ${milestone.name} [${milestone.status}]${due ? ` — due ${due}` : ""}`);
    }
  }
  if (openRisks.length > 0) {
    lines.push("- Open risks:");
    for (const risk of openRisks) lines.push(`  - ${risk.title} (${risk.category}, severity ${risk.severity})`);
  }
  if (upcomingTasks.length > 0) {
    lines.push("- Upcoming task deadlines:");
    for (const task of upcomingTasks) lines.push(`  - ${task.title} — due ${formatDate(task.dueDate)}`);
  }

  return lines.join("\n");
}

async function buildRecentMeetingsSection(organizationId: string): Promise<string | null> {
  const meetings = await prisma.meeting.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { title: true, status: true, startedAt: true, createdAt: true },
  });
  if (meetings.length === 0) return null;

  const lines = ["## Recent Meetings"];
  for (const meeting of meetings) {
    const date = formatDate(meeting.startedAt ?? meeting.createdAt);
    lines.push(`- ${meeting.title} [${meeting.status}]${date ? ` — ${date}` : ""}`);
  }
  return lines.join("\n");
}

async function buildRecentDecisionsSection(organizationId: string): Promise<string | null> {
  const decisions = await prisma.decision.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { topic: true, status: true, createdAt: true },
  });
  if (decisions.length === 0) return null;

  const lines = ["## Recent Decisions"];
  for (const decision of decisions) {
    lines.push(`- ${decision.topic} [${decision.status}] — ${formatDate(decision.createdAt)}`);
  }
  return lines.join("\n");
}

async function buildKnowledgeSection(organizationId: string, clientQuery: string): Promise<string | null> {
  const items = await retrieveContext(organizationId, clientQuery, { topK: 5 });
  if (items.length === 0) return null;

  const lines = ["## Knowledge Base"];
  for (const item of items) lines.push(`- ${item.title}: ${item.snippet}`);
  return lines.join("\n");
}

async function buildOrganizationPreferencesSection(organizationId: string): Promise<string | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true, currency: true, primaryMarket: true, workingHours: true },
  });
  if (!organization) return null;

  const lines: string[] = [];
  if (organization.timezone) lines.push(`- Timezone: ${organization.timezone}`);
  if (organization.currency) lines.push(`- Currency: ${organization.currency}`);
  if (organization.primaryMarket) lines.push(`- Primary market: ${organization.primaryMarket}`);
  if (organization.workingHours && typeof organization.workingHours === "object") {
    lines.push(`- Working hours: ${JSON.stringify(organization.workingHours)}`);
  }
  if (lines.length === 0) return null;

  return ["## Organization Preferences", ...lines].join("\n");
}

// The only 5 AIAgentInstance types this section is ever assembled for — the
// AI Executive Board / War Room's real participant set (same list
// EXECUTIVE_AGENT_TYPES/isExecutiveAgentType in meeting-orchestrator.ts
// already restrict live board meetings to). Every other agent type this app
// has (Proposal Review Board's FINANCE/LEGAL/CRM/ANALYTICS seats, the
// Delivery Board's PROJECT_MANAGER/QA_DIRECTOR/DEVOPS_DIRECTOR/
// DELIVERY_DIRECTOR seats, marketplace agents, etc.) has no real use for
// lead/opportunity/deal/proposal/referral pipeline data, so it's
// deliberately excluded from this section rather than added unconditionally.
const GROWTH_INTELLIGENCE_AGENT_TYPES = new Set<string>(EXECUTIVE_AGENT_TYPES);

/**
 * Real Phase 1-9 growth/pipeline intelligence — the same real, tested
 * `computeGrowthSignals()` (src/lib/ai/executive-briefing.ts) the AI CEO
 * Daily Brief already uses, reused directly here (never re-derived with a
 * second set of queries) so a live War Room meeting turn can ground its
 * discussion in real `LeadOpportunity`/`Reply`/`Deal`/`Proposal`/
 * `ReferralPartner` data instead of only generic memory/meetings/decisions.
 * Same real-fact-or-honest-fallback discipline as `buildDealSection` above:
 * every line is either a real number from `computeGrowthSignals` or an
 * explicit "not yet available" sentence — never a fabricated figure.
 */
export async function buildGrowthIntelligenceSection(organizationId: string): Promise<string | null> {
  const signals = await computeGrowthSignals(organizationId);

  const lines: string[] = ["## Real Growth Intelligence (as of now)"];

  lines.push(
    signals.newOpportunitiesCount > 0
      ? `- ${signals.newOpportunitiesCount} new opportunity(ies) detected since yesterday.`
      : "- No new opportunities detected since yesterday.",
  );
  lines.push(
    signals.hotOpportunitiesCount > 0
      ? `- ${signals.hotOpportunitiesCount} opportunity(ies) currently at HOT priority, awaiting action.`
      : "- No HOT-priority opportunities on record right now.",
  );

  if (signals.repliesByIntent.length > 0) {
    const intentLine = signals.repliesByIntent.map((r) => `${r.intent ?? "UNCLASSIFIED"}: ${r.count}`).join(", ");
    lines.push(`- Replies received since yesterday, by intent: ${intentLine}.`);
  } else {
    lines.push("- No replies received since yesterday.");
  }

  lines.push(
    signals.atRiskDealsCount > 0
      ? `- ${signals.atRiskDealsCount} open deal(s) with no activity in 14+ days (at risk).`
      : "- No open deals have gone quiet for 14+ days.",
  );

  lines.push(
    signals.pendingProposalsCount > 0
      ? `- ${signals.pendingProposalsCount} proposal(s) pending response (oldest: ${signals.oldestPendingProposalAgeDays} day(s)).`
      : "- No proposals are currently pending a response.",
  );

  lines.push(
    signals.referralPartnerCandidatesCount > 0
      ? `- ${signals.referralPartnerCandidatesCount} referral-partner candidate(s) awaiting review.`
      : "- No referral partner candidates awaiting review.",
  );

  return lines.join("\n");
}

/**
 * Assembles a single real context string for grounding an AI agent call.
 * Cached per `(organizationId, options)` for a short TTL via `withCache`
 * (see src/lib/cache/redis-cache.ts) since this may run on every agent turn
 * and shouldn't re-issue the same handful of queries within the same
 * second. Every section is optional and only appears when real data backs
 * it — an org with nothing yet returns an honest "no context available"
 * string rather than a padded-out empty template.
 */
export async function buildAgentContext(organizationId: string, options: AgentContextOptions = {}): Promise<string> {
  const cacheKey = `context-engine:${organizationId}:${JSON.stringify(options)}`;

  return withCache(cacheKey, CONTEXT_CACHE_TTL_SECONDS, async () => {
    const sections: Array<string | null> = [];

    if (options.dealId) sections.push(await buildDealSection(organizationId, options.dealId));
    if (options.projectId) sections.push(await buildProjectSection(organizationId, options.projectId));
    if (options.agentType && GROWTH_INTELLIGENCE_AGENT_TYPES.has(options.agentType)) {
      sections.push(await buildGrowthIntelligenceSection(organizationId));
    }
    sections.push(await buildRecentMeetingsSection(organizationId));
    sections.push(await buildRecentDecisionsSection(organizationId));
    if (options.clientQuery) sections.push(await buildKnowledgeSection(organizationId, options.clientQuery));
    sections.push(await buildOrganizationPreferencesSection(organizationId));

    const realSections = sections.filter((section): section is string => section !== null);
    if (realSections.length === 0) return "No real context is currently available for this organization.";
    return realSections.join("\n\n");
  });
}
