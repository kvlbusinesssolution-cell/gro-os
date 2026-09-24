import { getFreshAccessToken } from "@/lib/integrations/connection-store";

/**
 * Real Google Calendar event read/write, built on top of the existing
 * GOOGLE_CALENDAR OAuth adapter (src/lib/integrations/providers/
 * google-oauth.ts) — that adapter only ever handled connect/health-check;
 * nothing in this codebase previously called the actual Calendar API to
 * create/update/delete an event or check free/busy time
 * (interview-availability.ts's own doc comment documented this gap
 * honestly). This module is the real client that closes it. Plain fetch
 * against Google's stable REST endpoints, matching this codebase's
 * lean-dependency style — same convention as google-oauth.ts.
 *
 * Every function here is org-scoped and returns null/false on "not
 * connected" or a genuine API failure — never throws for the common case of
 * no connected calendar, since calendar sync must always be a best-effort
 * enhancement on top of GrowthOS's own real interview/meeting records, never
 * a hard dependency that could block scheduling.
 */

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const PROVIDER = "GOOGLE_CALENDAR" as const;

export interface CalendarEventInput {
  summary: string;
  description?: string | null;
  location?: string | null;
  startUtc: Date;
  endUtc: Date;
  attendeeEmails?: string[];
}

export interface CalendarEventResult {
  eventId: string;
  htmlLink: string | null;
}

interface GoogleCalendarEventResponse {
  id: string;
  htmlLink?: string;
  error?: { message?: string };
}

function toGoogleEventBody(event: CalendarEventInput) {
  return {
    summary: event.summary,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    start: { dateTime: event.startUtc.toISOString(), timeZone: "UTC" },
    end: { dateTime: event.endUtc.toISOString(), timeZone: "UTC" },
    attendees: event.attendeeEmails?.length ? event.attendeeEmails.map((email) => ({ email })) : undefined,
  };
}

/** Creates a real event on the org's connected Google Calendar (primary calendar). Returns null when not connected or the API call fails — callers must treat that exactly like "no calendar integration", not an error to surface to the end user. */
export async function createGoogleCalendarEvent(organizationId: string, event: CalendarEventInput): Promise<CalendarEventResult | null> {
  const accessToken = await getFreshAccessToken(organizationId, PROVIDER);
  if (!accessToken) return null;

  try {
    const response = await fetch(`${CALENDAR_BASE}/calendars/primary/events?sendUpdates=all`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(toGoogleEventBody(event)),
    });
    const body = (await response.json().catch(() => ({}))) as GoogleCalendarEventResponse;
    if (!response.ok || !body.id) {
      console.error(`[google-calendar] createEvent failed for org ${organizationId} (HTTP ${response.status}): ${body.error?.message ?? "unknown error"}`);
      return null;
    }
    return { eventId: body.id, htmlLink: body.htmlLink ?? null };
  } catch (error) {
    console.error(`[google-calendar] createEvent request failed for org ${organizationId}:`, error);
    return null;
  }
}

/** Updates an existing event's time/details (used for a real reschedule) — best-effort, same non-throwing contract as createGoogleCalendarEvent. */
export async function updateGoogleCalendarEvent(organizationId: string, eventId: string, event: CalendarEventInput): Promise<boolean> {
  const accessToken = await getFreshAccessToken(organizationId, PROVIDER);
  if (!accessToken) return false;

  try {
    const response = await fetch(`${CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(toGoogleEventBody(event)),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[google-calendar] updateEvent failed for org ${organizationId} (HTTP ${response.status}): ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[google-calendar] updateEvent request failed for org ${organizationId}:`, error);
    return false;
  }
}

/** Cancels/deletes a real calendar event (interview rejected/withdrawn) — a 404 (already gone) is treated as success, not a failure. */
export async function deleteGoogleCalendarEvent(organizationId: string, eventId: string): Promise<boolean> {
  const accessToken = await getFreshAccessToken(organizationId, PROVIDER);
  if (!accessToken) return false;

  try {
    const response = await fetch(`${CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const body = await response.text().catch(() => "");
      console.error(`[google-calendar] deleteEvent failed for org ${organizationId} (HTTP ${response.status}): ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[google-calendar] deleteEvent request failed for org ${organizationId}:`, error);
    return false;
  }
}

export interface FreeBusyInterval {
  startUtc: Date;
  endUtc: Date;
}

/**
 * Real free/busy check against the org's connected Google Calendar
 * (primary calendar) for a UTC time window — closes the exact gap
 * interview-availability.ts's doc comment names ("no external-calendar
 * conflict check exists"). Returns null when not connected, [] when
 * genuinely free (never fabricated) — same non-throwing contract as the
 * write functions above.
 */
export async function getGoogleCalendarFreeBusy(organizationId: string, windowStartUtc: Date, windowEndUtc: Date): Promise<FreeBusyInterval[] | null> {
  const accessToken = await getFreshAccessToken(organizationId, PROVIDER);
  if (!accessToken) return null;

  try {
    const response = await fetch(`${CALENDAR_BASE}/freeBusy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: windowStartUtc.toISOString(),
        timeMax: windowEndUtc.toISOString(),
        items: [{ id: "primary" }],
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }>;
    };
    if (!response.ok) {
      console.error(`[google-calendar] freeBusy failed for org ${organizationId} (HTTP ${response.status})`);
      return null;
    }
    const busy = body.calendars?.primary?.busy ?? [];
    return busy.map((interval) => ({ startUtc: new Date(interval.start), endUtc: new Date(interval.end) }));
  } catch (error) {
    console.error(`[google-calendar] freeBusy request failed for org ${organizationId}:`, error);
    return null;
  }
}
