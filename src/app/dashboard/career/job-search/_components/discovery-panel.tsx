"use client";

import { useState, useTransition } from "react";
import { Search, Info } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { triggerJobDiscovery, updateJobDiscoveryConfig } from "../../_lib/job-actions";

export interface DiscoveryPanelProps {
  careerProfileId: string;
  discoveryEnabled: boolean;
  discoveryFrequency: string;
  minMatchThreshold: number;
}

export function DiscoveryPanel({ careerProfileId, discoveryEnabled, discoveryFrequency, minMatchThreshold }: DiscoveryPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(discoveryEnabled);
  const [frequency, setFrequency] = useState(discoveryFrequency);
  const [threshold, setThreshold] = useState(minMatchThreshold);
  const [runResult, setRunResult] = useState<{ ok: boolean; error?: string; newJobsCount?: number; duplicatesCount?: number; resultCount?: number } | null>(null);

  function saveConfig() {
    startTransition(() => {
      void updateJobDiscoveryConfig(careerProfileId, { discoveryEnabled: enabled, discoveryFrequency: frequency as "MANUAL_ONLY" | "DAILY" | "WEEKLY", minMatchThreshold: threshold });
    });
  }

  function runNow() {
    setRunResult(null);
    startTransition(async () => {
      const result = await triggerJobDiscovery(careerProfileId);
      setRunResult(result);
    });
  }

  return (
    <Card glass>
      <CardContent className="flex flex-col gap-4 p-5">
        <p className="text-sm font-medium text-foreground">Job discovery</p>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Real jobs from Remotive (remote tech roles), matched against your verified profile. Every result links back to
          the real source — no fabricated listings. Searches are rate-limited (max one every few hours) out of respect
          for Remotive&apos;s free public API.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label htmlFor="discoveryFrequency" className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Discovery frequency</span>
            <Select id="discoveryFrequency" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              <option value="MANUAL_ONLY">Manual only</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
            </Select>
          </label>
          <label htmlFor="minMatchThreshold" className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Minimum match threshold</span>
            <Input id="minMatchThreshold" type="number" min={0} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          </label>
          <label className="flex items-center gap-2 pt-5">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4" />
            <span className="text-sm text-foreground">Enable scheduled discovery</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={saveConfig}
            className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            Save settings
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={runNow}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Search className="size-3.5" /> {isPending ? "Searching…" : "Search now"}
          </button>
        </div>

        {runResult && (
          <p className={`text-xs ${runResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
            {runResult.ok
              ? `Found ${runResult.resultCount ?? 0} real result(s) — ${runResult.newJobsCount ?? 0} new, ${runResult.duplicatesCount ?? 0} already known.`
              : runResult.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
