import { describe, expect, it } from "vitest";
import { dateOnly, dayKey, formatInZone, relativeTime, safeZone } from "@/lib/dates";

describe("dates in the viewer's zone", () => {
  const t = new Date("2026-03-10T03:30:00Z"); // evening of Mar 9 in New York
  it("formats in the given zone, not the server's", () => {
    expect(formatInZone(t, "America/New_York", "day")).toBe("Mar 9");
    expect(formatInZone(t, "Asia/Tokyo", "day")).toBe("Mar 10");
    expect(formatInZone(t, "America/New_York", "time")).toBe("11:30 PM");
  });
  it("falls back to UTC for unknown zones", () => {
    expect(safeZone("Mars/Base")).toBe("UTC");
    expect(safeZone(null)).toBe("UTC");
    expect(formatInZone(t, "Mars/Base", "day")).toBe("Mar 10");
  });
  it("shows calendar dates as the same day everywhere", () => {
    expect(dateOnly(new Date("2026-05-02T00:00:00Z"), "day")).toBe("May 2");
  });
  it("keys days by the viewer's zone", () => {
    expect(dayKey(t, "America/New_York")).toBe("2026-03-09");
    expect(dayKey(t, "UTC")).toBe("2026-03-10");
  });
  it("gives relative times", () => {
    const now = new Date("2026-03-10T03:40:00Z");
    expect(relativeTime(t, "UTC", now)).toBe("10 min ago");
    expect(relativeTime(new Date("2026-03-10T03:39:40Z"), "UTC", now)).toBe("just now");
    expect(relativeTime(new Date("2026-01-01T00:00:00Z"), "UTC", now)).toBe("Jan 1, 2026");
  });
});
