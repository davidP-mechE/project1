import { describe, expect, it } from "vitest";
import { openSlots, zonedToUtc, zoneOffsetMinutes, type Rule } from "@/lib/office-hours/slots";

const rule = (r: Partial<Rule> = {}): Rule => ({ id: "r1", weekday: 2, startMinute: 15 * 60, endMinute: 16 * 60 + 30, timezone: "America/New_York", slotMinutes: 20, bufferMinutes: 10, maxPerDay: 6, validFrom: "2026-10-01", validUntil: null, location: "Room 204", ...r });
const NOW = new Date("2026-10-26T12:00:00Z");
const base = { fromDay: "2026-10-26", toDay: "2026-11-08", closedDays: new Set<string>(), taken: new Set<number>(), bookedByDay: new Map<string, number>(), now: NOW };

describe("office-hours slots", () => {
  it("converts local times, across daylight saving", () => {
    expect(zoneOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-240);
    expect(zonedToUtc("2026-10-27", 900, "America/New_York").toISOString()).toBe("2026-10-27T19:00:00.000Z"); // EDT
    expect(zonedToUtc("2026-11-03", 900, "America/New_York").toISOString()).toBe("2026-11-03T20:00:00.000Z"); // EST
  });

  it("cuts the block into slots with buffers, on the right weekday", () => {
    const s = openSlots({ ...base, rules: [rule()] });
    // Tuesdays Oct 27 and Nov 3: 3:00, 3:30, 4:00 (4:00–4:20 fits before 4:30).
    expect(s.map((x) => x.start.toISOString())).toEqual(["2026-10-27T19:00:00.000Z", "2026-10-27T19:30:00.000Z", "2026-10-27T20:00:00.000Z", "2026-11-03T20:00:00.000Z", "2026-11-03T20:30:00.000Z", "2026-11-03T21:00:00.000Z"]);
    expect(s[0]).toMatchObject({ day: "2026-10-27", location: "Room 204" });
    expect(s[0].end.getTime() - s[0].start.getTime()).toBe(20 * 60_000);
  });

  it("skips closed days, taken times, full days, the date range and the next hour", () => {
    const taken = new Set([new Date("2026-10-27T19:30:00.000Z").getTime()]);
    expect(openSlots({ ...base, rules: [rule()], closedDays: new Set(["2026-11-03"]), taken }).map((x) => x.start.toISOString())).toEqual(["2026-10-27T19:00:00.000Z", "2026-10-27T20:00:00.000Z"]);
    expect(openSlots({ ...base, rules: [rule({ maxPerDay: 3 })], bookedByDay: new Map([["2026-10-27", 2]]) }).filter((x) => x.day === "2026-10-27")).toHaveLength(1);
    expect(openSlots({ ...base, rules: [rule({ validUntil: "2026-10-31" })] }).every((x) => x.day === "2026-10-27")).toBe(true);
    expect(openSlots({ ...base, rules: [rule({ validFrom: "2026-11-01" })] }).every((x) => x.day === "2026-11-03")).toBe(true);
    expect(openSlots({ ...base, rules: [rule()], now: new Date("2026-10-27T18:30:00Z") }).filter((x) => x.day === "2026-10-27").map((x) => x.start.toISOString())).toEqual(["2026-10-27T19:30:00.000Z", "2026-10-27T20:00:00.000Z"]);
  });
});
