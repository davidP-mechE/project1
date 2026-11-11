import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { ClassError, classAccess, assignmentInScope, staffClassIds, type ClassAccess } from "./access";
import { assignedTo, groupsByClass } from "./targets";

/**
 * The calendar: due dates, diagnostic windows, class sessions, curriculum
 * units and the student's own test date. Students see their own; staff see
 * their classes, filtered by their scope (a group-limited tutor sees their
 * groups' sessions and work; a subject specialist, their subjects' work).
 *
 * The private feed (ICS) carries titles only: class and assignment names,
 * never names of students, scores or answers.
 */

export type CalEvent = {
  id: string;
  kind: "DUE" | "OPENS" | "CLOSES" | "SESSION" | "UNIT" | "TEST";
  title: string;
  className: string | null;
  start: Date;
  end: Date | null;
  /** True for whole-day items (curriculum units, the test date). */
  allDay: boolean;
  href: string | null;
};

const MAX_RANGE_DAYS = 400;

function checkRange(from: Date, to: Date) {
  if (!(from < to)) throw new ClassError("The range is empty.");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) throw new ClassError("Choose a shorter range.");
}

const overlaps = (from: Date, to: Date) => ({ lt: to, gte: from });

/** A student's own events. */
async function studentEvents(userId: string, from: Date, to: Date): Promise<CalEvent[]> {
  const memberships = await db.classMember.findMany({ where: { userId, class: { archivedAt: null } }, select: { classId: true, class: { select: { name: true } } } });
  const classIds = memberships.map((m) => m.classId);
  const names = new Map(memberships.map((m) => [m.classId, m.class.name]));
  const groups = await groupsByClass(userId, classIds);
  const out: CalEvent[] = [];
  if (classIds.length) {
    const [assignments, sessions, units] = await Promise.all([
      db.assignment.findMany({
        where: { classId: { in: classIds }, OR: [{ dueAt: overlaps(from, to) }, { opensAt: overlaps(from, to) }, { closesAt: overlaps(from, to) }] },
        select: { id: true, classId: true, kind: true, title: true, dueAt: true, opensAt: true, closesAt: true, groupIds: true, studentIds: true },
      }),
      db.classSession.findMany({ where: { classId: { in: classIds }, startsAt: overlaps(from, to) }, select: { id: true, classId: true, groupId: true, title: true, startsAt: true, endsAt: true } }),
      db.curriculumUnit.findMany({ where: { curriculum: { classId: { in: classIds }, status: "ACTIVE" }, startsOn: { lt: to }, endsOn: { gte: from } }, select: { id: true, title: true, startsOn: true, endsOn: true, curriculum: { select: { classId: true } } } }),
    ]);
    for (const a of assignments) {
      if (!assignedTo(a, userId, groups.get(a.classId) ?? new Set())) continue;
      out.push(...assignmentEvents(a, names.get(a.classId) ?? null, `/classes/assignments/${a.id}`, from, to));
    }
    for (const s of sessions) {
      if (s.groupId && !groups.get(s.classId)?.has(s.groupId)) continue;
      out.push({ id: `session:${s.id}`, kind: "SESSION", title: s.title || "Class session", className: names.get(s.classId) ?? null, start: s.startsAt, end: s.endsAt, allDay: false, href: "/classes" });
    }
    for (const u of units) out.push({ id: `unit:${u.id}`, kind: "UNIT", title: u.title, className: names.get(u.curriculum.classId) ?? null, start: u.startsOn, end: u.endsOn, allDay: true, href: "/classes" });
  }
  const profile = await db.studentProfile.findUnique({ where: { userId }, select: { testDate: true } });
  if (profile?.testDate && profile.testDate >= from && profile.testDate < to) out.push({ id: "test", kind: "TEST", title: "Your SAT", className: null, start: profile.testDate, end: null, allDay: true, href: "/scores" });
  return out;
}

function assignmentEvents(a: { id: string; kind: string; title: string; dueAt: Date | null; opensAt: Date | null; closesAt: Date | null }, className: string | null, href: string, from: Date, to: Date): CalEvent[] {
  const out: CalEvent[] = [];
  const inRange = (d: Date | null): d is Date => Boolean(d && d >= from && d < to);
  if (inRange(a.dueAt)) out.push({ id: `due:${a.id}`, kind: "DUE", title: a.title, className, start: a.dueAt, end: null, allDay: false, href });
  if (a.kind === "DIAGNOSTIC") {
    if (inRange(a.opensAt)) out.push({ id: `opens:${a.id}`, kind: "OPENS", title: a.title, className, start: a.opensAt, end: null, allDay: false, href });
    if (inRange(a.closesAt)) out.push({ id: `closes:${a.id}`, kind: "CLOSES", title: a.title, className, start: a.closesAt, end: null, allDay: false, href });
  }
  return out;
}

/** A staff member's events across their classes, inside their scope. */
async function staffEvents(userId: string, from: Date, to: Date): Promise<CalEvent[]> {
  const out: CalEvent[] = [];
  for (const classId of await staffClassIds(userId)) {
    let a: ClassAccess;
    try {
      a = await classAccess(userId, classId, "view");
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof ClassError) continue;
      throw err;
    }
    const c = await db.class.findUnique({ where: { id: classId }, select: { archivedAt: true } });
    if (c?.archivedAt) continue;
    const [assignments, sessions, units] = await Promise.all([
      db.assignment.findMany({
        where: { classId, OR: [{ dueAt: overlaps(from, to) }, { opensAt: overlaps(from, to) }, { closesAt: overlaps(from, to) }] },
        select: { id: true, kind: true, title: true, dueAt: true, opensAt: true, closesAt: true, section: true, domains: true, groupIds: true, studentIds: true },
      }),
      db.classSession.findMany({ where: { classId, startsAt: overlaps(from, to) }, select: { id: true, groupId: true, title: true, startsAt: true, endsAt: true } }),
      db.curriculumUnit.findMany({ where: { curriculum: { classId, status: "ACTIVE" }, startsOn: { lt: to }, endsOn: { gte: from } }, select: { id: true, title: true, startsOn: true, endsOn: true } }),
    ]);
    for (const x of assignments) {
      if (!assignmentInScope(a, x)) continue;
      // Group-limited: work for the whole class, their groups, or (if any) their students.
      if (a.groupIds.length && x.groupIds.length && !x.groupIds.some((g) => a.groupIds.includes(g))) continue;
      out.push(...assignmentEvents(x, a.className, `/teach/${classId}/assignments/${x.id}`, from, to));
    }
    for (const s of sessions) {
      if (a.groupIds.length && s.groupId && !a.groupIds.includes(s.groupId)) continue;
      out.push({ id: `session:${s.id}`, kind: "SESSION", title: s.title || "Class session", className: a.className, start: s.startsAt, end: s.endsAt, allDay: false, href: `/teach/${classId}/attendance/${s.id}` });
    }
    for (const u of units) out.push({ id: `unit:${u.id}`, kind: "UNIT", title: u.title, className: a.className, start: u.startsOn, end: u.endsOn, allDay: true, href: `/teach/${classId}/curriculum` });
  }
  return out;
}

/** Everything on this person's calendar in [from, to), soonest first, with no duplicates. */
export async function calendarEvents(userId: string, from: Date, to: Date): Promise<CalEvent[]> {
  checkRange(from, to);
  const [mine, staff] = await Promise.all([studentEvents(userId, from, to), staffEvents(userId, from, to)]);
  const seen = new Set<string>();
  return [...mine, ...staff]
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((x, y) => x.start.getTime() - y.start.getTime() || x.title.localeCompare(y.title));
}

// ── Private feed ──

/** The person's feed token, made on first use. */
export async function feedToken(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { calendarToken: true } });
  if (u.calendarToken) return u.calendarToken;
  return resetFeedToken(userId);
}

/** A new feed link; the old one stops working at once. */
export async function resetFeedToken(userId: string) {
  const token = randomBytes(24).toString("base64url");
  await db.user.update({ where: { id: userId }, data: { calendarToken: token } });
  return token;
}

const KIND_PREFIX: Record<CalEvent["kind"], string> = { DUE: "Due", OPENS: "Opens", CLOSES: "Closes", SESSION: "Session", UNIT: "Unit", TEST: "" };

function icsEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
/** ICS lines are at most 75 octets; longer ones continue on the next line after a space. */
function fold(line: string) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dayStamp = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

/** The feed for a token: 2 months back to 6 months ahead. Null for an unknown token. */
export async function feedFor(token: string, now = new Date()): Promise<string | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const u = await db.user.findUnique({ where: { calendarToken: token }, select: { id: true } });
  if (!u) return null;
  const from = new Date(now.getTime() - 60 * 86_400_000);
  const to = new Date(now.getTime() + 180 * 86_400_000);
  const events = await calendarEvents(u.id, from, to).catch((err) => {
    if (err instanceof ClassError) return [];
    throw err;
  });
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Coursebook//Calendar//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Coursebook"];
  for (const e of events) {
    const summary = [KIND_PREFIX[e.kind], e.title].filter(Boolean).join(": ") + (e.className ? ` (${e.className})` : "");
    lines.push("BEGIN:VEVENT", `UID:${e.id}@coursebook`, `DTSTAMP:${stamp(now)}`);
    if (e.allDay) {
      const end = new Date((e.end ?? e.start).getTime() + 86_400_000);
      lines.push(`DTSTART;VALUE=DATE:${dayStamp(e.start)}`, `DTEND;VALUE=DATE:${dayStamp(end)}`);
    } else {
      lines.push(`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end ?? new Date(e.start.getTime() + 30 * 60_000))}`);
    }
    lines.push(`SUMMARY:${icsEscape(summary)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
