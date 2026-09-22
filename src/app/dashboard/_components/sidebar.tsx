"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Sparkles,
  Bot,
  Building2,
  Radar,
  Target,
  ListOrdered,
  UserSearch,
  Handshake,
  Globe,
  Megaphone,
  Users,
  FolderKanban,
  Gavel,
  FileText,
  BookOpen,
  Workflow,
  BarChart3,
  AlertTriangle,
  Library,
  Search,
  FileBarChart,
  CreditCard,
  Store,
  Building,
  Percent,
  Settings,
  TrendingUp,
  HeartPulse,
  Wand2,
  Briefcase,
  LifeBuoy,
  Share2,
  Gauge,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/translation-provider";
import type { TranslationKey } from "@/lib/i18n";

const LINKS = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/ai-command-center", labelKey: "nav.aiCommandCenter", icon: Sparkles },
  { href: "/board", labelKey: "nav.board", icon: Bot },
  { href: "/dashboard/companies", labelKey: "nav.companies", icon: Building2 },
  { href: "/dashboard/company-discovery", labelKey: "nav.companyDiscovery", icon: Radar },
  { href: "/dashboard/opportunities", labelKey: "nav.opportunities", icon: Target },
  { href: "/dashboard/priority-queue", labelKey: "nav.priorityQueue", icon: ListOrdered },
  { href: "/dashboard/revenue-command-center", labelKey: "nav.revenueCommandCenter", icon: Gauge },
  { href: "/dashboard/learning", labelKey: "nav.learning", icon: BarChart3 },
  { href: "/dashboard/forecast", labelKey: "nav.forecast", icon: TrendingUp },
  { href: "/dashboard/clients", labelKey: "nav.clients", icon: HeartPulse },
  { href: "/dashboard/lead-finder", labelKey: "nav.leadFinder", icon: UserSearch },
  { href: "/dashboard/client-finder", labelKey: "nav.clientFinder", icon: Handshake },
  { href: "/dashboard/growth-engine", labelKey: "nav.growthEngine", icon: TrendingUp },
  { href: "/dashboard/website-scanner", labelKey: "nav.websiteScanner", icon: Globe },
  { href: "/dashboard/outreach", labelKey: "nav.outreach", icon: Megaphone },
  { href: "/dashboard/crm", labelKey: "nav.crm", icon: Users },
  { href: "/dashboard/projects", labelKey: "nav.projects", icon: FolderKanban },
  { href: "/dashboard/delivery", labelKey: "nav.delivery", icon: Gavel },
  { href: "/dashboard/proposal", labelKey: "nav.proposal", icon: FileText },
  { href: "/dashboard/documents", labelKey: "nav.documents", icon: BookOpen },
  { href: "/dashboard/automation", labelKey: "nav.automation", icon: Workflow },
  { href: "/dashboard/analytics", labelKey: "nav.analytics", icon: BarChart3 },
  { href: "/dashboard/alerts", labelKey: "nav.alerts", icon: AlertTriangle },
  { href: "/dashboard/knowledge-base", labelKey: "nav.knowledgeBase", icon: Library },
  { href: "/dashboard/prompt-library", labelKey: "nav.promptLibrary", icon: Wand2 },
  { href: "/dashboard/hr", labelKey: "nav.hr", icon: Briefcase },
  { href: "/dashboard/support", labelKey: "nav.support", icon: LifeBuoy },
  { href: "/dashboard/search", labelKey: "nav.search", icon: Search },
  { href: "/board/reports", labelKey: "nav.reports", icon: FileBarChart },
  { href: "/dashboard/billing", labelKey: "nav.billing", icon: CreditCard },
  { href: "/dashboard/marketplace", labelKey: "nav.marketplace", icon: Store },
  { href: "/dashboard/agency", labelKey: "nav.agency", icon: Building },
  { href: "/dashboard/partner", labelKey: "nav.partner", icon: Percent },
  { href: "/dashboard/referral-partners", labelKey: "nav.referralPartners", icon: Share2 },
  { href: "/profile", labelKey: "nav.settings", icon: Settings },
] satisfies Array<{ href: string; labelKey: TranslationKey; icon: typeof LayoutDashboard; exact?: boolean }>;

export function DashboardSidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const t = useT();

  return (
    <nav className={cn("flex flex-col gap-1 overflow-y-auto p-3", className)}>
      {LINKS.map((link) => {
        const isActive = "exact" in link && link.exact ? pathname === link.href : pathname.startsWith(link.href);
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "inline-flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{t(link.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
