import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Mocked at the real external boundary: the OAuth token store
 * (connection-store.ts) and global fetch (Google's Calendar REST API) —
 * never the create/update/delete/freeBusy logic itself.
 */
const getFreshAccessToken = vi.fn();
vi.mock("@/lib/integrations/connection-store", () => ({
  getFreshAccessToken: (...args: unknown[]) => getFreshAccessToken(...args),
}));

const {
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getGoogleCalendarFreeBusy,
} = await import("./google-calendar-events");

const EVENT_INPUT = {
  summary: "Discovery call",
  description: "Agenda",
  startUtc: new Date("2026-10-01T10:00:00Z"),
  endUtc: new Date("2026-10-01T10:30:00Z"),
};

describe("google-calendar-events.ts", () => {
  beforeEach(() => {
    getFreshAccessToken.mockReset();
    vi.restoreAllMocks();
  });

  describe("createGoogleCalendarEvent", () => {
    it("returns null when no calendar is connected — never blocks the caller", async () => {
      getFreshAccessToken.mockResolvedValue(null);
      const result = await createGoogleCalendarEvent("org-1", EVENT_INPUT);
      expect(result).toBeNull();
    });

    it("returns the real event id/link on a successful create", async () => {
      getFreshAccessToken.mockResolvedValue("token-abc");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "evt-1", htmlLink: "https://calendar.google.com/evt-1" }) }),
      );
      const result = await createGoogleCalendarEvent("org-1", EVENT_INPUT);
      expect(result).toEqual({ eventId: "evt-1", htmlLink: "https://calendar.google.com/evt-1" });
    });

    it("returns null (never throws) on a non-ok API response", async () => {
      getFreshAccessToken.mockResolvedValue("token-abc");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { message: "forbidden" } }) }));
      const result = await createGoogleCalendarEvent("org-1", EVENT_INPUT);
      expect(result).toBeNull();
    });
  });

  describe("updateGoogleCalendarEvent", () => {
    it("returns false when no calendar is connected", async () => {
      getFreshAccessToken.mockResolvedValue(null);
      const result = await updateGoogleCalendarEvent("org-1", "evt-1", EVENT_INPUT);
      expect(result).toBe(false);
    });

    it("returns true on a successful PATCH", async () => {
      getFreshAccessToken.mockResolvedValue("token-abc");
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
      vi.stubGlobal("fetch", fetchMock);
      const result = await updateGoogleCalendarEvent("org-1", "evt-1", EVENT_INPUT);
      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/events/evt-1"), expect.objectContaining({ method: "PATCH" }));
    });

    it("returns false (never throws) on a non-ok API response", async () => {
      getFreshAccessToken.mockResolvedValue("token-abc");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "not found" }));
      const result = await updateGoogleCalendarEvent("org-1", "evt-1", EVENT_INPUT);
      expect(result).toBe(false);
    });
  });

  describe("deleteGoogleCalendarEvent", () => {
    it("returns false when no calendar is connected", async () => {
      getFreshAccessToken.mockResolvedValue(null);
      const result = await deleteGoogleCalendarEvent("org-1", "evt-1");
      expect(result).toBe(false);
    });

    it("treats a 404 (already gone) as success", async () => {
      getFreshAccessToken.mockResolvedValue("token-abc");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "" }));
      const result = await deleteGoogleCalendarEvent("org-1", "evt-1");
      expect(result).toBe(true);
    });

    it("treats a 410 (gone) as success", async () => {
      getFreshAccessToken.mockResolvedValue("token-abc");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 410, text: async () => "" }));
      const result = await deleteGoogleCalendarEvent("org-1", "evt-1");
      expect(result).toBe(true);
    });

    it("returns false on a genuine failure (not 404/410)", async () => {
      getFreshAccessToken.mockResolvedValue("token-abc");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "server error" }));
      const result = await deleteGoogleCalendarEvent("org-1", "evt-1");
      expect(result).toBe(false);
    });
  });

  describe("getGoogleCalendarFreeBusy", () => {
    it("returns null when no calendar is connected — distinct from genuinely free", async () => {
      getFreshAccessToken.mockResolvedValue(null);
      const result = await getGoogleCalendarFreeBusy("org-1", new Date("2026-10-01T00:00:00Z"), new Date("2026-10-02T00:00:00Z"));
      expect(result).toBeNull();
    });

    it("returns [] when the calendar reports no busy intervals — never fabricated", async () => {
      getFreshAccessToken.mockResolvedValue("token-abc");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ calendars: { primary: { busy: [] } } }) }));
      const result = await getGoogleCalendarFreeBusy("org-1", new Date("2026-10-01T00:00:00Z"), new Date("2026-10-02T00:00:00Z"));
      expect(result).toEqual([]);
    });

    it("returns the real busy intervals when present", async () => {
      getFreshAccessToken.mockResolvedValue("token-abc");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ calendars: { primary: { busy: [{ start: "2026-10-01T10:00:00Z", end: "2026-10-01T10:30:00Z" }] } } }),
        }),
      );
      const result = await getGoogleCalendarFreeBusy("org-1", new Date("2026-10-01T00:00:00Z"), new Date("2026-10-02T00:00:00Z"));
      expect(result).toEqual([{ startUtc: new Date("2026-10-01T10:00:00Z"), endUtc: new Date("2026-10-01T10:30:00Z") }]);
    });
  });
});
