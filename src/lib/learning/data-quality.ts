import { prisma } from "@/lib/prisma";

/**
 * Phase 11 §1 — the data-quality audit the spec requires BEFORE any pattern
 * is trusted. Real counts only, straight from the source tables (never from
 * LearningObservation, which is a derived cache of these same numbers) —
 * this is what a human should read to judge whether the engine's output for
 * this org is meaningful yet. UNKNOWN stays UNKNOWN: a missing field is
 * reported as missing, never silently treated as a negative outcome.
 */
export interface LearningDataQualityReport {
  organizationId: string;
  generatedAt: string;

  counts: {
    companies: number;
    contacts: number;
    decisionMakers: number;
    leadOpportunities: number;
    deals: number;
    dealsWon: number;
    invoicesPaid: number;
    proposals: number;
    proposalsAccepted: number;
    outreachMeetings: number;
    replies: number;
    intentScores: number;
    intentScoreHistoryRows: number;
    conversationIntelligenceRows: number;
    calls: number;
    whatsappConversations: number;
    revenueAttributionRows: number;
  };

  completeness: {
    companiesMissingIndustry: number;
    companiesMissingEmployeeCount: number;
    companiesMissingCountry: number;
    leadOpportunitiesMissingService: number;
    leadOpportunitiesMissingScore: number;
    dealsMissingValue: number;
    dealsMissingLostReasonWhenLost: number;
    contactsMissingDecisionMakerRole: number;
  };

  verifiedVsAiGenerated: {
    // Real, human-entered or provider-confirmed facts.
    verified: { dealsWithLostReason: number; invoicesPaid: number; proposalsWithTerminalStatus: number };
    // AI-produced, always labeled as such wherever shown.
    aiGenerated: { intentScores: number; conversationIntelligenceRows: number; companyIntelligenceReports: number };
    // Not available at all in this dataset — distinct from "false"/"zero".
    unavailable: { orgsWithNoIntentScoreHistory: boolean; noExperimentInfrastructure: true };
  };

  /** Free-text notes on anything a human should know before trusting the engine's output — duplicates, staleness, etc. */
  notes: string[];
}

export async function getLearningDataQualityReport(organizationId: string): Promise<LearningDataQualityReport> {
  const [
    companies,
    contacts,
    decisionMakers,
    leadOpportunities,
    deals,
    dealsWon,
    invoicesPaid,
    proposals,
    proposalsAccepted,
    outreachMeetings,
    replies,
    intentScores,
    intentScoreHistoryRows,
    conversationIntelligenceRows,
    calls,
    whatsappConversations,
    revenueAttributionRows,
    companiesMissingIndustry,
    companiesMissingEmployeeCount,
    companiesMissingCountry,
    leadOpportunitiesMissingService,
    leadOpportunitiesMissingScore,
    dealsMissingValue,
    dealsLostNoReason,
    contactsMissingDecisionMakerRole,
    proposalsTerminal,
    dealsWithLostReason,
    companyIntelligenceReports,
  ] = await Promise.all([
    prisma.company.count({ where: { organizationId } }),
    prisma.contact.count({ where: { organizationId } }),
    prisma.decisionMaker.count({ where: { company: { organizationId } } }),
    prisma.leadOpportunity.count({ where: { company: { organizationId } } }),
    prisma.deal.count({ where: { organizationId } }),
    prisma.deal.count({ where: { organizationId, dealStage: { name: "Won" } } }),
    prisma.invoice.count({ where: { organizationId, amountPaid: { gt: 0 } } }),
    prisma.proposal.count({ where: { organizationId } }),
    prisma.proposal.count({ where: { organizationId, status: "ACCEPTED" } }),
    prisma.outreachMeeting.count({ where: { organizationId } }),
    prisma.reply.count({ where: { organizationId } }),
    prisma.intentScore.count({ where: { company: { organizationId } } }),
    prisma.intentScoreHistory.count({ where: { organizationId } }),
    prisma.conversationIntelligence.count({ where: { organizationId } }),
    prisma.call.count({ where: { organizationId } }),
    prisma.whatsAppConversation.count({ where: { organizationId } }),
    prisma.revenueAttribution.count({ where: { organizationId } }),
    prisma.company.count({ where: { organizationId, industry: null } }),
    prisma.company.count({ where: { organizationId, employeeCount: null } }),
    prisma.company.count({ where: { organizationId, headquartersCountry: null } }),
    prisma.leadOpportunity.count({ where: { company: { organizationId }, recommendedService: null } }),
    prisma.leadOpportunity.count({ where: { company: { organizationId }, opportunityScore: null } }),
    prisma.deal.count({ where: { organizationId, value: null } }),
    prisma.deal.count({ where: { organizationId, dealStage: { name: "Lost" }, lostReason: null } }),
    prisma.contact.count({ where: { organizationId, decisionMakerId: null } }),
    prisma.proposal.count({ where: { organizationId, status: { in: ["ACCEPTED", "REJECTED"] } } }),
    prisma.deal.count({ where: { organizationId, lostReason: { not: null } } }),
    prisma.companyIntelligence.count({ where: { company: { organizationId } } }),
  ]);

  const testFixtureCompanies = await prisma.company.count({ where: { organizationId, name: { startsWith: "[phase" } } });

  const notes: string[] = [];
  if (testFixtureCompanies > 0) {
    notes.push(
      `${testFixtureCompanies} of ${companies} companies in this database are leftover e2e-test fixtures (name prefixed "[phaseN-test]") from prior phases' automated test scripts, not real client records — they are real database rows so the engine processes them like any other, but any pattern whose evidence traces back to them should not be read as a genuine business finding. This database has no separately verified "production" dataset distinct from local/dev — see the Phase 11 final report for this caveat.`,
    );
  }
  if (leadOpportunities < LEARNING_MIN_MEANINGFUL) notes.push(`Only ${leadOpportunities} LeadOpportunity rows exist — most cohort patterns will correctly report INSUFFICIENT_DATA or LOW_SAMPLE, not because the engine is broken but because the dataset is genuinely this small today.`);
  if (dealsLostNoReason > 0) notes.push(`${dealsLostNoReason} Lost deal(s) have no recorded lostReason — objection analysis can only use AI-inferred ConversationIntelligence.objections for these, which stays labeled INFERRED, never treated as a confirmed reason.`);
  notes.push("No A/B experiment infrastructure exists yet in this codebase — experiment-based pattern validation (§30) is out of scope for this implementation and documented as a follow-up.");

  return {
    organizationId,
    generatedAt: new Date().toISOString(),
    counts: {
      companies,
      contacts,
      decisionMakers,
      leadOpportunities,
      deals,
      dealsWon,
      invoicesPaid,
      proposals,
      proposalsAccepted,
      outreachMeetings,
      replies,
      intentScores,
      intentScoreHistoryRows,
      conversationIntelligenceRows,
      calls,
      whatsappConversations,
      revenueAttributionRows,
    },
    completeness: {
      companiesMissingIndustry,
      companiesMissingEmployeeCount,
      companiesMissingCountry,
      leadOpportunitiesMissingService,
      leadOpportunitiesMissingScore,
      dealsMissingValue,
      dealsMissingLostReasonWhenLost: dealsLostNoReason,
      contactsMissingDecisionMakerRole,
    },
    verifiedVsAiGenerated: {
      verified: { dealsWithLostReason, invoicesPaid, proposalsWithTerminalStatus: proposalsTerminal },
      aiGenerated: { intentScores, conversationIntelligenceRows, companyIntelligenceReports: companyIntelligenceReports },
      unavailable: { orgsWithNoIntentScoreHistory: intentScoreHistoryRows === 0, noExperimentInfrastructure: true },
    },
    notes,
  };
}

const LEARNING_MIN_MEANINGFUL = 30;
