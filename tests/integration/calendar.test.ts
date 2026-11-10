import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createClass } from "@/server/classes";
import { createGroup } from "@/server/groups";
import { calendarEvents, feedFor, feedToken, resetFeedToken } from "@/server/calendar";
import { createUser, resetDb } from "../helpers/db";

/** The calendar shows each person only their own (students) or their scope (staff), and the feed has titles only. */

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));
beforeEach(resetDb);

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const FROM = day("2026-11-01");
const TO = day("2026-12-01");

async function fixture() {
  const [admin, math, rwB, viewer, ana, cal, outsider] = await Promise.all(["Admin", "Math Spec", "RW Spec B", "Viewer", "Ana", "Cal", "Olly"].map((n) => createUser(n)));
  const c = await createClass(admin.id, "SAT Fall");
  for (const s of [ana, cal]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  const gA = await createGroup(admin.id, c.id, "Group A", [ana.id]);
  const gB = await createGroup(admin.id, c.id, "Group B", [cal.id]);
  await db.classStaff.createMany({
    data: [
      { classId: c.id, userId: math.id, role: "SPECIALIST", sections: ["MATH"], domains: [], groupIds: [] },
      { classId: c.id, userId: rwB.id, role: "SPECIALIST", sections: ["RW"], domains: [], groupIds: [gB.id] },
      { classId: c.id, userId: viewer.id, role: "VIEWER", sections: [], domains: [], groupIds: [] },
    ],
  });
  const mk = (title: string, section: string | null, extra: object = {}) => db.assignment.create({ data: { classId: c.id, kind: "QUESTIONS", title, section, domains: [], dueAt: new Date("2026-11-10T22:00:00Z"), ...extra } });
  await mk("Algebra set", "MATH");
  await mk("Words set (group A)", "RW", { groupIds: [gA.id] });
  await mk("Words set (group B)", "RW", { groupIds: [gB.id] });
  await mk("Old set", "MATH", { dueAt: new Date("2026-09-01T12:00:00Z") });
  await db.assignment.create({ data: { classId: c.id, kind: "DIAGNOSTIC", title: "Fall diagnostic", domains: [], opensAt: new Date("2026-11-14T13:00:00Z"), closesAt: new Date("2026-11-21T13:00:00Z") } });
  await db.classSession.createMany({
    data: [
      { classId: c.id, title: "Whole class", startsAt: new Date("2026-11-12T21:00:00Z"), endsAt: new Date("2026-11-12T22:00:00Z"), createdById: admin.id },
      { classId: c.id, groupId: gA.id, title: "Group A session", startsAt: new Date("2026-11-13T21:00:00Z"), endsAt: new Date("2026-11-13T22:00:00Z"), createdById: admin.id },
    ],
  });
  await db.curriculum.create({ data: { classId: c.id, title: "Plan", status: "ACTIVE", createdById: admin.id, units: { create: [{ order: 0, title: "Linear equations", domains: ["algebra"], skills: [], startsOn: day("2026-11-02"), endsOn: day("2026-11-13") }] } } });
  await db.studentProfile.create({ data: { userId: ana.id, testDate: day("2026-11-28") } });
  return { admin, math, rwB, viewer, ana, cal, outsider, c };
}

const titles = (es: { kind: string; title: string }[]) => es.map((e) => `${e.kind}:${e.title}`).sort();

describe("calendar scope", () => {
  it("shows a student only their own work, sessions and test date", async () => {
    const f = await fixture();
    expect(titles(await calendarEvents(f.ana.id, FROM, TO))).toEqual(
      ["DUE:Algebra set", "DUE:Words set (group A)", "OPENS:Fall diagnostic", "CLOSES:Fall diagnostic", "SESSION:Whole class", "SESSION:Group A session", "UNIT:Linear equations", "TEST:Your SAT"].sort(),
    );
    expect(titles(await calendarEvents(f.cal.id, FROM, TO))).toEqual(["DUE:Algebra set", "DUE:Words set (group B)", "OPENS:Fall diagnostic", "CLOSES:Fall diagnostic", "SESSION:Whole class", "UNIT:Linear equations"].sort());
    expect(await calendarEvents(f.outsider.id, FROM, TO)).toEqual([]);
  });

  it("filters staff by subject and group", async () => {
    const f = await fixture();
    const math = titles(await calendarEvents(f.math.id, FROM, TO));
    expect(math).toContain("DUE:Algebra set");
    expect(math.some((t) => t.includes("Words set"))).toBe(false);
    const rw = titles(await calendarEvents(f.rwB.id, FROM, TO));
    expect(rw).toContain("DUE:Words set (group B)");
    expect(rw).not.toContain("DUE:Words set (group A)");
    expect(rw).not.toContain("DUE:Algebra set");
    expect(rw).not.toContain("SESSION:Group A session");
    expect(rw).toContain("SESSION:Whole class");
    expect(titles(await calendarEvents(f.admin.id, FROM, TO))).toHaveLength(8);
    expect(titles(await calendarEvents(f.viewer.id, FROM, TO))).toHaveLength(8);
  });

  it("refuses huge ranges", async () => {
    const f = await fixture();
    await expect(calendarEvents(f.ana.id, day("2020-01-01"), day("2026-01-01"))).rejects.toThrow(/shorter/);
  });
});

describe("calendar feed", () => {
  it("serves titles only, and a reset link revokes the old one", async () => {
    const f = await fixture();
    const t1 = await feedToken(f.ana.id);
    expect(await feedToken(f.ana.id)).toBe(t1);
    const ics = (await feedFor(t1, new Date("2026-11-05T12:00:00Z")))!;
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:Due: Algebra set (SAT Fall)");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261128");
    expect(ics).not.toContain("Ana");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const t2 = await resetFeedToken(f.ana.id);
    expect(t2).not.toBe(t1);
    expect(await feedFor(t1)).toBeNull();
    expect(await feedFor("short")).toBeNull();
    expect(await feedFor(t2)).toContain("BEGIN:VCALENDAR");
  });
});
