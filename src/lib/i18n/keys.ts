/**
 * Canonical English strings for the Command Center chrome — the source of
 * truth defining every translatable key. Every dictionary in
 * src/lib/i18n/dictionaries/ must implement exactly this key set (enforced
 * by TypeScript: each dictionary is typed `Record<TranslationKey, string>`).
 *
 * Scope: sidebar nav, top-nav chrome, Quick Actions, Command Palette, and
 * the Notification Center category tabs — the parts of the shell that
 * appear on every /dashboard/* page. Individual module page bodies (Company
 * detail forms, Analytics labels, etc.) are not yet wired through this and
 * still render in English — an honest, bounded scope rather than a
 * half-wired translation layer across the whole app.
 */
export const en = {
  // Sidebar
  "nav.dashboard": "Dashboard",
  "nav.aiCommandCenter": "AI Command Center",
  "nav.board": "AI Executive Board",
  "nav.companies": "Companies",
  "nav.career": "Career",
  "nav.companyDiscovery": "Company Discovery",
  "nav.opportunities": "AI Opportunities",
  "nav.priorityQueue": "AI Priority Queue",
  "nav.revenueCommandCenter": "Revenue Command Center",
  "nav.learning": "Revenue Learning",
  "nav.forecast": "Predictive Revenue",
  "nav.clients": "Clients",
  "nav.promptLibrary": "Prompt Library",
  "nav.hr": "HR",
  "nav.support": "Support",
  "nav.leadFinder": "Lead Finder",
  "nav.clientFinder": "Client Finder",
  "nav.growthEngine": "Growth Engine",
  "nav.websiteScanner": "Website Scanner",
  "nav.outreach": "Outreach",
  "nav.crm": "CRM",
  "nav.projects": "Projects",
  "nav.delivery": "Delivery",
  "nav.proposal": "Proposals",
  "nav.documents": "Documents",
  "nav.automation": "Automation",
  "nav.analytics": "Analytics",
  "nav.alerts": "Alerts",
  "nav.knowledgeBase": "Knowledge Base",
  "nav.search": "Enterprise Search",
  "nav.reports": "Reports",
  "nav.billing": "Billing",
  "nav.marketplace": "Marketplace",
  "nav.agency": "Agency Portal",
  "nav.partner": "Partner Program",
  "nav.referralPartners": "Referral Partners",
  "nav.settings": "Settings",

  // Top nav
  "topnav.search": "Search everything…",
  "topnav.language": "Language",

  // Quick Actions
  "qa.generateProposal": "Generate Proposal",
  "qa.startAiMeeting": "Start AI Meeting",
  "qa.createMeeting": "Create Meeting",
  "qa.createTask": "Create Task",
  "qa.createLead": "Create Lead",
  "qa.askAi": "Ask AI / Search",

  // Command palette
  "palette.placeholder": "Search or type a command…",
  "palette.askAi": "Ask AI",
  "palette.noResults": "No results found.",

  // Notification center
  "notif.title": "Notifications",
  "notif.markAllRead": "Mark all read",
  "notif.empty": "No notifications yet.",
  "notif.emptyCategory": "Nothing in this category.",
  "notif.category.all": "All",
  "notif.category.critical": "Critical",
  "notif.category.meetings": "Meetings",
  "notif.category.decisions": "AI Decisions",
  "notif.category.approvals": "Approvals",
  "notif.category.emails": "Emails",
  "notif.category.crm": "CRM",
  "notif.category.automation": "Automation",
  "notif.category.system": "System",
} as const;

export type TranslationKey = keyof typeof en;
export type Dictionary = Record<TranslationKey, string>;
