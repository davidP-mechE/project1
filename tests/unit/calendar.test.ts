import { describe, expect, it } from "vitest";
import { mondayOf, SAT_TEMPLATE, scheduleUnits, shiftUnits } from "@/lib/sat/calendar";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const day = (x: Date) => x.toISOString().slice(0, 10);

describe("school calendar", () => {
  it("lays units out in whole school weeks, skipping closed days and whole-week breaks", () => {
    expect(day(mondayOf(d("2026-11-15")))).toBe("2026-11-09"); // a Sunday ends its week
    const closed = [d("2026-11-23"), ...["2026-11-26", "2026-11-27"].map(d), ...["2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-25"].map(d)];
    const out = scheduleUnits([{ weeks: 2 }, { weeks: 1 }, { weeks: 4 }], d("2026-11-11"), closed);
    expect(out.map((u) => [day(u.startsOn), day(u.endsOn)])).toEqual([
      ["2026-11-11", "2026-11-20"], // starts on the (Wednesday) start date
      ["2026-11-24", "2026-11-25"], // Monday 23rd and Thu–Fri closed
      ["2026-11-30", "2027-01-01"], // 4 school weeks: the winter-break week is skipped
    ]);
  });

  it("pushes later units back by whole weeks", () => {
    const placed = scheduleUnits([{ weeks: 1 }, { weeks: 2 }, { weeks: 1 }], d("2027-01-04")).map((u, i) => ({ ...u, order: i }));
    const shifted = shiftUnits(placed, 1, 1);
    expect(shifted.map((u) => day(u.startsOn))).toEqual(["2027-01-04", "2027-01-18", "2027-02-01"]);
    expect(day(shifted[1].endsOn)).toBe("2027-01-29");
  });

  it("has a full default SAT template covering every domain", () => {
    expect(new Set(SAT_TEMPLATE.flatMap((u) => u.domains)).size).toBe(8);
    expect(SAT_TEMPLATE.reduce((n, u) => n + u.weeks, 0)).toBe(17);
  });
});
