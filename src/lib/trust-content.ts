/**
 * Single source of truth for every Trust & Authority System section
 * (src/components/sections/trust/*.tsx). Two kinds of exports:
 *
 * 1. REAL, populated data (Technology Partners, Client Journey, Enterprise
 *    Trust Bar, Security & Compliance Badges, Why Choose KVL) — every claim
 *    here was independently verified against this codebase before being
 *    written (real integrations in src/lib/integrations/, real AES-256-GCM
 *    encryption, real BullMQ nightly-backup job, real RBAC/audit-log
 *    system, real doc guides under docs/guides/). These sections are wired
 *    into src/app/product/page.tsx.
 *
 * 2. Deliberately EMPTY arrays for sections that need real business content
 *    this deployment doesn't have yet (client logos, case studies,
 *    testimonials, certifications, awards, press, global office presence).
 *    Never fabricate placeholder "example" entries here — the components
 *    that read these render an honest "not yet available" state instead.
 *    Populate the real array here (and only here) once real content
 *    exists; the components need no changes.
 */

// ---------- Shared types ----------

export interface TechnologyPartner {
  name: string;
  category: string;
}

export interface ClientJourneyStep {
  step: number;
  title: string;
  description: string;
}

export interface TrustBarItem {
  label: string;
}

export interface SecurityBadge {
  label: string;
  description: string;
}

export interface ComparisonRow {
  category: string;
  kvl: string;
  typicalAgency: string;
}

export interface TrustedByLogo {
  name: string;
  logoUrl: string;
}

export interface FeaturedClient {
  companyName: string;
  logoUrl: string;
  industry: string;
  country: string;
  projectType: string;
  servicesDelivered: string[];
  technology: string[];
  result: string;
}

export interface CaseStudy {
  projectName: string;
  industry: string;
  businessProblem: string;
  solution: string;
  techStack: string[];
  timeline: string;
  businessResults: string;
  clientQuote: string;
}

export interface ClientSuccessStory {
  clientName: string;
  challenge: string;
  strategy: string;
  implementation: string;
  outcome: string;
  roi: string;
  feedback: string;
}

export interface Testimonial {
  name: string;
  designation: string;
  company: string;
  rating: number;
  country: string;
  project: string;
  photoUrl?: string;
  quote: string;
}

export interface VideoTestimonial {
  thumbnailUrl: string;
  videoUrl: string;
  duration: string;
  company: string;
  clientName: string;
  project: string;
  results: string;
}

export interface SuccessMetric {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  description: string;
}

export interface BusinessImpactStat {
  value: string;
  label: string;
}

export interface IndustryExperience {
  industry: string;
  description: string;
  projectsCount: number;
  solutions: string[];
}

export interface Certification {
  name: string;
  status: "Ready" | "Certified" | "In Progress";
}

export interface Award {
  title: string;
  organization: string;
  year: number;
  achievement: string;
}

export interface MediaMention {
  outlet: string;
  type: string;
  logoUrl: string;
}

export interface GlobalPresenceMarker {
  country: string;
  clients: number;
  projects: number;
}

// ---------- LIVE: Technology Partners ----------
// Sourced 1:1 from src/lib/integrations/types.ts's IntegrationProviderKey /
// registry.ts's ADAPTERS, src/lib/ai/providers/, src/lib/billing/gateway/,
// and this deployment's real infra stack. Every entry here is something
// this platform genuinely integrates with — nothing invented.

export const TECHNOLOGY_PARTNERS: TechnologyPartner[] = [
  { name: "Anthropic Claude", category: "AI" },
  { name: "Groq", category: "AI" },
  { name: "Google Gemini", category: "AI" },
  { name: "OpenRouter", category: "AI" },
  { name: "Stripe", category: "Payments" },
  { name: "Razorpay", category: "Payments" },
  { name: "Paddle", category: "Payments" },
  { name: "Lemon Squeezy", category: "Payments" },
  { name: "Cal.com", category: "Scheduling" },
  { name: "Calendly", category: "Scheduling" },
  { name: "Google Calendar", category: "Scheduling" },
  { name: "Microsoft Calendar", category: "Scheduling" },
  { name: "Slack", category: "Communication" },
  { name: "Microsoft Teams", category: "Communication" },
  { name: "Discord", category: "Communication" },
  { name: "Telegram", category: "Communication" },
  { name: "Twilio", category: "Communication" },
  { name: "HubSpot", category: "CRM" },
  { name: "Salesforce", category: "CRM" },
  { name: "Zoho CRM", category: "CRM" },
  { name: "Pipedrive", category: "CRM" },
  { name: "Freshsales", category: "CRM" },
  { name: "Google Drive", category: "Storage" },
  { name: "Dropbox", category: "Storage" },
  { name: "OneDrive", category: "Storage" },
  { name: "Amazon S3", category: "Storage" },
  { name: "Cloudflare R2", category: "Storage" },
  { name: "DocuSign", category: "e-Signature" },
  { name: "Adobe Sign", category: "e-Signature" },
  { name: "Dropbox Sign", category: "e-Signature" },
  { name: "GitHub", category: "Developer" },
  { name: "GitLab", category: "Developer" },
  { name: "Bitbucket", category: "Developer" },
  { name: "Vercel", category: "Developer" },
  { name: "Netlify", category: "Developer" },
  { name: "Cloudflare", category: "Developer" },
  { name: "Gmail", category: "Email" },
  { name: "Outlook", category: "Email" },
  { name: "SendGrid", category: "Email" },
  { name: "Mailgun", category: "Email" },
  { name: "Amazon SES", category: "Email" },
  { name: "QuickBooks", category: "Accounting" },
  { name: "Xero", category: "Accounting" },
  { name: "Zoho Books", category: "Accounting" },
  { name: "Zoom", category: "Meetings" },
  { name: "Google Meet", category: "Meetings" },
  { name: "Next.js", category: "Infrastructure" },
  { name: "PostgreSQL", category: "Infrastructure" },
  { name: "Redis", category: "Infrastructure" },
  { name: "Docker", category: "Infrastructure" },
  { name: "Kubernetes", category: "Infrastructure" },
];

// ---------- LIVE: Client Journey ----------
// The platform's own real delivery methodology — describes how engagements
// are run, not a specific client's fabricated outcome.

export const CLIENT_JOURNEY_STEPS: ClientJourneyStep[] = [
  { step: 1, title: "Discovery", description: "We map your current workflows, tooling, and growth bottlenecks before proposing anything." },
  { step: 2, title: "Planning", description: "A scoped roadmap with clear milestones, integrations, and success criteria." },
  { step: 3, title: "Design", description: "Workflow and system design reviewed with your team before a single line of code ships." },
  { step: 4, title: "Development", description: "Iterative build with visibility into progress at every stage." },
  { step: 5, title: "Testing", description: "Functional and security testing before anything reaches production." },
  { step: 6, title: "Deployment", description: "Controlled rollout with rollback readiness." },
  { step: 7, title: "Training", description: "Hands-on enablement so your team runs the system confidently from day one." },
  { step: 8, title: "Support", description: "Ongoing maintenance and support per your service agreement." },
];

// ---------- LIVE: Enterprise Trust Bar ----------
// Confirmed as real, current business policy (2026-07-29).

export const TRUST_BAR_ITEMS: TrustBarItem[] = [
  { label: "Secure Development" },
  { label: "NDA Available" },
  { label: "Enterprise Support" },
  { label: "Source Code Ownership" },
  { label: "Documentation" },
  { label: "Training" },
  { label: "SLA" },
  { label: "Maintenance" },
];

// ---------- LIVE: Security & Compliance Badges ----------
// Restricted to claims independently verified against this codebase this
// session. Deliberately excludes: firewall/DDoS protection (not implemented
// by this app) and any third-party certification/partner badge (ISO/SOC2/
// PCI DSS/Microsoft/AWS/Google Cloud Partner) — none of those are real; see
// Certifications, which stays architecture-only until a real audit/
// partnership exists.

export const SECURITY_BADGES: SecurityBadge[] = [
  { label: "AES-256-GCM Encryption", description: "Sensitive data — agent memory, integration tokens, secrets, 2FA — encrypted at rest across independent key domains." },
  { label: "Automated Nightly Backups", description: "Checksummed database backups run automatically every night." },
  { label: "Role-Based Access Control", description: "Ten distinct membership roles with enforced, tenant-isolated permissions." },
  { label: "Hash-Chained Audit Logs", description: "Every sensitive action is logged in a tamper-evident, cryptographically chained audit trail." },
  { label: "GDPR Data Controls", description: "Self-service data export and a real cookie-consent system with default-off analytics." },
  { label: "SSL/TLS Encrypted", description: "All production traffic is served over HTTPS." },
  {
    label: "ISO 27001 / SOC 2 Readiness Program",
    description:
      "A real, working compliance program — asset inventory, risk register, policy center, statement of applicability, vendor register, and change management — not a claimed certification.",
  },
];

// ---------- LIVE: Why Companies Choose KVL ----------
// Grounded in this platform's real, already-verified feature set — not a
// claim about any specific named competitor.

export const COMPARISON_ROWS: ComparisonRow[] = [
  { category: "Documentation", kvl: "10 real, maintained guides covering deployment, security, compliance, and operations", typicalAgency: "Minimal or outdated documentation" },
  { category: "Security", kvl: "AES-256-GCM encryption, RBAC, and hash-chained audit logs built in", typicalAgency: "Security bolted on after launch, if at all" },
  { category: "Scalability", kvl: "Kubernetes manifests with autoscaling included, not an afterthought", typicalAgency: "Re-architected only once it becomes a problem" },
  { category: "Transparency", kvl: "You own your source code and infrastructure", typicalAgency: "Vendor lock-in is common" },
  { category: "Enterprise Readiness", kvl: "NDA, SLA, and formal support agreements available", typicalAgency: "Informal, ad-hoc engagement terms" },
  { category: "Maintenance", kvl: "Ongoing maintenance included per agreement", typicalAgency: "Support often ends at project handoff" },
  { category: "End-to-End Coverage", kvl: "One system covers leads, proposals, delivery, and billing — plus a client portal", typicalAgency: "You stitch together separate CRM, project, and invoicing tools yourself" },
  { category: "Revenue Reporting", kvl: "Attribution is traced to real paid invoices, not pipeline potential", typicalAgency: "Reports estimate value from deals that haven't actually been paid yet" },
];

// ---------- Architecture-only: no real content yet ----------
// Do not add example/placeholder entries here. Populate with real data
// before importing the corresponding component into a live page.

export const TRUSTED_BY_LOGOS: TrustedByLogo[] = [];
export const FEATURED_CLIENTS: FeaturedClient[] = [];
export const CASE_STUDIES: CaseStudy[] = [];
export const CLIENT_SUCCESS_STORIES: ClientSuccessStory[] = [];
export const TESTIMONIALS: Testimonial[] = [];
export const VIDEO_TESTIMONIALS: VideoTestimonial[] = [];
export const SUCCESS_METRICS: SuccessMetric[] = [];
export const BUSINESS_IMPACT_STATS: BusinessImpactStat[] = [];
export const INDUSTRY_EXPERIENCE: IndustryExperience[] = [];
export const CERTIFICATIONS: Certification[] = [];
export const AWARDS: Award[] = [];
export const MEDIA_MENTIONS: MediaMention[] = [];
export const GLOBAL_PRESENCE_MARKERS: GlobalPresenceMarker[] = [];
