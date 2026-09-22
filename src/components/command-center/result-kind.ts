import type { ComponentType } from "react";
import {
  Calendar,
  ListChecks,
  Gavel,
  UserSquare2,
  MessageSquare,
  Bell,
  Bot,
  LayoutDashboard,
  Building2,
  UserCircle,
  BarChart3,
  Activity as ActivityIcon,
  SunMoon,
  Users2,
  FolderKanban,
  FileText,
  FileIcon,
  BookOpen,
  Bookmark,
  Search as SearchIcon,
  Sparkles,
  Globe,
  Contact as ContactIcon,
  Megaphone,
  Handshake,
  ReceiptText,
  FileSignature,
  Receipt,
  ScrollText,
  ShieldAlert,
  FileStack,
  Briefcase,
  Send,
  UserRound,
} from "lucide-react";

import type { SearchResult, SearchResultKind } from "@/lib/search";

type IconType = ComponentType<{ className?: string }>;

/** Icon shown per src/lib/search.ts SearchResultKind, shared by the Command Palette and Global Search. */
export const RESULT_KIND_ICONS: Record<SearchResultKind, IconType> = {
  meeting: Calendar,
  task: ListChecks,
  decision: Gavel,
  lead: UserSquare2,
  conversation: MessageSquare,
  notification: Bell,
  agent: Bot,
  company: Building2,
  client: Users2,
  project: FolderKanban,
  proposal: FileText,
  document: FileIcon,
  article: BookOpen,
  watchlist: Bookmark,
  savedSearch: SearchIcon,
  companyIntelligence: Sparkles,
  websiteScan: Globe,
  contact: ContactIcon,
  campaign: Megaphone,
  deal: Handshake,
  quotation: ReceiptText,
  contract: FileSignature,
  invoice: Receipt,
  businessDocument: ScrollText,
  projectRisk: ShieldAlert,
  ingestedDocument: FileStack,
  job: Briefcase,
  careerApplication: Send,
  careerProfile: UserRound,
};

/** Group heading shown per kind. */
export const RESULT_KIND_LABELS: Record<SearchResultKind, string> = {
  meeting: "Meetings",
  task: "Tasks",
  decision: "Decisions",
  lead: "Leads",
  conversation: "Conversations",
  notification: "Notifications",
  agent: "Agents",
  company: "Companies",
  client: "Clients",
  project: "Projects",
  proposal: "Proposals",
  document: "Documents",
  article: "Knowledge Base",
  watchlist: "Watchlists",
  savedSearch: "Saved Searches",
  companyIntelligence: "Intelligence Reports",
  websiteScan: "Website Scans",
  contact: "Contacts",
  campaign: "Campaigns",
  deal: "Deals",
  quotation: "Quotations",
  contract: "Contracts",
  invoice: "Invoices",
  businessDocument: "Legal & Project Docs",
  projectRisk: "Project Risks",
  ingestedDocument: "Knowledge Documents",
  job: "Jobs",
  careerApplication: "Job Applications",
  careerProfile: "Career Profiles",
};

/**
 * Icon per src/lib/commands.ts CommandDefinition.id — that module is
 * intentionally UI-agnostic (importable from server code), so the
 * id -> icon mapping lives here instead of on the command itself.
 */
export const NAV_COMMAND_ICONS: Record<string, IconType> = {
  "nav.dashboard": LayoutDashboard,
  "nav.board": Bot,
  "nav.meetings": Calendar,
  "nav.tasks": ListChecks,
  "nav.chat": MessageSquare,
  "nav.activity": ActivityIcon,
  "nav.reports": BarChart3,
  "nav.profile": UserCircle,
  "nav.company": Building2,
  "theme.toggle": SunMoon,
};

/**
 * Simple, dependency-free keyword match used to filter the static
 * navigation command list client-side as the user types (cmdk's own fuzzy
 * filter is disabled — see command-palette.tsx — so this + the server
 * search results + the "Ask AI" fallback are combined manually).
 */
export function matchesNavQuery(label: string, keywords: string[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (label.toLowerCase().includes(q)) return true;
  return keywords.some((kw) => kw.toLowerCase().includes(q));
}

/**
 * Groups flat globalSearch() results by kind, preserving each kind's
 * relative first-appearance order — shared by the Command Palette (cmdk
 * groups) and the standalone Global Search dropdown (plain groups).
 */
export function groupResultsByKind(results: SearchResult[]): Array<[SearchResultKind, SearchResult[]]> {
  const map = new Map<SearchResultKind, SearchResult[]>();
  for (const result of results) {
    const bucket = map.get(result.kind);
    if (bucket) bucket.push(result);
    else map.set(result.kind, [result]);
  }
  return Array.from(map.entries());
}
