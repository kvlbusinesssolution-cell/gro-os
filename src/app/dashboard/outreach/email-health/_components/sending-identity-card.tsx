"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pauseSendingIdentityAction, resumeSendingIdentityAction, configureSendingIdentityLimitsAction } from "../../_lib/email-health-actions";

const STATUS_VARIANT: Record<string, "outline" | "accent" | "secondary" | "default"> = {
  GOOD: "accent",
  NOT_VERIFIED: "outline",
  WARNING: "secondary",
  CRITICAL: "default",
};

export interface SendingIdentityRow {
  id: string;
  email: string;
  domain: string;
  provider: string;
  status: string;
  dailyLimit: number;
  hourlyLimit: number;
  sentToday: number;
  sentThisHour: number;
  cooldownUntil: string | null;
  pausedReason: string | null;
  lastSendAt: string | null;
  health: {
    status: string;
    healthScore: number;
    sampleSize: number;
    hardBounceRate: number | null;
    complaintRate: number | null;
    factors: { label: string; status: string; detail: string }[];
    action: string | null;
  };
}

export function SendingIdentityCard({ identity }: { identity: SendingIdentityRow }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState(String(identity.dailyLimit));
  const [hourlyLimit, setHourlyLimit] = useState(String(identity.hourlyLimit));
  const router = useRouter();

  function handlePause() {
    setError(null);
    startTransition(async () => {
      const result = await pauseSendingIdentityAction(identity.id, "Manually paused via Email Health Center.");
      if (!result.ok) return setError(result.error ?? "Failed to pause.");
      router.refresh();
    });
  }
  function handleResume() {
    setError(null);
    startTransition(async () => {
      const result = await resumeSendingIdentityAction(identity.id);
      if (!result.ok) return setError(result.error ?? "Failed to resume.");
      router.refresh();
    });
  }
  function handleSaveLimits() {
    setError(null);
    startTransition(async () => {
      const result = await configureSendingIdentityLimitsAction(identity.id, Number(dailyLimit), Number(hourlyLimit));
      if (!result.ok) return setError(result.error ?? "Failed to save limits.");
      router.refresh();
    });
  }

  return (
    <Card glass>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{identity.email}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[identity.health.status] ?? "outline"}>{identity.health.status}</Badge>
          <Badge variant="outline">{identity.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0 text-xs">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Provider</p>
            <p className="font-medium text-foreground">{identity.provider}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Sending Health</p>
            <p className="font-medium text-foreground">{identity.health.healthScore}/100</p>
          </div>
          <div>
            <p className="text-muted-foreground">Sent today</p>
            <p className="font-medium text-foreground">
              {identity.sentToday}/{identity.dailyLimit}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Sent this hour</p>
            <p className="font-medium text-foreground">
              {identity.sentThisHour}/{identity.hourlyLimit}
            </p>
          </div>
        </div>

        {identity.health.sampleSize < 20 ? (
          <p className="text-muted-foreground">Sample size {identity.health.sampleSize} — bounce/complaint rate NOT AVAILABLE until at least 20 real sends.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {identity.health.factors.map((f, i) => (
              <p key={i} className="text-muted-foreground">
                <span className="font-medium text-foreground">{f.label}:</span> {f.detail}
              </p>
            ))}
          </div>
        )}

        {identity.pausedReason && <p className="text-destructive">Paused: {identity.pausedReason}</p>}
        {identity.cooldownUntil && <p className="text-amber-600 dark:text-amber-400">In cooldown until {new Date(identity.cooldownUntil).toLocaleString()}.</p>}
        {error && <p className="text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {identity.status === "PAUSED" ? (
            <Button size="sm" variant="outline" onClick={handleResume} disabled={isPending}>
              Resume
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={handlePause} disabled={isPending}>
              Pause
            </Button>
          )}
          <Input className="h-8 w-20" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} aria-label="Daily limit" />
          <span className="text-muted-foreground">daily</span>
          <Input className="h-8 w-20" value={hourlyLimit} onChange={(e) => setHourlyLimit(e.target.value)} aria-label="Hourly limit" />
          <span className="text-muted-foreground">hourly</span>
          <Button size="sm" variant="outline" onClick={handleSaveLimits} disabled={isPending}>
            Save limits
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
