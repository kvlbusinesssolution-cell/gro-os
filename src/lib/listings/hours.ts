const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export { WEEKDAYS };

export interface DayHours {
  open: string; // "HH:mm", 24h
  close: string; // "HH:mm", 24h
  closed: boolean;
}

export type BusinessHours = Record<Weekday, DayHours>;

const JS_DAY_TO_WEEKDAY: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Real "open now" check against a BusinessListing.openingHours JSON blob.
 * Missing/malformed data reads as "unknown" (false) rather than throwing —
 * the badge simply doesn't render rather than crashing the page a business
 * that hasn't filled in hours yet would otherwise 500 on.
 */
export function isOpenNow(hours: unknown, now: Date = new Date()): boolean {
  if (!hours || typeof hours !== "object") return false;
  const day = JS_DAY_TO_WEEKDAY[now.getDay()];
  const dayHours = (hours as Partial<BusinessHours>)[day];
  if (!dayHours || dayHours.closed) return false;
  if (typeof dayHours.open !== "string" || typeof dayHours.close !== "string") return false;

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = dayHours.open.split(":").map(Number);
  const [closeH, closeM] = dayHours.close.split(":").map(Number);
  if ([openH, openM, closeH, closeM].some((n) => Number.isNaN(n))) return false;

  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;
  if (closeMinutes <= openMinutes) return false; // overnight hours not supported in v1 — treat as misconfigured rather than guess
  return minutesNow >= openMinutes && minutesNow < closeMinutes;
}

export function emptyBusinessHours(): BusinessHours {
  return WEEKDAYS.reduce((acc, day) => {
    acc[day] = { open: "09:00", close: "18:00", closed: false };
    return acc;
  }, {} as BusinessHours);
}
