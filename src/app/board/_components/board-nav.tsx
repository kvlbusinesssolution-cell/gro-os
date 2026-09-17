"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Calendar, MessageSquare, ListChecks, CheckSquare, Activity as ActivityIcon, BarChart3, ShieldCheck, Globe2, Target, Gauge, Newspaper, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/board", label: "Dashboard", icon: LayoutDashboard },
  { href: "/board/today", label: "Today", icon: Sparkles },
  { href: "/board/brief", label: "Daily Brief", icon: Newspaper },
  { href: "/board/growth", label: "Growth", icon: Gauge },
  { href: "/board/meetings", label: "Meetings", icon: Calendar },
  { href: "/board/reviews", label: "Proposal Reviews", icon: ShieldCheck },
  { href: "/board/chat", label: "Chat", icon: MessageSquare },
  { href: "/board/tasks", label: "Tasks", icon: ListChecks },
  { href: "/board/action-items", label: "Action Items", icon: CheckSquare },
  { href: "/board/activity", label: "Activity", icon: ActivityIcon },
  { href: "/board/reports", label: "Reports", icon: BarChart3 },
  { href: "/board/intelligence", label: "Intelligence", icon: Globe2 },
  { href: "/board/strategy", label: "Strategy", icon: Target },
] as const;

export function BoardNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {LINKS.map((link) => {
        const isActive = link.href === "/board" ? pathname === "/board" : pathname.startsWith(link.href);
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
