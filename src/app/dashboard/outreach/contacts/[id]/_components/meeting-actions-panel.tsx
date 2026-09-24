"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmMeeting, rescheduleMeeting, cancelMeeting } from "../../../_lib/meeting-actions";

export function MeetingActionsPanel({ meetingId, status, scheduledAt }: { meetingId: string; status: string; scheduledAt: Date | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });
  }

  if (status === "CANCELLED" || status === "DECLINED" || status === "COMPLETED") return null;

  const label = status === "CONFIRMED" ? "Reschedule" : "Confirm";

  return (
    <div className="flex flex-col gap-2">
      {status === "CONFIRMED" && scheduledAt && (
        <p className="text-xs text-muted-foreground">Scheduled for {scheduledAt.toLocaleString()}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="datetime-local"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="h-8 w-auto text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !time}
          onClick={() =>
            run(() => (status === "CONFIRMED" ? rescheduleMeeting(meetingId, new Date(time)) : confirmMeeting(meetingId, new Date(time))))
          }
        >
          {pending ? "Saving…" : label}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelMeeting(meetingId))}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
