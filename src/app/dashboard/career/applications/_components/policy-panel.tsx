"use client";

import { useState, useTransition } from "react";
import { Info } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { updateApplicationPolicy } from "../../_lib/application-actions";
import type { ApplicationAutomationMode, ApplicationEligibilityStatus } from "@/generated/prisma/client";

export interface PolicyPanelProps {
  careerProfileId: string;
  applicationAutomationMode: ApplicationAutomationMode;
  maxApplicationsPerDay: number;
  maxApplicationsPerWeek: number;
  minEligibilityForAutoApply: ApplicationEligibilityStatus;
  applicationRequireApproval: boolean;
}

export function PolicyPanel(props: PolicyPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState(props.applicationAutomationMode);
  const [maxPerDay, setMaxPerDay] = useState(props.maxApplicationsPerDay);
  const [maxPerWeek, setMaxPerWeek] = useState(props.maxApplicationsPerWeek);
  const [minEligibility, setMinEligibility] = useState(props.minEligibilityForAutoApply);
  const [requireApproval, setRequireApproval] = useState(props.applicationRequireApproval);
  const [saved, setSaved] = useState(false);

  function save() {
    setSaved(false);
    startTransition(() => {
      void updateApplicationPolicy(props.careerProfileId, {
        applicationAutomationMode: mode,
        applicationRequireApproval: requireApproval,
        maxApplicationsPerDay: maxPerDay,
        maxApplicationsPerWeek: maxPerWeek,
        minEligibilityForAutoApply: minEligibility,
      }).then((result) => setSaved(result.ok));
    });
  }

  return (
    <Card glass>
      <CardContent className="flex flex-col gap-4 p-5">
        <p className="text-sm font-medium text-foreground">Automation policy</p>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Discovery-only is the default — nothing is ever prepared or submitted without your explicit choice. Even in
          Full Autonomous mode, every single application still passes a real, independently-checked safety gate before
          anything is sent, and most real job platforms today have no authorized automated submission path at all — those
          are always prepared for you to apply manually, never silently skipped or faked.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label htmlFor="automationMode" className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Automation mode</span>
            <Select id="automationMode" value={mode} onChange={(e) => setMode(e.target.value as ApplicationAutomationMode)}>
              <option value="DISCOVERY_ONLY">Discovery only</option>
              <option value="AI_PREPARE">AI prepare (no submit)</option>
              <option value="APPLY_WITH_APPROVAL">Apply with approval</option>
              <option value="AUTO_APPLY_APPROVED">Auto-apply (approved policy)</option>
              <option value="FULL_AUTONOMOUS">Full autonomous</option>
            </Select>
          </label>
          <label htmlFor="minEligibility" className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Minimum eligibility to auto-apply</span>
            <Select id="minEligibility" value={minEligibility} onChange={(e) => setMinEligibility(e.target.value as ApplicationEligibilityStatus)}>
              <option value="ELIGIBLE">Eligible</option>
              <option value="LIKELY_ELIGIBLE">Likely eligible</option>
              <option value="REVIEW_REQUIRED">Review required</option>
            </Select>
          </label>
          <label className="flex items-center gap-2 pt-5">
            <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} className="size-4" />
            <span className="text-sm text-foreground">Always require my approval</span>
          </label>
          <label htmlFor="maxPerDay" className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Max applications / day</span>
            <Input id="maxPerDay" type="number" min={1} max={100} value={maxPerDay} onChange={(e) => setMaxPerDay(Number(e.target.value))} />
          </label>
          <label htmlFor="maxPerWeek" className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Max applications / week</span>
            <Input id="maxPerWeek" type="number" min={1} max={500} value={maxPerWeek} onChange={(e) => setMaxPerWeek(Number(e.target.value))} />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={save}
            className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            Save policy
          </button>
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved.</span>}
        </div>
      </CardContent>
    </Card>
  );
}
