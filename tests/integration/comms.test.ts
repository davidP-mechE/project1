import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { createClass } from "@/server/classes";
import { createGroup } from "@/server/groups";
import { addGuardian } from "@/server/cohort";
import { bulkMessage } from "@/server/messages";
import { createSavedReply, deleteSavedReply, listSavedReplies, updateSavedReply } from "@/server/saved-replies";
import { cancelScheduled, listScheduled, runScheduledSend, scheduleSend, sweepScheduledSends, updateScheduled } from "@/server/scheduled";
import { currentPeriod, previewGuardianEmail, sendGuardianProgress, setGuardianFrequency } from "@/server/guardian-progress";
import { createUser, resetDb } from "../helpers/db";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/email", () => ({ sendEmail: async (m: { to: string; subject: string; text: string }) => void sent.push(m) }));

const DAY = 86_400_000;
const NOW = new Date("2026-11-18T15:00:00Z");
const later = (h: number) => new Date(NOW.getTime() + h * 3600_000);

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
});

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

async function fixture() {
  const [admin, groupTutor, teacher, outsider, ana, ben, cal] = await Promise.all(["Admin", "Group tutor", "Teacher", "Outsider", "Ana Diaz", "Ben Ito", "Cal Park"].map((n) => createUser(n)));
  const c = await createClass(admin.id, "SAT Fall");
  for (const s of [ana, ben, cal]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  const gA = await createGroup(admin.id, c.id, "A", [ana.id]);
  const gB = await createGroup(admin.id, c.id, "B", [ben.id, cal.id]);
  await db.classStaff.createMany({ data: [{ classId: c.id, userId: groupTutor.id, role: "SPECIALIST", groupIds: [gB.id] }, { classId: c.id, userId: teacher.id, role: "TEACHER" }] });
  await createClass(outsider.id, "Other");
  return { c, admin, groupTutor, teacher, outsider, ana, ben, cal, gA, gB, programId: c.programId! };
}

describe("saved replies", () => {
  it("personal ones are the owner's; shared ones reach the program's staff; students and outsiders get nothing", async () => {
    const f = await fixture();
    await createSavedReply(f.groupTutor.id, { title: "Nudge", body: "Hi {first_name}, your work is due {due_date}." });
    const shared = await createSavedReply(f.groupTutor.id, { title: "Welcome", body: "Welcome to {class}!", programId: f.programId });
    expect((await listSavedReplies(f.groupTutor.id)).replies.map((r) => r.title).sort()).toEqual(["Nudge", "Welcome"]);
    expect((await listSavedReplies(f.teacher.id)).replies.map((r) => [r.title, r.canEdit])).toEqual([["Welcome", false]]);
    expect((await listSavedReplies(f.admin.id)).replies.map((r) => [r.title, r.canEdit])).toEqual([["Welcome", true]]);
    expect((await listSavedReplies(f.outsider.id)).replies).toEqual([]);
    expect((await listSavedReplies(f.ana.id)).replies).toEqual([]);
    expect(await outcome(() => createSavedReply(f.ana.id, { title: "x", body: "y" }))).toBe("denied");
    expect(await outcome(() => createSavedReply(f.outsider.id, { title: "x", body: "y", programId: f.programId }))).toBe("hidden");
    // Only the owner or the program admin changes a shared reply.
    expect(await outcome(() => updateSavedReply(f.teacher.id, shared.id, { title: "Hijack", body: "x" }))).toBe("denied");
    expect(await outcome(() => deleteSavedReply(f.outsider.id, shared.id))).toBe("hidden");
    await updateSavedReply(f.admin.id, shared.id, { title: "Welcome!", body: "Welcome to {class}." });
    await deleteSavedReply(f.groupTutor.id, shared.id);
    expect((await listSavedReplies(f.teacher.id)).replies).toEqual([]);
  });

  it("placeholders are filled for each student in a bulk message", async () => {
    const f = await fixture();
    await db.user.update({ where: { id: f.ben.id }, data: { timezone: "America/New_York" } });
    await db.assignment.create({ data: { classId: f.c.id, kind: "QUESTIONS", title: "Set 1", dueAt: new Date("2026-11-20T02:00:00Z"), groupIds: [f.gB.id] } });
    await bulkMessage(f.groupTutor.id, f.c.id, { body: "Hi {first_name}, {class} work is due {due_date}." }, NOW);
    const msgs = await db.message.findMany({ include: { thread: { select: { studentId: true } } } });
    const body = (id: string) => msgs.find((m) => m.thread.studentId === id)!.body;
    expect(body(f.ben.id)).toBe("Hi Ben, SAT Fall work is due Thu, Nov 19, 9:00 PM.");
    expect(body(f.cal.id)).toMatch(/^Hi Cal, SAT Fall work is due /);
    expect(msgs.some((m) => m.thread.studentId === f.ana.id)).toBe(false); // outside the tutor's group
  });
});

describe("scheduled messages and announcements", () => {
  it("schedule inside your scope; edit or cancel before it goes; it sends once, at its time, from the worker", async () => {
    const f = await fixture();
    expect(await outcome(() => scheduleSend(f.groupTutor.id, { classId: f.c.id, kind: "MESSAGE", studentIds: [f.ana.id], body: "Hi", sendAt: later(2) }, NOW))).toBe("denied");
    expect(await outcome(() => scheduleSend(f.groupTutor.id, { classId: f.c.id, kind: "MESSAGE", groupIds: [f.gB.id], body: "Hi", sendAt: NOW }, NOW))).toBe("invalid"); // must be in the future
    expect(await outcome(() => scheduleSend(f.outsider.id, { classId: f.c.id, kind: "MESSAGE", body: "Hi", sendAt: later(2) }, NOW))).toBe("hidden");
    const s = await scheduleSend(f.groupTutor.id, { classId: f.c.id, kind: "MESSAGE", groupIds: [f.gB.id], body: "See you Thursday, {first_name}.", sendAt: later(2) }, NOW);
    expect(await outcome(() => updateScheduled(f.teacher.id, s.id, { body: "x" }, NOW))).toBe("hidden");
    await updateScheduled(f.groupTutor.id, s.id, { body: "See you Friday, {first_name}.", sendAt: later(3).toISOString() }, NOW);
    expect(await runScheduledSend(s.id, later(2))).toBe("skipped"); // not due yet
    expect(await db.message.count()).toBe(0);
    expect(await runScheduledSend(s.id, later(3))).toBe("sent");
    expect(await runScheduledSend(s.id, later(3))).toBe("skipped"); // once
    expect((await db.message.findMany({ orderBy: { body: "asc" } })).map((m) => m.body)).toEqual(["See you Friday, Ben.", "See you Friday, Cal."]);
    expect(await db.scheduledSend.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: "SENT", reached: 2 });
    expect(await db.notification.count({ where: { userId: f.groupTutor.id, kind: "SCHEDULED" } })).toBe(1);
    expect(await outcome(() => cancelScheduled(f.groupTutor.id, s.id))).toBe("invalid"); // already sent

    const c2 = await scheduleSend(f.groupTutor.id, { classId: f.c.id, kind: "MESSAGE", groupIds: [f.gB.id], body: "Never mind", sendAt: later(5) }, NOW);
    await cancelScheduled(f.groupTutor.id, c2.id);
    expect(await sweepScheduledSends(later(6))).toBe(0);
    expect((await listScheduled(f.groupTutor.id, {}, NOW)).map((x) => x.status).sort()).toEqual(["CANCELLED", "SENT"]);
  });

  it("access is checked again at send time: a tutor who lost the class gets a 'not sent' notice", async () => {
    const f = await fixture();
    const s = await scheduleSend(f.groupTutor.id, { classId: f.c.id, kind: "MESSAGE", groupIds: [f.gB.id], body: "Hi", sendAt: later(1) }, NOW);
    await db.classStaff.deleteMany({ where: { userId: f.groupTutor.id } });
    expect(await sweepScheduledSends(later(2))).toBe(0);
    expect(await db.scheduledSend.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: "FAILED", error: expect.stringMatching(/no longer have access/) });
    expect(await db.message.count()).toBe(0);
    expect((await db.notification.findFirstOrThrow({ where: { userId: f.groupTutor.id } })).title).toMatch(/^Not sent/);
  });

  it("scheduled announcements post at their time, with {class} filled in; group tutors post to their groups only", async () => {
    const f = await fixture();
    expect(await outcome(() => scheduleSend(f.groupTutor.id, { classId: f.c.id, kind: "ANNOUNCEMENT", title: "Hi", body: "x", sendAt: later(1) }, NOW))).toBe("denied");
    expect(await outcome(() => scheduleSend(f.teacher.id, { classId: f.c.id, kind: "ANNOUNCEMENT", body: "No title", sendAt: later(1) }, NOW))).toBe("invalid");
    await scheduleSend(f.teacher.id, { classId: f.c.id, kind: "ANNOUNCEMENT", title: "Practice test", body: "{class}: practice test Saturday, {first_name}!", pinned: true, sendAt: later(1) }, NOW);
    expect(await db.announcement.count()).toBe(0);
    expect(await sweepScheduledSends(later(1))).toBe(1);
    expect(await db.announcement.findFirstOrThrow()).toMatchObject({ title: "Practice test", body: "SAT Fall: practice test Saturday, everyone!", pinned: true, authorId: f.teacher.id });
  });
});

describe("parent progress emails", () => {
  it("periods: Sunday 17:00 UTC weekly, the 1st at 17:00 UTC monthly", () => {
    expect(currentPeriod("WEEKLY", new Date("2026-11-18T15:00:00Z"))).toMatchObject({ key: "W2026-11-15", days: 7 });
    expect(currentPeriod("WEEKLY", new Date("2026-11-15T16:59:00Z")).key).toBe("W2026-11-08");
    expect(currentPeriod("MONTHLY", new Date("2026-11-18T15:00:00Z"))).toMatchObject({ key: "M2026-11", days: 31 });
    expect(currentPeriod("MONTHLY", new Date("2026-12-01T10:00:00Z")).key).toBe("M2026-11");
  });

  it("only when the admin turns them on; the numbers; once a period; a cap per hour; unsubscribe stops them", async () => {
    const f = await fixture();
    await addGuardian(f.admin.id, f.c.id, f.ana.id, { name: "Rosa", email: "rosa@home.org", consent: true });
    await addGuardian(f.admin.id, f.c.id, f.ben.id, { name: "Ken", email: "ken@home.org", consent: true });
    const sunday = new Date("2026-11-15T18:00:00Z");
    const day = (d: number) => new Date(sunday.getTime() - d * DAY).toISOString().slice(0, 10);
    await db.studyDay.createMany({ data: [
      { userId: f.ana.id, day: day(2), minutes: 30, questionsAnswered: 10, questionsCorrect: 8 },
      { userId: f.ana.id, day: day(4), minutes: 15, questionsAnswered: 10, questionsCorrect: 6 },
      { userId: f.ana.id, day: day(10), minutes: 20, questionsAnswered: 10, questionsCorrect: 5 },
    ] });
    await db.scoreRecord.create({ data: { studentId: f.ana.id, source: "PSAT", takenOn: new Date("2026-10-15T00:00:00Z"), total: 1010, isBaseline: true, enteredById: f.admin.id } });
    await db.studentProfile.create({ data: { userId: f.ana.id, testDate: new Date("2026-12-05T12:00:00Z") } });
    expect(await sendGuardianProgress(sunday)).toBe(0);
    expect(await outcome(() => setGuardianFrequency(f.teacher.id, f.programId, "WEEKLY"))).toBe("hidden");
    await setGuardianFrequency(f.admin.id, f.programId, "WEEKLY");
    // A cap of one an hour: one now, the other the next hour; then nothing until next week.
    expect(await sendGuardianProgress(sunday, { limit: 1 })).toBe(1);
    expect(await sendGuardianProgress(new Date(sunday.getTime() + 3600_000), { limit: 1 })).toBe(1);
    expect(await sendGuardianProgress(new Date(sunday.getTime() + 2 * 3600_000))).toBe(0);
    const rosa = sent.find((m) => m.to === "rosa@home.org")!;
    expect(rosa.subject).toBe("Ana Diaz's week in Admin's tutoring program");
    expect(rosa.text).toContain("Practice time: 45 minutes.");
    expect(rosa.text).toContain("Questions answered: 20.");
    expect(rosa.text).toContain("Accuracy: 70% (up from 50% the week before).");
    expect(rosa.text).toContain("Latest score: 1010 (PSAT).");
    expect(rosa.text).toContain("Upcoming test date: Dec 5, 2026.");
    expect(rosa.text).toMatch(/Unsubscribe: .*\/unsubscribe\//);
    expect(rosa.text).not.toContain("Ben");
    // Monthly: the 1st.
    await setGuardianFrequency(f.admin.id, f.programId, "MONTHLY");
    expect(await sendGuardianProgress(new Date("2026-12-01T17:30:00Z"))).toBe(2);
    expect(sent.at(-1)!.subject).toMatch(/'s month in /);
  });

  it("staff in scope can preview a student's email; others can't", async () => {
    const f = await fixture();
    await addGuardian(f.admin.id, f.c.id, f.ben.id, { name: "Ken", email: "ken@home.org", consent: true });
    const p = await previewGuardianEmail(f.groupTutor.id, f.c.id, f.ben.id, NOW);
    expect(p.message.to).toBe("ken@home.org");
    expect(p.message.text).toContain("Hi Ken,");
    expect(p.frequency).toBe("OFF");
    expect(await outcome(() => previewGuardianEmail(f.groupTutor.id, f.c.id, f.ana.id, NOW))).toBe("hidden");
    expect(await outcome(() => previewGuardianEmail(f.outsider.id, f.c.id, f.ben.id, NOW))).toBe("hidden");
    expect(sent).toHaveLength(0); // a preview never sends
  });
});
