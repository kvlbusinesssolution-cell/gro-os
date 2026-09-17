import Link from "next/link";
import { Sparkles, Send, MailOpen, MousePointerClick, AlertTriangle, Trophy, Target } from "lucide-react";

import { AnimatedCounter } from "@/components/ui/animated-counter";
import type { KvlOutreachSummary } from "@/lib/business-development/kvl-sector-discovery-job";

const ITEMS: Array<{ key: keyof Omit<KvlOutreachSummary, "campaignId" | "dailyTarget">; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "todaySent", label: "Sent today", icon: Send },
  { key: "todayOpened", label: "Opened today", icon: MailOpen },
  { key: "todayClicked", label: "Clicked today", icon: MousePointerClick },
  { key: "todayFailed", label: "Failed today", icon: AlertTriangle },
  { key: "allTimeSent", label: "Sent all-time", icon: Sparkles },
  { key: "conversions", label: "Converted (Won)", icon: Trophy },
];

/**
 * Only rendered when getKvlOutreachSummary() finds a real "KVL Sector
 * Outreach" campaign for the viewer's own org — i.e. only KVL's owner ever
 * sees this, since that campaign only ever gets created by
 * kvl-sector-discovery-job.ts scoped to KVL's own organization.
 */
export function KvlOutreachSummaryCard({ summary }: { summary: KvlOutreachSummary }) {
  const target = summary.dailyTarget;
  const pct = Math.min(100, Math.round((summary.todaySent / target) * 100));

  return (
    <div className="glass-panel flex flex-col gap-4 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">KVL Sector Outreach — today&rsquo;s floor: {summary.todaySent}/{target}</h2>
        </div>
        <Link href={`/dashboard/outreach/campaigns/${summary.campaignId}`} className="text-xs text-primary hover:underline">
          View campaign
        </Link>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ITEMS.map(({ key, label, icon: Icon }) => (
          <div key={key} className="flex flex-col gap-1.5 rounded-lg border border-border/60 p-3">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Icon className="size-3.5" /> {label}
            </span>
            <span className="text-lg font-semibold tracking-tight text-foreground">
              <AnimatedCounter value={summary[key]} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
