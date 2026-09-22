import { prisma } from "@/lib/prisma";
import { KVL_SERVICES } from "@/lib/business-development/kvl-service-catalog";
import type { AttributionType, AttributionConfidence, CompanySource, RevenueAttribution } from "@/generated/prisma/client";

/**
 * Phase 7 — Revenue Attribution Engine.
 *
 * ===== Revenue anchor =====
 * There is no dedicated Revenue or Payment model in this schema. Client 360
 * (`client-360.ts`'s `deriveRevenue`) already established `Invoice.amountPaid`
 * as the one authoritative real "paid revenue" figure — reused here, not
 * redefined. One `RevenueAttribution` row is computed per real Invoice with
 * `amountPaid > 0`; `invoiceId` plays the role the spec's illustrative
 * `revenue_id`/`payment_id` would have played had those models existed.
 *
 * ===== NOT the same number as acquisition-funnel.ts =====
 * `src/lib/analytics/acquisition-funnel.ts` sums `Deal.value` on Won deals —
 * that is deal/pipeline value, not paid revenue, and it is left untouched.
 * Every view here is real PAID revenue and should be captioned accordingly
 * wherever it's rendered.
 *
 * ===== The default attribution model (v1) =====
 * Deterministic, no AI. For a given paid Invoice, resolve its Company (via
 * Invoice.dealId -> Deal.companyId, else Invoice.companyId, else
 * Invoice.clientId -> Client.companyId). Then collect every independently
 * PROVEN touchpoint for that company:
 *
 *   - CAMPAIGN touchpoints: a campaign only counts when a real, SENT
 *     EmailDraft with that campaignId went to a real contact of this
 *     company AND that same contact sent back a real Reply (matched by
 *     campaignId or emailDraftId) — enrollment/audience membership alone
 *     (CampaignContact) is never sufficient (this is the exact "attributed
 *     merely because the company was in the campaign audience" anti-pattern
 *     the spec forbids, and the one real gap found in
 *     acquisition-funnel.ts's own computeByCampaign during the Phase 7
 *     audit).
 *   - SOURCE touchpoint: `Company.source` counts only when it is a real,
 *     non-MANUAL value (LEAD_FINDER/CLIENT_FINDER/WEBSITE_SCANNER/
 *     AUTO_DISCOVERY/REFERRAL) — MANUAL means "no real acquisition signal
 *     recorded", never treated as a touchpoint.
 *
 * Classification:
 *   0 touchpoints  -> UNKNOWN   (cannot prove any acquisition path)
 *   1 touchpoint   -> DIRECT    (the one real, unambiguous chain)
 *   2+ touchpoints -> ASSISTED  (every touchpoint recorded, no winner picked)
 *
 * IntentScore/ConversationIntelligence signals are shown in the evidence
 * chain as CONTRIBUTING SIGNAL only — they never count as a touchpoint and
 * never change the classification (§16).
 */

// ===== Evidence chain types =====

export type EvidenceProofType = "DIRECT_FK" | "COMPANY_ASSOCIATION" | "CONTRIBUTING_SIGNAL";

export interface EvidenceLink {
  stage: string;
  recordType: string;
  recordId: string;
  proofType: EvidenceProofType;
  occurredAt: string | null;
  description: string;
}

export interface Touchpoint {
  type: "CAMPAIGN" | "SOURCE";
  id: string;
  label: string;
  evidenceSummary: string;
}

export interface DataQualityFlag {
  code: string;
  description: string;
}

const REAL_MEETING_STATUSES = ["CONFIRMED", "COMPLETED"] as const;
const ATTRIBUTION_MODEL = "v1";

// ===== Company resolution =====

async function resolveCompanyIdForInvoice(invoice: {
  companyId: string | null;
  dealId: string | null;
  clientId: string | null;
}): Promise<{ companyId: string | null; dealCompanyId: string | null }> {
  if (invoice.dealId) {
    const deal = await prisma.deal.findUnique({ where: { id: invoice.dealId }, select: { companyId: true } });
    if (deal?.companyId) return { companyId: deal.companyId, dealCompanyId: deal.companyId };
  }
  if (invoice.companyId) return { companyId: invoice.companyId, dealCompanyId: null };
  if (invoice.clientId) {
    const client = await prisma.client.findUnique({ where: { id: invoice.clientId }, select: { companyId: true } });
    if (client?.companyId) return { companyId: client.companyId, dealCompanyId: null };
  }
  return { companyId: null, dealCompanyId: null };
}

/**
 * Real, proven campaign engagement for a company: a SENT EmailDraft with a
 * campaignId, to a real contact of this company, that received a real Reply
 * from the same contact referencing the same campaign or the same draft.
 * Audience enrollment (CampaignContact) alone never counts.
 */
async function findEngagedCampaigns(companyId: string): Promise<
  Array<{ campaignId: string; campaignName: string; emailDraftId: string; replyId: string; contactId: string; sentAt: Date | null; repliedAt: Date }>
> {
  const sentDrafts = await prisma.emailDraft.findMany({
    where: { status: "SENT", campaignId: { not: null }, contact: { companyId } },
    select: { id: true, campaignId: true, contactId: true, sentAt: true, campaign: { select: { name: true } } },
  });
  if (sentDrafts.length === 0) return [];

  const replies = await prisma.reply.findMany({
    where: { contact: { companyId }, OR: [{ campaignId: { not: null } }, { emailDraftId: { not: null } }] },
    select: { id: true, campaignId: true, emailDraftId: true, contactId: true, receivedAt: true },
  });

  const engaged: Array<{ campaignId: string; campaignName: string; emailDraftId: string; replyId: string; contactId: string; sentAt: Date | null; repliedAt: Date }> = [];
  const seenCampaigns = new Set<string>();
  for (const draft of sentDrafts) {
    if (!draft.campaignId || seenCampaigns.has(draft.campaignId)) continue;
    const matchingReply = replies.find(
      (r) => r.contactId === draft.contactId && (r.campaignId === draft.campaignId || r.emailDraftId === draft.id),
    );
    if (!matchingReply) continue;
    seenCampaigns.add(draft.campaignId);
    engaged.push({
      campaignId: draft.campaignId,
      campaignName: draft.campaign?.name ?? draft.campaignId,
      emailDraftId: draft.id,
      replyId: matchingReply.id,
      contactId: draft.contactId,
      sentAt: draft.sentAt,
      repliedAt: matchingReply.receivedAt,
    });
  }
  return engaged;
}

/**
 * Computes (or recomputes) the deterministic v1 attribution for one real
 * paid Invoice and upserts the single, idempotent RevenueAttribution row
 * for it (§45 — the compound unique key on organizationId+invoiceId+
 * attributionModel guarantees rerunning this never creates a duplicate).
 * Returns null when the invoice doesn't belong to this org, or isn't paid.
 */
export async function computeAttributionForInvoice(organizationId: string, invoiceId: string): Promise<RevenueAttribution | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice || invoice.organizationId !== organizationId) return null;
  if (invoice.amountPaid <= 0) return null;

  const dataQualityFlags: DataQualityFlag[] = [];
  const evidence: EvidenceLink[] = [];

  evidence.push({
    stage: "INVOICE",
    recordType: "Invoice",
    recordId: invoice.id,
    proofType: "DIRECT_FK",
    occurredAt: invoice.issueDate.toISOString(),
    description: `Invoice ${invoice.invoiceNumber}, grand total ${invoice.grandTotal}.`,
  });
  evidence.push({
    stage: "PAYMENT_REVENUE",
    recordType: "Invoice",
    recordId: invoice.id,
    proofType: "DIRECT_FK",
    occurredAt: (invoice.paidAt ?? invoice.issueDate).toISOString(),
    description: `Real paid amount ${invoice.amountPaid} (this schema tracks payment/revenue as Invoice.amountPaid — no separate Payment/Revenue model exists).`,
  });

  if (!invoice.dealId) dataQualityFlags.push({ code: "ORPHAN_INVOICE_NO_DEAL", description: "Invoice has no dealId — cannot trace an Opportunity/Proposal/Deal chain." });

  const deal = invoice.dealId ? await prisma.deal.findUnique({ where: { id: invoice.dealId } }) : null;
  if (deal) {
    evidence.push({ stage: "DEAL", recordType: "Deal", recordId: deal.id, proofType: "DIRECT_FK", occurredAt: null, description: `Deal "${deal.name}".` });
  }

  const { companyId } = await resolveCompanyIdForInvoice(invoice);
  if (!companyId) {
    dataQualityFlags.push({ code: "ORPHAN_INVOICE_NO_COMPANY", description: "No company could be resolved for this invoice via deal/company/client." });
    return upsertAttribution(organizationId, invoice, {
      dealId: deal?.id ?? null,
      companyId: null,
      contactId: null,
      leadId: null,
      opportunityId: null,
      proposalId: null,
      meetingId: null,
      replyId: null,
      emailDraftId: null,
      campaignId: null,
      source: null,
      attributionType: "UNKNOWN",
      confidence: "LOW",
      attributionRule: "NO_COMPANY_LINK_V1",
      evidence,
      touchpoints: [],
      dataQualityFlags,
    });
  }

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    dataQualityFlags.push({ code: "MISSING_COMPANY_RECORD", description: `Resolved companyId ${companyId} but no real Company row exists.` });
    return upsertAttribution(organizationId, invoice, {
      dealId: deal?.id ?? null,
      companyId: null,
      contactId: null,
      leadId: null,
      opportunityId: null,
      proposalId: null,
      meetingId: null,
      replyId: null,
      emailDraftId: null,
      campaignId: null,
      source: null,
      attributionType: "UNKNOWN",
      confidence: "LOW",
      attributionRule: "MISSING_COMPANY_RECORD_V1",
      evidence,
      touchpoints: [],
      dataQualityFlags,
    });
  }

  evidence.push({ stage: "COMPANY", recordType: "Company", recordId: company.id, proofType: "DIRECT_FK", occurredAt: company.createdAt.toISOString(), description: `${company.name}.` });

  // ===== Lead (Deal.sourceLeadId) =====
  let leadId: string | null = null;
  if (deal?.sourceLeadId) {
    const lead = await prisma.lead.findUnique({ where: { id: deal.sourceLeadId } });
    if (lead) {
      leadId = lead.id;
      evidence.push({ stage: "LEAD", recordType: "Lead", recordId: lead.id, proofType: "DIRECT_FK", occurredAt: null, description: `Lead "${lead.name}"${lead.referredByClientId ? " (real referral — referredByClientId set)." : "."}` });
    }
  }

  // ===== Contributing signal: IntentScore (never a touchpoint) =====
  const intentScore = await prisma.intentScore.findUnique({ where: { companyId: company.id } });
  if (intentScore) {
    evidence.push({
      stage: "INTENT_SIGNAL",
      recordType: "IntentScore",
      recordId: intentScore.id,
      proofType: "CONTRIBUTING_SIGNAL",
      occurredAt: intentScore.scoredAt.toISOString(),
      description: `Buying-intent band ${intentScore.band} — a contributing signal only, never revenue-causal on its own (§16).`,
    });
  }

  // ===== Campaign engagement (real SENT + real REPLY) =====
  const engagedCampaigns = await findEngagedCampaigns(company.id);
  for (const c of engagedCampaigns) {
    evidence.push({ stage: "OUTREACH", recordType: "EmailDraft", recordId: c.emailDraftId, proofType: "DIRECT_FK", occurredAt: c.sentAt?.toISOString() ?? null, description: `Real SENT email via campaign "${c.campaignName}".` });
    evidence.push({ stage: "REPLY", recordType: "Reply", recordId: c.replyId, proofType: "DIRECT_FK", occurredAt: c.repliedAt.toISOString(), description: `Real inbound reply, same contact, same campaign.` });
  }

  // ===== Real meeting for this company (any real contact) =====
  const meeting = await prisma.outreachMeeting.findFirst({
    where: { contact: { companyId: company.id }, status: { in: [...REAL_MEETING_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });
  if (meeting) {
    evidence.push({ stage: "MEETING", recordType: "OutreachMeeting", recordId: meeting.id, proofType: "DIRECT_FK", occurredAt: meeting.createdAt.toISOString(), description: `Real meeting, status ${meeting.status}.` });
  }

  // ===== Opportunity — direct FK when the Deal was converted via
  // addOpportunityToCrmCore (Phase 13+); falls back to a company-level
  // association only for Deals created before Deal.sourceOpportunityId
  // existed, or created directly in the CRM with no opportunity at all. =====
  const opportunity = deal?.sourceOpportunityId
    ? await prisma.leadOpportunity.findUnique({ where: { id: deal.sourceOpportunityId } })
    : await prisma.leadOpportunity.findFirst({ where: { companyId: company.id }, orderBy: { createdAt: "desc" } });
  if (opportunity) {
    const isDirectFk = opportunity.id === deal?.sourceOpportunityId;
    evidence.push({
      stage: "OPPORTUNITY",
      recordType: "LeadOpportunity",
      recordId: opportunity.id,
      proofType: isDirectFk ? "DIRECT_FK" : "COMPANY_ASSOCIATION",
      occurredAt: opportunity.createdAt.toISOString(),
      description: isDirectFk
        ? `Real AI-detected opportunity "${opportunity.title}" — directly linked via Deal.sourceOpportunityId.`
        : `Real AI-detected opportunity "${opportunity.title}" for this company — associated by company (this Deal predates Deal.sourceOpportunityId or was created directly in the CRM).`,
    });
  }

  // ===== Proposal — prefer one directly linked to this Deal =====
  const proposal = deal
    ? await prisma.proposal.findFirst({ where: { dealId: deal.id }, orderBy: { createdAt: "desc" } })
    : await prisma.proposal.findFirst({ where: { companyId: company.id }, orderBy: { createdAt: "desc" } });
  if (proposal) {
    evidence.push({
      stage: "PROPOSAL",
      recordType: "Proposal",
      recordId: proposal.id,
      proofType: proposal.dealId === deal?.id ? "DIRECT_FK" : "COMPANY_ASSOCIATION",
      occurredAt: proposal.sentAt?.toISOString() ?? null,
      description: `Proposal "${proposal.title}", status ${proposal.status}.`,
    });
  }

  // ===== Contact =====
  const contactId = deal?.contactId ?? engagedCampaigns[0]?.contactId ?? null;
  if (contactId) {
    evidence.push({ stage: "CONTACT", recordType: "Contact", recordId: contactId, proofType: "DIRECT_FK", occurredAt: null, description: "Real contact tied to this deal/engagement." });
  }

  // ===== Touchpoint classification =====
  const touchpoints: Touchpoint[] = engagedCampaigns.map((c) => ({
    type: "CAMPAIGN" as const,
    id: c.campaignId,
    label: c.campaignName,
    evidenceSummary: `SENT EmailDraft ${c.emailDraftId} + real Reply ${c.replyId} from the same contact.`,
  }));

  const realSource: CompanySource | null = company.source !== "MANUAL" ? company.source : null;
  if (realSource) {
    touchpoints.push({ type: "SOURCE", id: realSource, label: realSource, evidenceSummary: `Company.source = ${realSource} (original, never-overwritten discovery source).` });
    evidence.push({ stage: "SOURCE", recordType: "CompanySource", recordId: realSource, proofType: "COMPANY_ASSOCIATION", occurredAt: null, description: `Original discovery source: ${realSource}.` });
  }

  let attributionType: AttributionType;
  let confidence: AttributionConfidence;
  let attributionRule: string;
  let campaignId: string | null = null;

  if (touchpoints.length === 0) {
    attributionType = "UNKNOWN";
    confidence = "LOW";
    attributionRule = "NO_PROVEN_TOUCHPOINT_V1";
  } else if (touchpoints.length === 1) {
    attributionType = "DIRECT";
    confidence = meeting ? "HIGH" : "MEDIUM";
    attributionRule = touchpoints[0].type === "CAMPAIGN" ? "DIRECT_SINGLE_CAMPAIGN_ENGAGED_V1" : "DIRECT_SINGLE_SOURCE_V1";
    if (touchpoints[0].type === "CAMPAIGN") campaignId = touchpoints[0].id;
  } else {
    attributionType = "ASSISTED";
    confidence = "MEDIUM";
    attributionRule = "ASSISTED_MULTIPLE_TOUCHPOINTS_V1";
  }

  if (deal && !deal.companyId) dataQualityFlags.push({ code: "DEAL_NO_COMPANY", description: "Deal has no companyId." });

  return upsertAttribution(organizationId, invoice, {
    dealId: deal?.id ?? null,
    companyId: company.id,
    contactId,
    leadId,
    opportunityId: opportunity?.id ?? null,
    proposalId: proposal?.id ?? null,
    meetingId: meeting?.id ?? null,
    replyId: engagedCampaigns[0]?.replyId ?? null,
    emailDraftId: engagedCampaigns[0]?.emailDraftId ?? null,
    campaignId,
    source: company.source,
    attributionType,
    confidence,
    attributionRule,
    evidence,
    touchpoints,
    dataQualityFlags,
  });
}

interface UpsertInput {
  dealId: string | null;
  companyId: string | null;
  contactId: string | null;
  leadId: string | null;
  opportunityId: string | null;
  proposalId: string | null;
  meetingId: string | null;
  replyId: string | null;
  emailDraftId: string | null;
  campaignId: string | null;
  source: CompanySource | null;
  attributionType: AttributionType;
  confidence: AttributionConfidence;
  attributionRule: string;
  evidence: EvidenceLink[];
  touchpoints: Touchpoint[];
  dataQualityFlags: DataQualityFlag[];
}

async function upsertAttribution(
  organizationId: string,
  invoice: { id: string; amountPaid: number; currency: string | null },
  input: UpsertInput,
): Promise<RevenueAttribution> {
  const data = {
    organizationId,
    invoiceId: invoice.id,
    dealId: input.dealId,
    companyId: input.companyId,
    contactId: input.contactId,
    leadId: input.leadId,
    opportunityId: input.opportunityId,
    proposalId: input.proposalId,
    meetingId: input.meetingId,
    replyId: input.replyId,
    emailDraftId: input.emailDraftId,
    campaignId: input.campaignId,
    source: input.source,
    attributionType: input.attributionType,
    confidence: input.confidence,
    attributionRule: input.attributionRule,
    attributionModel: ATTRIBUTION_MODEL,
    revenueAmount: invoice.amountPaid,
    currency: invoice.currency,
    evidence: input.evidence as object,
    touchpoints: input.touchpoints as object,
    dataQualityFlags: input.dataQualityFlags as object,
    computedAt: new Date(),
  };
  return prisma.revenueAttribution.upsert({
    where: { organizationId_invoiceId_attributionModel: { organizationId, invoiceId: invoice.id, attributionModel: ATTRIBUTION_MODEL } },
    create: data,
    update: data,
  });
}

export interface BulkAttributionResult {
  invoicesConsidered: number;
  computed: number;
  direct: number;
  assisted: number;
  unknown: number;
}

/** Recomputes attribution for every real paid invoice in the org — idempotent, safe to rerun (§45). */
export async function computeAttributionForOrganization(organizationId: string): Promise<BulkAttributionResult> {
  const invoices = await prisma.invoice.findMany({ where: { organizationId, amountPaid: { gt: 0 } }, select: { id: true } });
  let direct = 0;
  let assisted = 0;
  let unknown = 0;
  for (const inv of invoices) {
    const row = await computeAttributionForInvoice(organizationId, inv.id);
    if (!row) continue;
    if (row.attributionType === "DIRECT") direct += 1;
    else if (row.attributionType === "ASSISTED") assisted += 1;
    else unknown += 1;
  }
  return { invoicesConsidered: invoices.length, computed: direct + assisted + unknown, direct, assisted, unknown };
}

/** Lazily computes attribution for one invoice if it hasn't been computed yet, then returns the evidence chain. */
export async function getAttributionChainForInvoice(organizationId: string, invoiceId: string): Promise<RevenueAttribution | null> {
  const existing = await prisma.revenueAttribution.findUnique({
    where: { organizationId_invoiceId_attributionModel: { organizationId, invoiceId, attributionModel: ATTRIBUTION_MODEL } },
  });
  if (existing) return existing;
  return computeAttributionForInvoice(organizationId, invoiceId);
}

// ===== Attribution Overview =====

export interface AttributionOverview {
  totalPaidRevenue: number;
  directRevenue: number;
  assistedRevenue: number;
  unknownRevenue: number;
  directCount: number;
  assistedCount: number;
  unknownCount: number;
  attributedInvoiceCount: number;
  /** Real paid invoices in the org that have NOT yet had attribution computed — visible gap, never silently folded into Unknown. */
  unattributedInvoiceCount: number;
}

export async function getAttributionOverview(organizationId: string): Promise<AttributionOverview> {
  const [rows, totalPaidAgg, allPaidInvoiceIds] = await Promise.all([
    prisma.revenueAttribution.findMany({ where: { organizationId }, select: { attributionType: true, revenueAmount: true, invoiceId: true } }),
    prisma.invoice.aggregate({ where: { organizationId, amountPaid: { gt: 0 } }, _sum: { amountPaid: true } }),
    prisma.invoice.findMany({ where: { organizationId, amountPaid: { gt: 0 } }, select: { id: true } }),
  ]);

  const attributedInvoiceIds = new Set(rows.map((r) => r.invoiceId));
  const unattributedInvoiceCount = allPaidInvoiceIds.filter((i) => !attributedInvoiceIds.has(i.id)).length;

  let directRevenue = 0;
  let assistedRevenue = 0;
  let unknownRevenue = 0;
  let directCount = 0;
  let assistedCount = 0;
  let unknownCount = 0;
  for (const r of rows) {
    if (r.attributionType === "DIRECT") {
      directRevenue += r.revenueAmount;
      directCount += 1;
    } else if (r.attributionType === "ASSISTED") {
      assistedRevenue += r.revenueAmount;
      assistedCount += 1;
    } else {
      unknownRevenue += r.revenueAmount;
      unknownCount += 1;
    }
  }

  return {
    totalPaidRevenue: totalPaidAgg._sum.amountPaid ?? 0,
    directRevenue,
    assistedRevenue,
    unknownRevenue,
    directCount,
    assistedCount,
    unknownCount,
    attributedInvoiceCount: rows.length,
    unattributedInvoiceCount,
  };
}

/**
 * §51 financial consistency check: sum of every RevenueAttribution row's
 * revenueAmount must equal the real total paid revenue MINUS whatever is
 * still unattributed (never double-counted, since each paid invoice gets
 * exactly one row per the unique key). Reports the gap rather than forcing
 * a false equality.
 */
export interface FinancialConsistencyCheck {
  totalPaidRevenue: number;
  totalAttributedRevenue: number;
  gap: number;
  consistent: boolean;
  explanation: string;
}

export async function getFinancialConsistencyCheck(organizationId: string): Promise<FinancialConsistencyCheck> {
  const overview = await getAttributionOverview(organizationId);
  const totalAttributedRevenue = overview.directRevenue + overview.assistedRevenue + overview.unknownRevenue;
  const gap = overview.totalPaidRevenue - totalAttributedRevenue;
  return {
    totalPaidRevenue: overview.totalPaidRevenue,
    totalAttributedRevenue,
    gap,
    consistent: Math.abs(gap) < 0.01,
    explanation:
      gap > 0.01
        ? `${overview.unattributedInvoiceCount} paid invoice(s) have not had attribution computed yet — run recompute. Direct+Assisted+Unknown are mutually exclusive per invoice, so once every paid invoice is attributed this gap is exactly 0.`
        : "Every real paid invoice has exactly one attribution row (Direct, Assisted, or Unknown) — no double-counting.",
  };
}

// ===== Revenue by Source =====

export interface RevenueBySourceRow {
  source: CompanySource;
  companies: number;
  contacted: number;
  replies: number;
  meetings: number;
  deals: number;
  revenue: number;
  invoiceIds: string[];
}

const ALL_COMPANY_SOURCES: CompanySource[] = ["MANUAL", "LEAD_FINDER", "CLIENT_FINDER", "WEBSITE_SCANNER", "AUTO_DISCOVERY", "REFERRAL"];

export async function getRevenueBySource(organizationId: string): Promise<RevenueBySourceRow[]> {
  const rows = await prisma.revenueAttribution.findMany({
    where: { organizationId, source: { not: null } },
    select: { source: true, revenueAmount: true, invoiceId: true, companyId: true, contactId: true },
  });

  const [companyGroups, contactedRows, replyRows, meetingRows] = await Promise.all([
    prisma.company.groupBy({ by: ["source"], where: { organizationId }, _count: { source: true } }),
    prisma.emailDraft.findMany({ where: { organizationId, status: "SENT" }, select: { contact: { select: { company: { select: { source: true } } } } } }),
    prisma.reply.findMany({ where: { organizationId }, select: { contact: { select: { company: { select: { source: true } } } } } }),
    prisma.outreachMeeting.findMany({ where: { organizationId, status: { in: [...REAL_MEETING_STATUSES] } }, select: { contact: { select: { company: { select: { source: true } } } } } }),
  ]);

  const companiesBySource = new Map(companyGroups.map((g) => [g.source, g._count.source]));
  const contactedBySource = countByNested(contactedRows, (r) => r.contact.company?.source);
  const repliesBySource = countByNested(replyRows, (r) => r.contact.company?.source);
  const meetingsBySource = countByNested(meetingRows, (r) => r.contact.company?.source);

  const dealsBySource = new Map<string, Set<string>>();
  const revenueBySource = new Map<string, number>();
  const invoicesBySource = new Map<string, string[]>();
  for (const r of rows) {
    const source = r.source as string;
    revenueBySource.set(source, (revenueBySource.get(source) ?? 0) + r.revenueAmount);
    invoicesBySource.set(source, [...(invoicesBySource.get(source) ?? []), r.invoiceId]);
  }
  const dealRows = await prisma.revenueAttribution.findMany({ where: { organizationId, source: { not: null }, dealId: { not: null } }, select: { source: true, dealId: true } });
  for (const d of dealRows) {
    const source = d.source as string;
    const set = dealsBySource.get(source) ?? new Set<string>();
    if (d.dealId) set.add(d.dealId);
    dealsBySource.set(source, set);
  }

  return ALL_COMPANY_SOURCES.map((source) => ({
    source,
    companies: companiesBySource.get(source) ?? 0,
    contacted: contactedBySource.get(source) ?? 0,
    replies: repliesBySource.get(source) ?? 0,
    meetings: meetingsBySource.get(source) ?? 0,
    deals: dealsBySource.get(source)?.size ?? 0,
    revenue: revenueBySource.get(source) ?? 0,
    invoiceIds: invoicesBySource.get(source) ?? [],
  }));
}

function countByNested<T>(rows: T[], keyOf: (row: T) => string | null | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/** §14/§35 — scoped specifically to revenue whose Deal was converted from a real Lead-pipeline record (Deal.sourceLeadId != null), a genuinely different (usually smaller) set than getRevenueBySource's all-revenue view. */
export async function getRevenueByLeadSource(organizationId: string): Promise<RevenueBySourceRow[]> {
  const rows = await prisma.revenueAttribution.findMany({
    where: { organizationId, source: { not: null }, leadId: { not: null } },
    select: { source: true, revenueAmount: true, invoiceId: true, dealId: true },
  });
  const revenueBySource = new Map<string, number>();
  const invoicesBySource = new Map<string, string[]>();
  const dealsBySource = new Map<string, Set<string>>();
  for (const r of rows) {
    const source = r.source as string;
    revenueBySource.set(source, (revenueBySource.get(source) ?? 0) + r.revenueAmount);
    invoicesBySource.set(source, [...(invoicesBySource.get(source) ?? []), r.invoiceId]);
    const set = dealsBySource.get(source) ?? new Set<string>();
    if (r.dealId) set.add(r.dealId);
    dealsBySource.set(source, set);
  }
  return ALL_COMPANY_SOURCES.map((source) => ({
    source,
    companies: 0,
    contacted: 0,
    replies: 0,
    meetings: 0,
    deals: dealsBySource.get(source)?.size ?? 0,
    revenue: revenueBySource.get(source) ?? 0,
    invoiceIds: invoicesBySource.get(source) ?? [],
  })).filter((r) => r.revenue > 0 || r.deals > 0);
}

// ===== Revenue by Campaign =====

export interface RevenueByCampaignRow {
  campaignId: string;
  campaignName: string;
  isAiCampaign: boolean;
  direct: number;
  assisted: number;
  revenue: number;
  invoiceIds: string[];
}

/**
 * Only campaigns with a PROVEN attribution row (DIRECT owner or an ASSISTED
 * touchpoint) are shown — never every campaign a company's contact happened
 * to be enrolled in (§13).
 */
export async function getRevenueByCampaign(organizationId: string): Promise<RevenueByCampaignRow[]> {
  const directRows = await prisma.revenueAttribution.findMany({ where: { organizationId, campaignId: { not: null } }, select: { campaignId: true, revenueAmount: true, invoiceId: true, attributionType: true } });
  const assistedRows = await prisma.revenueAttribution.findMany({ where: { organizationId, attributionType: "ASSISTED" }, select: { touchpoints: true, revenueAmount: true, invoiceId: true } });

  const byCampaign = new Map<string, { direct: number; assisted: number; revenue: number; invoiceIds: Set<string> }>();
  for (const r of directRows) {
    if (!r.campaignId) continue;
    const entry = byCampaign.get(r.campaignId) ?? { direct: 0, assisted: 0, revenue: 0, invoiceIds: new Set<string>() };
    entry.direct += 1;
    entry.revenue += r.revenueAmount;
    entry.invoiceIds.add(r.invoiceId);
    byCampaign.set(r.campaignId, entry);
  }
  for (const r of assistedRows) {
    const touchpoints = r.touchpoints as unknown as Touchpoint[];
    for (const tp of touchpoints) {
      if (tp.type !== "CAMPAIGN") continue;
      const entry = byCampaign.get(tp.id) ?? { direct: 0, assisted: 0, revenue: 0, invoiceIds: new Set<string>() };
      entry.assisted += 1;
      entry.revenue += r.revenueAmount;
      entry.invoiceIds.add(r.invoiceId);
      byCampaign.set(tp.id, entry);
    }
  }

  if (byCampaign.size === 0) return [];
  const campaigns = await prisma.campaign.findMany({ where: { id: { in: [...byCampaign.keys()] } }, select: { id: true, name: true, approvalMode: true } });
  return campaigns
    .map((c) => {
      const agg = byCampaign.get(c.id)!;
      return {
        campaignId: c.id,
        campaignName: c.name,
        isAiCampaign: c.approvalMode === "AUTOMATIC",
        direct: agg.direct,
        assisted: agg.assisted,
        revenue: agg.revenue,
        invoiceIds: [...agg.invoiceIds],
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

/** §34 — campaigns whose approvalMode is AUTOMATIC (the real, existing marker for a fully AI-run campaign, e.g. "KVL Sector Outreach"). Attribution rules are unchanged — using AI to run a campaign never overrides the DIRECT/ASSISTED/UNKNOWN rules above. */
export async function getRevenueByAiCampaign(organizationId: string): Promise<RevenueByCampaignRow[]> {
  const all = await getRevenueByCampaign(organizationId);
  return all.filter((c) => c.isAiCampaign);
}

// ===== Revenue by Sector / Country =====

export interface RevenueByDimensionRow {
  label: string;
  revenue: number;
  deals: number;
  invoiceIds: string[];
}

async function groupRevenueByCompanyField(organizationId: string, field: "industry" | "headquartersCountry"): Promise<RevenueByDimensionRow[]> {
  const rows = await prisma.revenueAttribution.findMany({ where: { organizationId, companyId: { not: null } }, select: { companyId: true, revenueAmount: true, invoiceId: true, dealId: true } });
  if (rows.length === 0) return [];
  const companyIds = [...new Set(rows.map((r) => r.companyId!))];
  const companies = await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, industry: true, headquartersCountry: true } });
  const fieldByCompany = new Map(companies.map((c) => [c.id, field === "industry" ? c.industry : c.headquartersCountry]));

  const byLabel = new Map<string, { revenue: number; deals: Set<string>; invoiceIds: Set<string> }>();
  for (const r of rows) {
    const label = fieldByCompany.get(r.companyId!) ?? null;
    const key = label ?? "UNKNOWN";
    const entry = byLabel.get(key) ?? { revenue: 0, deals: new Set<string>(), invoiceIds: new Set<string>() };
    entry.revenue += r.revenueAmount;
    if (r.dealId) entry.deals.add(r.dealId);
    entry.invoiceIds.add(r.invoiceId);
    byLabel.set(key, entry);
  }
  return [...byLabel.entries()]
    .map(([label, agg]) => ({ label, revenue: agg.revenue, deals: agg.deals.size, invoiceIds: [...agg.invoiceIds] }))
    .sort((a, b) => b.revenue - a.revenue);
}

export async function getRevenueBySector(organizationId: string): Promise<RevenueByDimensionRow[]> {
  return groupRevenueByCompanyField(organizationId, "industry");
}

export async function getRevenueByCountry(organizationId: string): Promise<RevenueByDimensionRow[]> {
  return groupRevenueByCompanyField(organizationId, "headquartersCountry");
}

// ===== Revenue by Service =====

/**
 * Prefers Deal.services (the real, authoritative commercial record of what
 * was actually sold) over LeadOpportunity.recommendedService — only falls
 * back to the latter when the Deal carries no services (§31: authoritative
 * commercial record wins over an inferred/recommended one).
 */
export async function getRevenueByService(organizationId: string): Promise<RevenueByDimensionRow[]> {
  const rows = await prisma.revenueAttribution.findMany({ where: { organizationId }, select: { dealId: true, opportunityId: true, revenueAmount: true, invoiceId: true } });
  if (rows.length === 0) return [];

  const dealIds = [...new Set(rows.map((r) => r.dealId).filter((id): id is string => !!id))];
  const deals = await prisma.deal.findMany({ where: { id: { in: dealIds } }, select: { id: true, services: true } });
  const servicesByDeal = new Map(deals.map((d) => [d.id, d.services]));

  const opportunityIds = [...new Set(rows.map((r) => r.opportunityId).filter((id): id is string => !!id))];
  const opportunities = await prisma.leadOpportunity.findMany({ where: { id: { in: opportunityIds } }, select: { id: true, recommendedService: true } });
  const recommendedByOpportunity = new Map(opportunities.map((o) => [o.id, o.recommendedService]));

  const byService = new Map<string, { revenue: number; deals: Set<string>; invoiceIds: Set<string> }>();
  for (const r of rows) {
    const dealServices = r.dealId ? servicesByDeal.get(r.dealId) ?? [] : [];
    const labels = dealServices.length > 0 ? dealServices : r.opportunityId && recommendedByOpportunity.get(r.opportunityId) ? [recommendedByOpportunity.get(r.opportunityId)!] : ["UNKNOWN"];
    for (const raw of labels) {
      const label = KVL_SERVICES.find((s) => s.id === raw)?.label ?? raw;
      const entry = byService.get(label) ?? { revenue: 0, deals: new Set<string>(), invoiceIds: new Set<string>() };
      entry.revenue += r.revenueAmount;
      if (r.dealId) entry.deals.add(r.dealId);
      entry.invoiceIds.add(r.invoiceId);
      byService.set(label, entry);
    }
  }
  return [...byService.entries()]
    .map(([label, agg]) => ({ label, revenue: agg.revenue, deals: agg.deals.size, invoiceIds: [...agg.invoiceIds] }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ===== Revenue by Decision Maker Role =====

export async function getRevenueByDecisionMakerRole(organizationId: string): Promise<RevenueByDimensionRow[]> {
  const rows = await prisma.revenueAttribution.findMany({ where: { organizationId, contactId: { not: null } }, select: { contactId: true, revenueAmount: true, invoiceId: true, dealId: true } });
  if (rows.length === 0) return [];
  const contactIds = [...new Set(rows.map((r) => r.contactId!))];
  const contacts = await prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, decisionMaker: { select: { role: true } } } });
  const roleByContact = new Map(contacts.map((c) => [c.id, c.decisionMaker?.role ?? null]));

  const byRole = new Map<string, { revenue: number; deals: Set<string>; invoiceIds: Set<string> }>();
  for (const r of rows) {
    const role = roleByContact.get(r.contactId!) ?? "UNKNOWN";
    const entry = byRole.get(role) ?? { revenue: 0, deals: new Set<string>(), invoiceIds: new Set<string>() };
    entry.revenue += r.revenueAmount;
    if (r.dealId) entry.deals.add(r.dealId);
    entry.invoiceIds.add(r.invoiceId);
    byRole.set(role, entry);
  }
  return [...byRole.entries()]
    .map(([label, agg]) => ({ label, revenue: agg.revenue, deals: agg.deals.size, invoiceIds: [...agg.invoiceIds] }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ===== Revenue by Outreach Channel =====

/** Only real DraftChannel values (EMAIL, LINKEDIN) ever appear — never an invented WhatsApp/Voice bucket (§33). Revenue with no proven outreach evidence at all is grouped as NO_OUTREACH_EVIDENCE, not silently dropped. */
export async function getRevenueByOutreachChannel(organizationId: string): Promise<RevenueByDimensionRow[]> {
  const rows = await prisma.revenueAttribution.findMany({ where: { organizationId }, select: { emailDraftId: true, revenueAmount: true, invoiceId: true, dealId: true } });
  if (rows.length === 0) return [];
  const draftIds = [...new Set(rows.map((r) => r.emailDraftId).filter((id): id is string => !!id))];
  const drafts = await prisma.emailDraft.findMany({ where: { id: { in: draftIds } }, select: { id: true, channel: true } });
  const channelByDraft = new Map(drafts.map((d) => [d.id, d.channel]));

  const byChannel = new Map<string, { revenue: number; deals: Set<string>; invoiceIds: Set<string> }>();
  for (const r of rows) {
    const label = r.emailDraftId ? channelByDraft.get(r.emailDraftId) ?? "UNKNOWN" : "NO_OUTREACH_EVIDENCE";
    const entry = byChannel.get(label) ?? { revenue: 0, deals: new Set<string>(), invoiceIds: new Set<string>() };
    entry.revenue += r.revenueAmount;
    if (r.dealId) entry.deals.add(r.dealId);
    entry.invoiceIds.add(r.invoiceId);
    byChannel.set(label, entry);
  }
  return [...byChannel.entries()]
    .map(([label, agg]) => ({ label, revenue: agg.revenue, deals: agg.deals.size, invoiceIds: [...agg.invoiceIds] }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ===== Funnel metrics + conversion rates (§36-37) =====

export interface FunnelStage {
  stage: string;
  count: number;
}

export interface ConversionRate {
  from: string;
  to: string;
  numerator: number;
  denominator: number;
  rate: number | null; // null = NOT_AVAILABLE (denominator 0) — never NaN/Infinity/fake 0%
}

export interface AttributionFunnel {
  stages: FunnelStage[];
  conversions: ConversionRate[];
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Reuses the exact same real definitions already established elsewhere in
 * this codebase (not reinvented): Qualified = LeadScore.band in
 * (HOT, WARM) — the same definition acquisition-funnel.ts documents as "the
 * real, already-user-facing definition". Contacted = real SENT EmailDrafts
 * only (never draft/failed/blocked/unsent, §17/§36).
 */
export async function getFunnelMetrics(organizationId: string): Promise<AttributionFunnel> {
  const [companies, qualified, contacted, replies, meetings, proposals, dealsWon, attributedRevenue] = await Promise.all([
    prisma.company.count({ where: { organizationId } }),
    prisma.leadScore.count({ where: { company: { organizationId }, band: { in: ["HOT", "WARM"] } } }),
    prisma.emailDraft.count({ where: { organizationId, status: "SENT" } }),
    prisma.reply.count({ where: { organizationId } }),
    prisma.outreachMeeting.count({ where: { organizationId, status: { in: [...REAL_MEETING_STATUSES] } } }),
    prisma.proposal.count({ where: { organizationId } }),
    prisma.deal.count({ where: { organizationId, dealStage: { name: "Won" } } }),
    prisma.revenueAttribution.count({ where: { organizationId } }),
  ]);

  const stages: FunnelStage[] = [
    { stage: "Companies Found", count: companies },
    { stage: "Qualified", count: qualified },
    { stage: "Contacted", count: contacted },
    { stage: "Replies", count: replies },
    { stage: "Meetings", count: meetings },
    { stage: "Proposals", count: proposals },
    { stage: "Deals Won", count: dealsWon },
    { stage: "Paid Revenue (attributed invoices)", count: attributedRevenue },
  ];

  const conversions: ConversionRate[] = [
    { from: "Companies Found", to: "Qualified", numerator: qualified, denominator: companies, rate: rate(qualified, companies) },
    { from: "Qualified", to: "Contacted", numerator: contacted, denominator: qualified, rate: rate(contacted, qualified) },
    { from: "Contacted", to: "Replies", numerator: replies, denominator: contacted, rate: rate(replies, contacted) },
    { from: "Replies", to: "Meetings", numerator: meetings, denominator: replies, rate: rate(meetings, replies) },
    { from: "Meetings", to: "Proposals", numerator: proposals, denominator: meetings, rate: rate(proposals, meetings) },
    { from: "Proposals", to: "Deals Won", numerator: dealsWon, denominator: proposals, rate: rate(dealsWon, proposals) },
    { from: "Deals Won", to: "Paid Revenue", numerator: attributedRevenue, denominator: dealsWon, rate: rate(attributedRevenue, dealsWon) },
  ];

  return { stages, conversions };
}

// ===== Data quality report (§44) =====

export interface AttributionDataQualityReport {
  orphanInvoicesNoDeal: number;
  orphanInvoicesNoCompany: number;
  orphanDealsNoCompany: number;
  proposalsNotLinkedToDeal: number;
  opportunitiesWithNoDealAtAllForCompany: number;
  flagsByCode: Record<string, number>;
}

export async function getAttributionDataQualityReport(organizationId: string): Promise<AttributionDataQualityReport> {
  const [orphanInvoicesNoDeal, orphanInvoicesNoCompanyRows, orphanDealsNoCompany, proposalsNotLinkedToDeal, attributionRows] = await Promise.all([
    prisma.invoice.count({ where: { organizationId, amountPaid: { gt: 0 }, dealId: null } }),
    prisma.invoice.findMany({ where: { organizationId, amountPaid: { gt: 0 }, companyId: null, dealId: null, clientId: null }, select: { id: true } }),
    prisma.deal.count({ where: { organizationId, dealStage: { name: "Won" }, companyId: null } }),
    prisma.proposal.count({ where: { organizationId, dealId: null, status: "ACCEPTED" } }),
    prisma.revenueAttribution.findMany({ where: { organizationId }, select: { dataQualityFlags: true } }),
  ]);

  const opportunitiesWithNoDealAtAllForCompany = await prisma.leadOpportunity.count({
    where: { status: "ADDED_TO_CRM", company: { organizationId, deals: { none: {} } } },
  });

  const flagsByCode: Record<string, number> = {};
  for (const row of attributionRows) {
    const flags = row.dataQualityFlags as unknown as DataQualityFlag[];
    for (const f of flags) flagsByCode[f.code] = (flagsByCode[f.code] ?? 0) + 1;
  }

  return {
    orphanInvoicesNoDeal,
    orphanInvoicesNoCompany: orphanInvoicesNoCompanyRows.length,
    orphanDealsNoCompany,
    proposalsNotLinkedToDeal,
    opportunitiesWithNoDealAtAllForCompany,
    flagsByCode,
  };
}

// ===== Master attribution table (§53) =====

export interface AttributionTableRow {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  revenue: number;
  source: CompanySource | null;
  campaignName: string | null;
  companyName: string | null;
  dealName: string | null;
  attributionType: AttributionType;
  attributionRule: string;
  computedAt: string;
}

/** Every real attribution row for this org, newest first — the clickable master table (§53/§39). */
export async function listRevenueAttributions(organizationId: string, limit = 200): Promise<AttributionTableRow[]> {
  const rows = await prisma.revenueAttribution.findMany({
    where: { organizationId },
    orderBy: { computedAt: "desc" },
    take: limit,
    include: { invoice: { select: { invoiceNumber: true } }, deal: { select: { name: true } }, company: { select: { name: true } }, campaign: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    invoiceId: r.invoiceId,
    invoiceNumber: r.invoice.invoiceNumber,
    revenue: r.revenueAmount,
    source: r.source,
    campaignName: r.campaign?.name ?? null,
    companyName: r.company?.name ?? null,
    dealName: r.deal?.name ?? null,
    attributionType: r.attributionType,
    attributionRule: r.attributionRule,
    computedAt: r.computedAt.toISOString(),
  }));
}
