import "server-only";
import { db } from "./db";
import { env } from "./env";
import { NotFoundError } from "./courses";
import { assertStaffTwoFactor, classAccess, ClassError, studentInScope } from "./access";
import { tutorsOf } from "./messages";
import { notify } from "./notifications";
import { bookingMessage } from "./email/templates";
import { openSlots, type Rule } from "@/lib/office-hours/slots";
import { formatInZone, safeZone } from "@/lib/dates";
import { Prisma } from "@/generated/prisma/client";

/**
 * Office hours. Staff (teachers, specialists and the program admin) set weekly
 * open times per program. Students book, cancel or reschedule slots with
 * staff who teach them (their class's teachers, specialists whose groups
 * include them, and the program admin). While a booking stands, two unique
 * keys ("staff:start", "student:start") hold its place in the database, so
 * two people booking the same slot at the same moment can't both get it.
 * Bookings show on both calendars and in the .ics feed, send confirmation and
 * reminder notices, and staff can turn one into a 1:1 class session with
 * attendance. No AI.
 */

const DAY = 86_400_000;
const WINDOW_DAYS = 28;
const MAX_UPCOMING = 3;
const MAX_RULES = 30;

const isoDay = (d: Date, zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: safeZone(zone), year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const slotKey = (personId: string, start: Date) => `${personId}:${start.toISOString()}`;

// ─── Staff: weekly open times ────────────────────────────────────────────

/** Programs where this person can hold office hours: as program admin, teacher or specialist. */
export async function hostingPrograms(userId: string) {
  const [admin, staff] = await Promise.all([
    db.program.findMany({ where: { adminId: userId }, select: { id: true, name: true } }),
    db.classStaff.findMany({ where: { userId, role: { in: ["TEACHER", "SPECIALIST"] }, class: { archivedAt: null } }, distinct: ["classId"], select: { class: { select: { program: { select: { id: true, name: true } } } } } }),
  ]);
  const all = new Map([...admin.map((p) => [p.id, p.name] as const), ...staff.map((s) => [s.class.program.id, s.class.program.name] as const)]);
  return [...all.entries()].map(([id, name]) => ({ id, name }));
}

export type RuleInput = { programId: string; weekday: number; start: string; end: string; slotMinutes: number; bufferMinutes: number; maxPerDay: number; validFrom: string; validUntil?: string | null; location?: string | null };

const hhmm = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new ClassError("Times look like 15:30.");
  return Number(m[1]) * 60 + Number(m[2]);
};
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

async function cleanRule(userId: string, input: RuleInput) {
  if (!(await hostingPrograms(userId)).some((p) => p.id === input.programId)) throw new NotFoundError("Program not found");
  await assertStaffTwoFactor(userId);
  if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) throw new ClassError("Choose a day of the week.");
  const startMinute = hhmm(input.start);
  const endMinute = hhmm(input.end);
  if (endMinute <= startMinute) throw new ClassError("The end time must be after the start time.");
  if (!Number.isInteger(input.slotMinutes) || input.slotMinutes < 5 || input.slotMinutes > 180) throw new ClassError("Slots can be 5 to 180 minutes.");
  if (input.slotMinutes > endMinute - startMinute) throw new ClassError("The open time is shorter than one slot.");
  if (!Number.isInteger(input.bufferMinutes) || input.bufferMinutes < 0 || input.bufferMinutes > 60) throw new ClassError("The gap between slots can be 0 to 60 minutes.");
  if (!Number.isInteger(input.maxPerDay) || input.maxPerDay < 1 || input.maxPerDay > 30) throw new ClassError("Allow 1 to 30 bookings a day.");
  if (!isDay(input.validFrom)) throw new ClassError("Choose the first day these times apply.");
  const until = input.validUntil || null;
  if (until && (!isDay(until) || until < input.validFrom)) throw new ClassError("The last day must be on or after the first.");
  const me = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  return { programId: input.programId, weekday: input.weekday, startMinute, endMinute, slotMinutes: input.slotMinutes, bufferMinutes: input.bufferMinutes, maxPerDay: input.maxPerDay, validFrom: input.validFrom, validUntil: until, location: input.location?.trim().slice(0, 300) || null, timezone: safeZone(me.timezone) };
}

export async function myRules(userId: string) {
  return db.officeHours.findMany({ where: { staffId: userId }, orderBy: [{ weekday: "asc" }, { startMinute: "asc" }], include: { program: { select: { name: true } } } });
}

export async function saveRule(userId: string, input: RuleInput, ruleId?: string) {
  const data = await cleanRule(userId, input);
  if (ruleId) {
    const r = await db.officeHours.findFirst({ where: { id: ruleId, staffId: userId } });
    if (!r) throw new NotFoundError("Not found");
    return db.officeHours.update({ where: { id: r.id }, data });
  }
  if ((await db.officeHours.count({ where: { staffId: userId } })) >= MAX_RULES) throw new ClassError(`Up to ${MAX_RULES} open times each.`);
  return db.officeHours.create({ data: { ...data, staffId: userId } });
}

/** Remove an open time. Bookings already made stay (cancel them separately if needed). */
export async function deleteRule(userId: string, ruleId: string) {
  const r = await db.officeHours.findFirst({ where: { id: ruleId, staffId: userId } });
  if (!r) throw new NotFoundError("Not found");
  await db.officeHours.delete({ where: { id: r.id } });
}

// ─── Students: who to book, and when ─────────────────────────────────────

/**
 * Staff this student may book: their tutors (teachers of their classes and
 * specialists whose groups include them) and their programs' admins, who
 * hold office hours in that program. One entry per staff member and program,
 * with a class they share (for scope and sessions).
 */
export async function bookableTutors(studentId: string) {
  const tutors = await tutorsOf(studentId);
  const memberships = await db.classMember.findMany({ where: { userId: studentId, class: { archivedAt: null } }, select: { classId: true, class: { select: { name: true, programId: true, program: { select: { adminId: true, admin: { select: { name: true } } } } } } } });
  const programOf = new Map(memberships.map((m) => [m.classId, m.class.programId]));
  const out = new Map<string, { staffId: string; name: string; programId: string; classId: string; className: string }>();
  for (const t of tutors) {
    const programId = programOf.get(t.classId);
    if (programId && !out.has(`${t.staffId}:${programId}`)) out.set(`${t.staffId}:${programId}`, { staffId: t.staffId, name: t.name, programId, classId: t.classId, className: t.className });
  }
  for (const m of memberships) {
    const k = `${m.class.program.adminId}:${m.class.programId}`;
    if (m.class.program.adminId !== studentId && !out.has(k)) out.set(k, { staffId: m.class.program.adminId, name: m.class.program.admin.name, programId: m.class.programId, classId: m.classId, className: m.class.name });
  }
  const withHours = await db.officeHours.findMany({ where: { OR: [...out.values()].map((t) => ({ staffId: t.staffId, programId: t.programId })) }, select: { staffId: true, programId: true } });
  const has = new Set(withHours.map((r) => `${r.staffId}:${r.programId}`));
  return [...out.values()].filter((t) => has.has(`${t.staffId}:${t.programId}`)).sort((a, b) => a.name.localeCompare(b.name));
}

async function tutorFor(studentId: string, staffId: string, programId: string) {
  const t = (await bookableTutors(studentId)).find((x) => x.staffId === staffId && x.programId === programId);
  if (!t) throw new NotFoundError("Tutor not found");
  return t;
}

/** Open slots with one tutor over the next few weeks. */
export async function availableSlots(studentId: string, staffId: string, programId: string, now = new Date(), days = WINDOW_DAYS) {
  const tutor = await tutorFor(studentId, staffId, programId);
  return { tutor, slots: await slotsFor(staffId, programId, now, days) };
}

async function slotsFor(staffId: string, programId: string, now: Date, days: number) {
  const [rules, program] = await Promise.all([db.officeHours.findMany({ where: { staffId, programId } }), db.program.findUniqueOrThrow({ where: { id: programId }, select: { closedDates: true } })]);
  if (!rules.length) return [];
  const zone = rules[0].timezone;
  const fromDay = isoDay(now, zone);
  const toDay = isoDay(new Date(now.getTime() + days * DAY), zone);
  const booked = await db.booking.findMany({ where: { staffId, status: "BOOKED", startsAt: { gte: new Date(now.getTime() - DAY), lt: new Date(now.getTime() + (days + 2) * DAY) } }, select: { startsAt: true } });
  const bookedByDay = new Map<string, number>();
  for (const b of booked) {
    const d = isoDay(b.startsAt, zone);
    bookedByDay.set(d, (bookedByDay.get(d) ?? 0) + 1);
  }
  return openSlots({ rules: rules as Rule[], fromDay, toDay, closedDays: new Set(program.closedDates.map((d) => d.toISOString().slice(0, 10))), taken: new Set(booked.map((b) => b.startsAt.getTime())), bookedByDay, now });
}

const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

async function announce(bookingId: string, kind: "booked" | "cancelled" | "reminder", by: string | null, now: Date) {
  const b = await db.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { staff: { select: { id: true, name: true, timezone: true } }, student: { select: { id: true, name: true, timezone: true } } } });
  const verb = { booked: "Booked", cancelled: "Cancelled", reminder: "Reminder" }[kind];
  for (const [who, other, href] of [
    [b.student, b.staff, "/office-hours"],
    [b.staff, b.student, "/teach/office-hours"],
  ] as const) {
    if (kind !== "reminder" && by === who.id) continue; // the person who did it doesn't need telling
    const when = formatInZone(b.startsAt, who.timezone, "full");
    const title = `${verb}: office hours with ${other.name}, ${when}`;
    await notify([who.id], { kind: "bookings", key: `booking:${b.id}:${kind}`, title, href, email: (to) => bookingMessage({ to: to.email, kind, withName: other.name, when, location: b.location, url: `${env.APP_URL}${href}`, settingsUrl: `${env.APP_URL}/settings#notifications` }) }, now);
  }
}

/** Book a slot. It must be one of the tutor's open slots right now. */
export async function bookSlot(studentId: string, input: { staffId: string; programId: string; start: string | Date; note?: string | null }, now = new Date()) {
  const tutor = await tutorFor(studentId, input.staffId, input.programId);
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) throw new ClassError("Choose a time.");
  const slot = (await slotsFor(input.staffId, input.programId, now, WINDOW_DAYS)).find((s) => s.start.getTime() === start.getTime());
  if (!slot) throw new ClassError("That time isn't open any more. Pick another.");
  const upcoming = await db.booking.count({ where: { studentId, status: "BOOKED", startsAt: { gt: now } } });
  if (upcoming >= MAX_UPCOMING) throw new ClassError(`You can have up to ${MAX_UPCOMING} upcoming bookings. Cancel one to book another.`);
  const clash = await db.booking.count({ where: { studentId, status: "BOOKED", startsAt: { lt: slot.end }, endsAt: { gt: slot.start } } });
  if (clash) throw new ClassError("You already have a booking at that time.");
  let b;
  try {
    b = await db.booking.create({
      data: { programId: input.programId, classId: tutor.classId, staffId: input.staffId, studentId, startsAt: slot.start, endsAt: slot.end, location: slot.location, note: input.note?.trim().slice(0, 500) || null, staffSlot: slotKey(input.staffId, slot.start), studentSlot: slotKey(studentId, slot.start), createdAt: now },
    });
  } catch (err) {
    if (isUnique(err)) throw new ClassError("Someone just booked that time. Pick another.");
    throw err;
  }
  await announce(b.id, "booked", studentId, now);
  return b;
}

/** Who may change a booking: its student, its staff member, or the program admin. */
async function canChange(userId: string, bookingId: string) {
  const b = await db.booking.findUnique({ where: { id: bookingId }, include: { program: { select: { adminId: true } } } });
  if (!b || (b.studentId !== userId && b.staffId !== userId && b.program.adminId !== userId)) throw new NotFoundError("Booking not found");
  return b;
}

export async function cancelBooking(userId: string, bookingId: string, now = new Date()) {
  const b = await canChange(userId, bookingId);
  if (b.status !== "BOOKED") throw new ClassError("That booking is already cancelled.");
  if (b.startsAt <= now) throw new ClassError("That time has already started.");
  await db.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", staffSlot: null, studentSlot: null, cancelledById: userId, cancelledAt: now } });
  await announce(b.id, "cancelled", userId, now);
}

/** Move a booking to another open slot with the same tutor: the new time is taken first, then the old one freed. */
export async function rescheduleBooking(studentId: string, bookingId: string, newStart: string | Date, now = new Date()) {
  const b = await canChange(studentId, bookingId);
  if (b.studentId !== studentId) throw new NotFoundError("Booking not found");
  if (b.status !== "BOOKED" || b.startsAt <= now) throw new ClassError("Only an upcoming booking can be moved.");
  const start = new Date(newStart);
  const slot = (await slotsFor(b.staffId, b.programId, now, WINDOW_DAYS)).find((s) => s.start.getTime() === start.getTime());
  if (!slot) throw new ClassError("That time isn't open any more. Pick another.");
  let moved;
  try {
    moved = await db.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", staffSlot: null, studentSlot: null, cancelledById: studentId, cancelledAt: now } });
      return tx.booking.create({ data: { programId: b.programId, classId: b.classId, staffId: b.staffId, studentId, startsAt: slot.start, endsAt: slot.end, location: slot.location, note: b.note, staffSlot: slotKey(b.staffId, slot.start), studentSlot: slotKey(studentId, slot.start), createdAt: now } });
    });
  } catch (err) {
    if (isUnique(err)) throw new ClassError("Someone just booked that time. Your booking hasn't changed.");
    throw err;
  }
  await announce(moved.id, "booked", studentId, now);
  return moved;
}

/** A student's bookings: upcoming first, then the last few weeks. */
export async function studentBookings(studentId: string, now = new Date()) {
  const rows = await db.booking.findMany({ where: { studentId, OR: [{ startsAt: { gte: now }, status: "BOOKED" }, { startsAt: { gte: new Date(now.getTime() - 30 * DAY), lt: now } }] }, orderBy: { startsAt: "asc" }, include: { staff: { select: { name: true } } } });
  // "Upcoming": still booked and not started, so it can be cancelled or moved.
  return rows.map((b) => ({ ...b, upcoming: b.status === "BOOKED" && b.startsAt > now }));
}

/** A staff member's bookings (the program admin also sees the program's). */
export async function staffBookings(userId: string, now = new Date()) {
  const programs = (await db.program.findMany({ where: { adminId: userId }, select: { id: true } })).map((p) => p.id);
  return db.booking.findMany({
    where: { OR: [{ staffId: userId }, { programId: { in: programs } }], startsAt: { gte: new Date(now.getTime() - 14 * DAY) }, status: { in: ["BOOKED", "CANCELLED"] } },
    orderBy: { startsAt: "asc" },
    take: 200,
    include: { student: { select: { id: true, name: true } }, staff: { select: { id: true, name: true } }, session: { select: { attendance: { select: { status: true } } } } },
  });
}

/** Today's date (YYYY-MM-DD) in a zone, for forms. */
export function todayIn(zone: string, now = new Date()) {
  return isoDay(now, zone);
}

/**
 * Staff: turn a booking into a 1:1 class session (only the student sees it
 * and is on its register) and mark their attendance. Again marks it again.
 */
export async function bookingToSession(userId: string, bookingId: string, attended: boolean, now = new Date()) {
  const b = await canChange(userId, bookingId);
  if (b.studentId === userId) throw new NotFoundError("Booking not found");
  if (b.status !== "BOOKED") throw new ClassError("That booking was cancelled.");
  const access = await classAccess(userId, b.classId, "grade");
  if (!(await studentInScope(access, b.studentId))) throw new NotFoundError("Booking not found");
  const sessionId =
    b.sessionId ??
    (
      await db.$transaction(async (tx) => {
        const s = await tx.classSession.create({ data: { classId: b.classId, studentId: b.studentId, title: "Office hours", startsAt: b.startsAt, endsAt: b.endsAt, createdById: userId } });
        await tx.booking.update({ where: { id: b.id }, data: { sessionId: s.id } });
        return s;
      })
    ).id;
  const status = attended ? "PRESENT" : "ABSENT";
  await db.attendanceRecord.upsert({ where: { sessionId_studentId: { sessionId, studentId: b.studentId } }, create: { sessionId, studentId: b.studentId, status, markedById: userId, markedAt: now }, update: { status, markedById: userId, markedAt: now } });
  return { sessionId };
}

/** Every 15 minutes from the worker: a reminder to both sides for bookings in the next 24 hours. */
export async function sendBookingReminders(now = new Date()) {
  const due = await db.booking.findMany({ where: { status: "BOOKED", reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + DAY) } }, select: { id: true } });
  let sent = 0;
  for (const d of due) {
    const claimed = await db.booking.updateMany({ where: { id: d.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (!claimed.count) continue;
    await announce(d.id, "reminder", null, now);
    sent++;
  }
  return sent;
}
