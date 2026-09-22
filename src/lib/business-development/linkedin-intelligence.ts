import { prisma } from "@/lib/prisma";
import { estimateSeniority } from "./enrichment";
import { getLinkedInOutreachRecommendation, type LinkedInOutreachRecommendation } from "./linkedin-recommendation";

/**
 * Phase 9 (LinkedIn Sales Intelligence) §44 — a pure, read-time composer
 * for the Company detail page's "LinkedIn Intelligence" panel. Reuses
 * existing, already-real fields (Contact.linkedin/Company.socialLinks —
 * manually entered URLs, Contact.jobTitle, enrichment.ts's existing
 * seniority estimator) rather than inventing new profile-fetch logic —
 * this app has no real LinkedIn profile API access (see
 * linkedin-capabilities.ts), so "Profile"/"Role"/"Seniority" here are
 * exactly the same real CRM data already shown elsewhere on this page,
 * simply gathered into one panel.
 */

export interface LinkedInSeniorityEstimate {
  value: string;
  classification: "AI_INTERPRETATION";
  evidence: string;
}

export interface LinkedInContactIntelligence {
  contactId: string;
  name: string;
  profileUrl: string | null;
  jobTitle: string | null;
  seniority: LinkedInSeniorityEstimate | null;
}

export interface LinkedInCompanyIntelligence {
  companyId: string;
  pageUrl: string | null;
}

export interface LinkedInActivityEntry {
  id: string;
  type: "MESSAGE_DRAFTED" | "MESSAGE_SENT" | "REPLY";
  contactId: string;
  contactName: string;
  occurredAt: string;
  status: string;
}

export interface CompanyLinkedInIntelligence {
  company: LinkedInCompanyIntelligence;
  contacts: LinkedInContactIntelligence[];
  activity: LinkedInActivityEntry[];
  recommendation: LinkedInOutreachRecommendation;
  // §12/§13/§14 — honestly unavailable, never fabricated (see linkedin-capabilities.ts).
  connectionStatus: "NOT_AVAILABLE";
  employmentChangeSignals: "NOT_AVAILABLE — LINKEDIN ACCESS REQUIRED";
  companySignals: "NOT_AVAILABLE — LINKEDIN ACCESS REQUIRED";
  engagementSignals: "NOT_AVAILABLE — LINKEDIN ACCESS REQUIRED";
}

export async function getCompanyLinkedInIntelligence(organizationId: string, companyId: string): Promise<CompanyLinkedInIntelligence | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.organizationId !== organizationId) return null;

  const contacts = await prisma.contact.findMany({ where: { organizationId, companyId } });
  const contactIntelligence: LinkedInContactIntelligence[] = contacts.map((c) => {
    const { seniority, probability } = estimateSeniority(c.jobTitle);
    return {
      contactId: c.id,
      name: `${c.firstName} ${c.lastName ?? ""}`.trim(),
      profileUrl: c.linkedin,
      jobTitle: c.jobTitle,
      seniority: seniority
        ? { value: seniority, classification: "AI_INTERPRETATION", evidence: `Keyword-matched from real job title "${c.jobTitle}" (${Math.round((probability ?? 0) * 100)}% confidence) — never sourced from LinkedIn, this app has no profile API access.` }
        : null,
    };
  });

  const socialLinks = company.socialLinks as { linkedin?: string } | null;

  const [linkedinDrafts, linkedinReplies] = await Promise.all([
    prisma.emailDraft.findMany({ where: { organizationId, channel: "LINKEDIN", contact: { companyId } }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.reply.findMany({ where: { organizationId, channel: "LINKEDIN", contact: { companyId } }, orderBy: { receivedAt: "desc" }, take: 20 }),
  ]);
  const contactNameById = new Map(contacts.map((c) => [c.id, `${c.firstName} ${c.lastName ?? ""}`.trim()]));

  const activity: LinkedInActivityEntry[] = [
    ...linkedinDrafts.map((d) => ({
      id: d.id,
      type: d.sentAt ? ("MESSAGE_SENT" as const) : ("MESSAGE_DRAFTED" as const),
      contactId: d.contactId,
      contactName: contactNameById.get(d.contactId) ?? "Unknown",
      occurredAt: (d.sentAt ?? d.createdAt).toISOString(),
      status: d.status,
    })),
    ...linkedinReplies.map((r) => ({
      id: r.id,
      type: "REPLY" as const,
      contactId: r.contactId,
      contactName: contactNameById.get(r.contactId) ?? "Unknown",
      occurredAt: r.receivedAt.toISOString(),
      status: "RECEIVED",
    })),
  ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  const recommendation = await getLinkedInOutreachRecommendation(organizationId, companyId);

  return {
    company: { companyId: company.id, pageUrl: socialLinks?.linkedin ?? null },
    contacts: contactIntelligence,
    activity,
    recommendation,
    connectionStatus: "NOT_AVAILABLE",
    employmentChangeSignals: "NOT_AVAILABLE — LINKEDIN ACCESS REQUIRED",
    companySignals: "NOT_AVAILABLE — LINKEDIN ACCESS REQUIRED",
    engagementSignals: "NOT_AVAILABLE — LINKEDIN ACCESS REQUIRED",
  };
}
