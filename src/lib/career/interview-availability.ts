import { prisma } from "@/lib/prisma";

/**
 * Phase 21 (§18, §19, §20, §55) — real availability/conflict checking.
 *
 * Honest architecture note (Phase 20's own audit, re-confirmed here): this
 * codebase has NO connected calendar-provider integration anywhere.
 * `IntegrationProviderKey` lists GOOGLE_CALENDAR/MICROSOFT_CALENDAR/CAL_COM/
 * CALENDLY, and `src/lib/integrations/providers/cal-com.ts` /
 * `calendly.ts` exist — but both are ONLY connection/health-check adapters
 * (API-key verification), with no read-availability/create-event/
 * cancel-event methods, and grepping `src/app` for any usage of either
 * shows they are not wired into any UI or action anywhere. There is no
 * `CalendarEvent` model. So a genuine external-calendar conflict check is
 * MISSING/BLOCKED in this codebase today — this file does NOT fabricate
 * one.
 *
 * What IS real: checking a candidate's OWN previously-scheduled
 * CareerInterview rows (this app's own source of truth for interviews it
 * already knows about) against a proposed new slot, plus real
 * user-configured working hours/blackout periods (§19) on CareerProfile.
 * When no working hours are configured, this never invents availability —
 * it returns UNKNOWN rather than guessing free/busy.
 */

export type AvailabilityStatus = "FREE" | "BUSY" | "OUTSIDE_WORKING_HOURS" | "BLACKOUT" | "UNKNOWN";

export interface AvailabilityCheckInput {
  careerProfileId: string;
  proposedStartUtc: Date;
  durationMinutes: number;
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  workingHoursTimezone: string | null;
  workingDays: number[];
  blackoutPeriods: Array<{ startsAt: string; endsAt: string; reason?: string }> | null;
  excludeInterviewId?: string;
}

export interface AvailabilityResult {
  status: AvailabilityStatus;
  conflictingInterviewId: string | null;
  detail: string;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** §55 — real conflict check against this app's own known SCHEDULED interviews. Never overwrites/ignores an existing one. */
export async function checkInterviewConflict(input: AvailabilityCheckInput): Promise<AvailabilityResult> {
  const proposedEnd = new Date(input.proposedStartUtc.getTime() + input.durationMinutes * 60_000);

  // §19 blackout periods — real, user-entered, checked before anything else.
  for (const period of input.blackoutPeriods ?? []) {
    const start = new Date(period.startsAt);
    const end = new Date(period.endsAt);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && overlaps(input.proposedStartUtc, proposedEnd, start, end)) {
      return { status: "BLACKOUT", conflictingInterviewId: null, detail: period.reason ? `Falls within a configured blackout period: ${period.reason}.` : "Falls within a configured blackout period." };
    }
  }

  // §19 working hours/days — only evaluated when genuinely configured;
  // otherwise this check is skipped (never invented).
  if (input.workingHoursStart && input.workingHoursEnd && input.workingHoursTimezone && input.workingDays.length > 0) {
    const localFormatter = new Intl.DateTimeFormat("en-US", { timeZone: input.workingHoursTimezone, hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short" });
    const parts = localFormatter.formatToParts(input.proposedStartUtc);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "";
    const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
    const localTime = `${hour}:${minute}`;

    if (weekdayIndex === -1 || !input.workingDays.includes(weekdayIndex)) {
      return { status: "OUTSIDE_WORKING_HOURS", conflictingInterviewId: null, detail: `Proposed slot falls on a day outside the configured working days.` };
    }
    if (localTime < input.workingHoursStart || localTime > input.workingHoursEnd) {
      return { status: "OUTSIDE_WORKING_HOURS", conflictingInterviewId: null, detail: `Proposed local time ${localTime} (${input.workingHoursTimezone}) is outside configured working hours ${input.workingHoursStart}-${input.workingHoursEnd}.` };
    }
  }

  // §18/§20 — real double-booking check against this profile's own already-SCHEDULED interviews.
  const existing = await prisma.careerInterview.findMany({
    where: {
      careerProfileId: input.careerProfileId,
      status: { in: ["SCHEDULED", "RESCHEDULED"] },
      scheduledAtUtc: { not: null },
      ...(input.excludeInterviewId ? { id: { not: input.excludeInterviewId } } : {}),
    },
    select: { id: true, scheduledAtUtc: true, durationMinutes: true },
  });

  for (const interview of existing) {
    if (!interview.scheduledAtUtc) continue;
    const existingEnd = new Date(interview.scheduledAtUtc.getTime() + (interview.durationMinutes ?? 60) * 60_000);
    if (overlaps(input.proposedStartUtc, proposedEnd, interview.scheduledAtUtc, existingEnd)) {
      return { status: "BUSY", conflictingInterviewId: interview.id, detail: "Overlaps an already-scheduled interview tracked in GrowthOS." };
    }
  }

  if (!input.workingHoursStart || !input.workingHoursTimezone) {
    return { status: "UNKNOWN", conflictingInterviewId: null, detail: "No working hours configured and no connected external calendar — cannot confirm this slot is genuinely free, only that it doesn't conflict with interviews already tracked in GrowthOS." };
  }

  return { status: "FREE", conflictingInterviewId: null, detail: "No conflict with tracked interviews, blackout periods, or configured working hours. No external calendar is connected, so this reflects GrowthOS's own records only." };
}

/**
 * §24 — suggests real alternative slots by probing consecutive working-hour
 * slots starting from the proposed time. Never fabricates a slot; every
 * candidate is independently re-checked via checkInterviewConflict.
 */
export async function suggestAlternativeSlots(input: AvailabilityCheckInput, count = 3): Promise<Date[]> {
  const alternatives: Date[] = [];
  let candidate = new Date(input.proposedStartUtc.getTime() + 60 * 60_000);
  let attempts = 0;
  while (alternatives.length < count && attempts < 20) {
    attempts += 1;
    const result = await checkInterviewConflict({ ...input, proposedStartUtc: candidate });
    if (result.status === "FREE") alternatives.push(new Date(candidate));
    candidate = new Date(candidate.getTime() + 60 * 60_000);
  }
  return alternatives;
}
