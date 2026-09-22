"use client";

import { useMemo, useState } from "react";
import { Sparkles, DollarSign, Globe, Megaphone, UserPlus, TrendingUp, FileSearch, Activity, Search, X } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CompanyTimelineEventType, TimelineEventSource } from "@/generated/prisma/client";

const BATCH_SIZE = 15;

const TYPE_ICON: Record<CompanyTimelineEventType, typeof Sparkles> = {
  CREATED: Sparkles,
  FUNDING: DollarSign,
  WEBSITE_UPDATE: Globe,
  ANNOUNCEMENT: Megaphone,
  HIRING: UserPlus,
  EXPANSION: TrendingUp,
  RESEARCH_NOTE: FileSearch,
  INTERNAL_ACTIVITY: Activity,
};

const SOURCE_STYLE: Record<TimelineEventSource, { label: string; className: string }> = {
  SYSTEM: { label: "Verified", className: "border-border bg-transparent text-foreground" },
  AI_RESEARCH: { label: "AI-inferred", className: "border-primary/20 bg-primary/10 text-primary" },
  MANUAL: { label: "Manual entry", className: "border-secondary bg-secondary text-secondary-foreground" },
};

export interface CompanyTimelineEventView {
  id: string;
  type: CompanyTimelineEventType;
  title: string;
  description: string | null;
  source: TimelineEventSource;
  occurredAt: string;
}

export function CompanyTimeline({ events }: { events: CompanyTimelineEventView[] }) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(BATCH_SIZE);

  const isFiltering = query.trim().length > 0;
  const filtered = useMemo(() => {
    if (!isFiltering) return events;
    const needle = query.trim().toLowerCase();
    return events.filter(
      (e) => e.title.toLowerCase().includes(needle) || (e.description?.toLowerCase().includes(needle) ?? false),
    );
  }, [events, query, isFiltering]);
  const visibleEvents = isFiltering ? filtered : filtered.slice(0, visible);

  if (events.length === 0) {
    return (
      <Card glass>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          No timeline activity yet. Generate an intelligence report or research note to start building this
          company&apos;s history.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search timeline..." className="pl-9 pr-9" />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {isFiltering && (
          <p className="text-xs text-muted-foreground">
            {filtered.length} of {events.length} match{events.length === 1 ? "" : "es"}
          </p>
        )}
      </div>

      {isFiltering && filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matches for &quot;{query.trim()}&quot;.</p>
      ) : (
        <>
          <ol className="flex flex-col gap-4">
            {visibleEvents.map((event, index) => {
              const Icon = TYPE_ICON[event.type];
              const sourceStyle = SOURCE_STYLE[event.source];
              return (
                <li key={event.id} className="relative flex gap-3 pb-4">
                  {index < visibleEvents.length - 1 && (
                    <span className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-border" aria-hidden />
                  )}
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{event.title}</p>
                      <Badge variant="outline" className={cn("text-[10px]", sourceStyle.className)}>
                        {sourceStyle.label}
                      </Badge>
                    </div>
                    {event.description && <p className="text-sm text-muted-foreground">{event.description}</p>}
                    <p className="text-xs text-muted-foreground">{new Date(event.occurredAt).toLocaleString()}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          {!isFiltering && filtered.length > visible && (
            <Button size="sm" variant="outline" className="w-fit" onClick={() => setVisible((v) => v + BATCH_SIZE)}>
              Show more ({filtered.length - visible} remaining)
            </Button>
          )}
        </>
      )}
    </div>
  );
}
