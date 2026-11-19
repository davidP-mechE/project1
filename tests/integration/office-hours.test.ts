import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { createClass } from "@/server/classes";
import { createGroup } from "@/server/groups";
import { sessionRegister } from "@/server/cohort";
import { calendarEvents, feedFor, feedToken } from "@/server/calendar";
import { availableSlots, bookableTutors, bookingToSession, bookSlot, cancelBooking, deleteRule, rescheduleBooking, saveRule, sendBookingReminders, staffBookings, studentBookings } from "@/server/office-hours";
import { createUser, resetDb } from "../helpers/db";

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));

const NOW = new Date("2026-11-16T12:00:00Z"); // a Monday
const DAY = 86_400_000;

beforeEach(resetDb);

async function outcome(fn: () => Promise<unknown>): Promise<"ok" | "denied" | "hidden" | "invalid"> {
  try {
    await fn();
    return "ok";
  } catch (err) {
    if (err instanceof NotFoundError) return "hidden";
    if (err instanceof ClassError) return err.status === 403 ? "denied" : "invalid";
    throw err;
  }
}

/** Admin; a teacher; a group-B specialist; a viewer; Ana (group A), Ben and Cal (group B); an outsider with their own student. */
async function fixture() {
  const [admin, teacher, groupTutor, viewer, outsider, ana, ben, cal, zed] = await Promise.all(["Admin", "Teacher Tess", "Group Gus", "Viewer", "Outsider", "Ana", "Ben", "Cal", "Zed"].map((n) => createUser(n)));
  const c = await createClass(admin.id, "SAT Fall");
  for (const s of [ana, ben, cal]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  await createGroup(admin.id, c.id, "A", [ana.id]);
  const gB = await createGroup(admin.id, c.id, "B", [ben.id, cal.id]);
  await db.classStaff.createMany({ data: [{ classId: c.id, userId: teacher.id, role: "TEACHER" }, { classId: c.id, userId: groupTutor.id, role: "SPECIALIST", groupIds: [gB.id] }, { classId: c.id, userId: viewer.id, role: "VIEWER" }] });
  const other = await createClass(outsider.id, "Other");
  await db.classMember.create({ data: { classId: other.id, userId: zed.id } });
  return { c, admin, teacher, groupTutor, viewer, outsider, ana, ben, cal, zed, programId: c.programId! };
}

/** Tuesdays 15:00–16:30 UTC, 20-minute slots with 10 minutes between: 15:00, 15:30, 16:00. */
const TUESDAYS = { weekday: 2, start: "15:00", end: "16:30", slotMinutes: 20, bufferMinutes: 10, maxPerDay: 6, validFrom: "2026-11-01", location: "Room 204" };
const TUE_3PM = "2026-11-17T15:00:00.000Z";

describe("office hours: open times", () => {
  it("staff set weekly open times in their programs; students, viewers and outsiders can't", async () => {
    const f = await fixture();
    await saveRule(f.teacher.id, { ...TUESDAYS, programId: f.programId });
    expect(await outcome(() => saveRule(f.ana.id, { ...TUESDAYS, programId: f.programId }))).toBe("hidden");
    expect(await outcome(() => saveRule(f.viewer.id, { ...TUESDAYS, programId: f.programId }))).toBe("hidden");
    expect(await outcome(() => saveRule(f.outsider.id, { ...TUESDAYS, programId: f.programId }))).toBe("hidden");
    expect(await outcome(() => saveRule(f.teacher.id, { ...TUESDAYS, programId: f.programId, end: "14:00" }))).toBe("invalid");
    expect(await outcome(() => saveRule(f.teacher.id, { ...TUESDAYS, programId: f.programId, slotMinutes: 200 }))).toBe("invalid");
    const { slots } = await availableSlots(f.ana.id, f.teacher.id, f.programId, NOW, 7);
    expect(slots.map((s) => s.start.toISOString())).toEqual([TUE_3PM, "2026-11-17T15:30:00.000Z", "2026-11-17T16:00:00.000Z"]);
    // Closed days on the program calendar have no slots.
    await db.program.update({ where: { id: f.programId }, data: { closedDates: [new Date("2026-11-17T00:00:00Z")] } });
    expect((await availableSlots(f.ana.id, f.teacher.id, f.programId, NOW, 7)).slots).toEqual([]);
  });

  it("students see only staff who teach them (and their admin) who hold office hours", async () => {
    const f = await fixture();
    for (const s of [f.teacher, f.groupTutor, f.admin, f.outsider]) {
      const programId = s.id === f.outsider.id ? (await db.class.findFirstOrThrow({ where: { teacherId: f.outsider.id } })).programId! : f.programId;
      await saveRule(s.id, { ...TUESDAYS, programId });
    }
    expect((await bookableTutors(f.ben.id)).map((t) => t.name)).toEqual(["Admin", "Group Gus", "Teacher Tess"]);
    expect((await bookableTutors(f.ana.id)).map((t) => t.name)).toEqual(["Admin", "Teacher Tess"]); // not group B's specialist
    expect((await bookableTutors(f.zed.id)).map((t) => t.name)).toEqual(["Outsider"]);
    expect(await outcome(() => availableSlots(f.ana.id, f.groupTutor.id, f.programId, NOW))).toBe("hidden");
    expect(await outcome(() => bookSlot(f.ana.id, { staffId: f.groupTutor.id, programId: f.programId, start: TUE_3PM }, NOW))).toBe("hidden");
  });
});

describe("office hours: booking", () => {
  it("two people booking the same slot at the same moment: exactly one gets it", async () => {
    const f = await fixture();
    await saveRule(f.teacher.id, { ...TUESDAYS, programId: f.programId });
    const results = await Promise.allSettled([f.ana, f.ben, f.cal].map((s) => bookSlot(s.id, { staffId: f.teacher.id, programId: f.programId, start: TUE_3PM }, NOW)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(lost).toHaveLength(2);
    expect(lost.every((r) => r.reason instanceof ClassError)).toBe(true);
    expect(await db.booking.count({ where: { status: "BOOKED" } })).toBe(1);
    // The same student double-clicking: one booking.
    const twice = await Promise.allSettled([0, 1].map(() => bookSlot(f.ana.id, { staffId: f.teacher.id, programId: f.programId, start: "2026-11-17T16:00:00.000Z" }, NOW)));
    expect(twice.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(1);
    expect(await db.booking.count({ where: { status: "BOOKED", startsAt: new Date("2026-11-17T16:00:00.000Z") } })).toBe(1);
  });

  it("a taken slot disappears; cancelling frees it; rescheduling moves it; limits hold", async () => {
    const f = await fixture();
    await saveRule(f.teacher.id, { ...TUESDAYS, programId: f.programId, maxPerDay: 2 });
    const b = await bookSlot(f.ana.id, { staffId: f.teacher.id, programId: f.programId, start: TUE_3PM, note: "Boundaries questions" }, NOW);
    expect(b).toMatchObject({ location: "Room 204", note: "Boundaries questions", classId: f.c.id });
    const open = async () => (await availableSlots(f.ben.id, f.teacher.id, f.programId, NOW, 7)).slots.map((s) => s.start.toISOString());
    expect(await open()).toEqual(["2026-11-17T15:30:00.000Z"]); // max 2 a day: one booked, one left
    expect(await outcome(() => bookSlot(f.ben.id, { staffId: f.teacher.id, programId: f.programId, start: TUE_3PM }, NOW))).toBe("invalid");
    expect(await outcome(() => bookSlot(f.ben.id, { staffId: f.teacher.id, programId: f.programId, start: "2026-11-17T15:10:00.000Z" }, NOW))).toBe("invalid"); // not a slot
    // Reschedule to next week's 15:30; the old time opens again.
    const moved = await rescheduleBooking(f.ana.id, b.id, "2026-11-24T15:30:00.000Z", NOW);
    expect(moved.startsAt.toISOString()).toBe("2026-11-24T15:30:00.000Z");
    expect(await open()).toContain(TUE_3PM);
    expect(await outcome(() => rescheduleBooking(f.ben.id, moved.id, TUE_3PM, NOW))).toBe("hidden");
    // Others can't cancel it; the staff member can.
    expect(await outcome(() => cancelBooking(f.ben.id, moved.id, NOW))).toBe("hidden");
    expect(await outcome(() => cancelBooking(f.groupTutor.id, moved.id, NOW))).toBe("hidden");
    await cancelBooking(f.teacher.id, moved.id, NOW);
    expect((await studentBookings(f.ana.id, NOW)).filter((x) => x.status === "BOOKED")).toEqual([]);
    // Up to 3 upcoming bookings per student.
    await saveRule(f.teacher.id, { ...TUESDAYS, programId: f.programId, weekday: 3, maxPerDay: 6 });
    for (const t of ["2026-11-18T15:00:00.000Z", "2026-11-18T15:30:00.000Z", "2026-11-18T16:00:00.000Z"]) await bookSlot(f.cal.id, { staffId: f.teacher.id, programId: f.programId, start: t }, NOW);
    expect(await outcome(() => bookSlot(f.cal.id, { staffId: f.teacher.id, programId: f.programId, start: "2026-11-25T15:00:00.000Z" }, NOW))).toBe("invalid");
  });

  it("notifies both sides, reminds once the day before, and shows on both calendars and the feed (no student names in the feed)", async () => {
    const f = await fixture();
    await saveRule(f.teacher.id, { ...TUESDAYS, programId: f.programId });
    await bookSlot(f.ben.id, { staffId: f.teacher.id, programId: f.programId, start: TUE_3PM }, NOW);
    expect(await db.notification.count({ where: { userId: f.teacher.id, kind: "BOOKING" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: f.ben.id, kind: "BOOKING" } })).toBe(0); // he did it himself
    expect(await sendBookingReminders(NOW)).toBe(0); // more than a day away
    expect(await sendBookingReminders(new Date("2026-11-16T16:00:00Z"))).toBe(1);
    expect(await sendBookingReminders(new Date("2026-11-16T16:15:00Z"))).toBe(0);
    expect(await db.notification.count({ where: { userId: f.ben.id, kind: "BOOKING" } })).toBe(1);
    const range = [NOW, new Date(NOW.getTime() + 7 * DAY)] as const;
    expect((await calendarEvents(f.ben.id, ...range)).find((e) => e.kind === "BOOKING")?.title).toBe("Office hours with Teacher Tess");
    expect((await calendarEvents(f.teacher.id, ...range)).find((e) => e.kind === "BOOKING")?.title).toBe("Office hours booking");
    expect((await calendarEvents(f.ana.id, ...range)).some((e) => e.kind === "BOOKING")).toBe(false);
    const feed = (await feedFor(await feedToken(f.teacher.id), NOW))!;
    expect(feed).toContain("SUMMARY:Office hours booking");
    expect(feed).not.toContain("Ben");
  });

  it("staff turn a booking into a 1:1 session with attendance; only that student is on it", async () => {
    const f = await fixture();
    await saveRule(f.groupTutor.id, { ...TUESDAYS, programId: f.programId });
    const b = await bookSlot(f.ben.id, { staffId: f.groupTutor.id, programId: f.programId, start: TUE_3PM }, NOW);
    expect(await outcome(() => bookingToSession(f.ben.id, b.id, true))).toBe("hidden");
    expect(await outcome(() => bookingToSession(f.outsider.id, b.id, true))).toBe("hidden");
    const { sessionId } = await bookingToSession(f.groupTutor.id, b.id, true);
    expect((await bookingToSession(f.groupTutor.id, b.id, false)).sessionId).toBe(sessionId); // marking again keeps the session
    expect(await db.attendanceRecord.findMany({ where: { sessionId }, select: { studentId: true, status: true } })).toEqual([{ studentId: f.ben.id, status: "ABSENT" }]);
    expect((await sessionRegister(f.admin.id, f.c.id, sessionId)).students.map((s) => s.name)).toEqual(["Ben"]);
    const range = [NOW, new Date(NOW.getTime() + 7 * DAY)] as const;
    expect((await calendarEvents(f.ben.id, ...range)).map((e) => e.kind)).toEqual(["SESSION"]); // the session replaces the booking
    expect((await calendarEvents(f.cal.id, ...range)).some((e) => e.kind === "SESSION")).toBe(false);
    expect((await staffBookings(f.admin.id, NOW)).map((x) => x.student.name)).toEqual(["Ben"]); // the admin sees the program's
    expect(await staffBookings(f.teacher.id, NOW)).toEqual([]);
    // Removing the open time keeps the booking.
    const rule = await db.officeHours.findFirstOrThrow();
    expect(await outcome(() => deleteRule(f.teacher.id, rule.id))).toBe("hidden");
    await deleteRule(f.groupTutor.id, rule.id);
    expect(await db.booking.count({ where: { status: "BOOKED" } })).toBe(1);
  });
});
