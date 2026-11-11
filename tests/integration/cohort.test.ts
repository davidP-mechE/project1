import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { assignQuestions, classProgress, createClass, joinClass, myClasses, getQuestionAssignment } from "@/server/classes";
import { createGroup, updateGroup } from "@/server/groups";
import { addGuardian, attendanceVsGains, classAlerts, createSessions, dismissAlert, guardiansOf, markAttendance, sessionRegister, unsubscribeGuardian } from "@/server/cohort";
import { exportGrades, importRoster, previewRoster, readRoster } from "@/server/roster";
import { sendGuardianSummaries } from "@/server/program-jobs";
import { addScore } from "@/server/scores";
import { createUser, resetDb } from "../helpers/db";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/email", () => ({ sendEmail: async (m: { to: string; subject: string; text: string }) => void sent.push(m) }));
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
  const [admin, tutor, viewer, outsider, ana, ben, cal] = await Promise.all(["Admin", "Tutor", "Viewer", "Outsider", "Ana", "Ben", "Cal"].map((n) => createUser(n)));
  const c = await createClass(admin.id, "SAT Fall");
  for (const s of [ana, ben, cal]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  const gA = await createGroup(admin.id, c.id, "A", [ana.id]);
  const gB = await createGroup(admin.id, c.id, "B", [ben.id, cal.id]);
  await db.classStaff.createMany({ data: [{ classId: c.id, userId: tutor.id, role: "SPECIALIST", groupIds: [gB.id] }, { classId: c.id, userId: viewer.id, role: "VIEWER" }] });
  const ws = await db.worksheet.create({ data: { ownerId: admin.id, title: "WS", fileKey: "k", sizeBytes: BigInt(1), status: "READY", items: { create: [{ order: 0, label: "1", type: "MULTIPLE_CHOICE", prompt: "Q", choices: ["a", "b"], correctChoice: 0, answer: "a", explanation: "", topic: "t" }] } }, include: { items: true } });
  await db.worksheet.create({ data: { ownerId: tutor.id, title: "Tutor WS", fileKey: "k2", sizeBytes: BigInt(1), status: "READY", items: { create: [{ order: 0, label: "1", type: "MULTIPLE_CHOICE", prompt: "Q", choices: ["a", "b"], correctChoice: 0, answer: "a", explanation: "", topic: "t" }] } } });
  return { c, admin, tutor, viewer, outsider, ana, ben, cal, gA, gB, ws };
}

describe("assigning to groups or chosen students", () => {
  it("only the targeted students see it; late joiners to a group get it", async () => {
    const f = await fixture();
    const [a] = await assignQuestions(f.admin.id, { classIds: [f.c.id], worksheetId: f.ws.id, itemIds: [], title: "Group B only", targets: { groupIds: [f.gB.id] } });
    const [b] = await assignQuestions(f.admin.id, { classIds: [f.c.id], worksheetId: f.ws.id, itemIds: [], title: "Just Ana", targets: { studentIds: [f.ana.id] } });
    const titles = async (id: string) => (await myClasses(id))[0].assignments.map((x) => x.title).sort();
    expect(await titles(f.ana.id)).toEqual(["Just Ana"]);
    expect(await titles(f.ben.id)).toEqual(["Group B only"]);
    expect(await outcome(() => getQuestionAssignment(f.ana.id, a.id))).toBe("hidden");
    expect(await outcome(() => getQuestionAssignment(f.ben.id, b.id))).toBe("hidden");
    // Ana joins group B: she now has it.
    await updateGroup(f.admin.id, f.c.id, f.gB.id, { studentIds: [f.ben.id, f.cal.id, f.ana.id] });
    expect(await titles(f.ana.id)).toEqual(["Group B only", "Just Ana"]);
    // The grid marks it "not assigned" for others.
    expect((await classProgress(f.admin.id, f.c.id)).cells[`${f.ben.id}:${b.id}`].status).toBe("not_assigned");
  });

  it("a group-limited tutor can only target their own group and its students", async () => {
    const f = await fixture();
    const tws = await db.worksheet.findFirstOrThrow({ where: { ownerId: f.tutor.id } });
    expect(await outcome(() => assignQuestions(f.tutor.id, { classIds: [f.c.id], worksheetId: tws.id, itemIds: [], title: "x", targets: { groupIds: [f.gA.id] } }))).toBe("denied");
    expect(await outcome(() => assignQuestions(f.tutor.id, { classIds: [f.c.id], worksheetId: tws.id, itemIds: [], title: "x", targets: { studentIds: [f.ana.id] } }))).toBe("denied");
    // "Whole class" from a group-limited tutor means their groups.
    const [a] = await assignQuestions(f.tutor.id, { classIds: [f.c.id], worksheetId: tws.id, itemIds: [], title: "For my group" });
    expect(a.groupIds).toEqual([f.gB.id]);
    expect((await myClasses(f.ana.id))[0].assignments).toHaveLength(0);
  });
});

describe("attendance", () => {
  it("weekly sessions; teachers and the group's tutor mark; viewers and others can't; edits are audited", async () => {
    const f = await fixture();
    const start = new Date(Date.now() - 14 * 86_400_000);
    expect(await createSessions(f.admin.id, f.c.id, { startsAt: start.toISOString(), minutes: 60, weeks: 3 })).toBe(3);
    expect(await outcome(() => createSessions(f.tutor.id, f.c.id, { startsAt: start.toISOString(), minutes: 60 }))).toBe("denied"); // must pick their group
    expect(await createSessions(f.tutor.id, f.c.id, { startsAt: start.toISOString(), minutes: 45, groupId: f.gB.id })).toBe(1);
    const sessions = await db.classSession.findMany({ orderBy: { startsAt: "asc" } });
    const whole = sessions.find((s) => !s.groupId)!;
    expect((await sessionRegister(f.tutor.id, f.c.id, whole.id)).students.map((s) => s.name)).toEqual(["Ben", "Cal"]);
    await markAttendance(f.tutor.id, f.c.id, whole.id, f.ben.id, "PRESENT");
    expect(await outcome(() => markAttendance(f.tutor.id, f.c.id, whole.id, f.ana.id, "PRESENT"))).toBe("hidden");
    expect(await outcome(() => markAttendance(f.viewer.id, f.c.id, whole.id, f.ana.id, "PRESENT"))).toBe("denied");
    expect(await outcome(() => markAttendance(f.outsider.id, f.c.id, whole.id, f.ana.id, "PRESENT"))).toBe("hidden");
    expect(await outcome(() => markAttendance(f.admin.id, f.c.id, whole.id, f.ana.id, "MAYBE"))).toBe("invalid");
    await markAttendance(f.admin.id, f.c.id, whole.id, f.ben.id, "LATE");
    expect(await db.auditLog.count({ where: { action: "attendance.edit" } })).toBe(1);
    // Rates and gains.
    for (const s of sessions.filter((x) => !x.groupId && x.startsAt < new Date())) await markAttendance(f.admin.id, f.c.id, s.id, f.ana.id, "PRESENT");
    await addScore(f.ana.id, f.ana.id, { source: "PSAT", takenOn: "2026-09-01", total: 970 });
    await addScore(f.ana.id, f.ana.id, { source: "PRACTICE_BLUEBOOK", takenOn: "2026-10-30", total: 1100 });
    const rows = await attendanceVsGains(f.admin.id, f.c.id);
    expect(rows.find((r) => r.name === "Ana")).toMatchObject({ rate: 1, gain: 130 });
    expect((await attendanceVsGains(f.tutor.id, f.c.id)).map((r) => r.name)).toEqual(["Ben", "Cal"]);
  });
});

describe("alerts", () => {
  it("flags overdue work, inactivity and absences for students in scope, and can be snoozed", async () => {
    const f = await fixture();
    await assignQuestions(f.admin.id, { classIds: [f.c.id], worksheetId: f.ws.id, itemIds: [], title: "Overdue set", dueAt: new Date(Date.now() - 86_400_000) });
    const s = await createSessions(f.admin.id, f.c.id, { startsAt: new Date(Date.now() - 10 * 86_400_000).toISOString(), minutes: 60, weeks: 2 });
    expect(s).toBe(2);
    for (const x of await db.classSession.findMany()) await markAttendance(f.admin.id, f.c.id, x.id, f.cal.id, "ABSENT");
    const a = await classAlerts(f.admin.id, f.c.id);
    const kinds = (name: string) => a.alerts.filter((x) => x.name === name).map((x) => x.kind).sort();
    expect(kinds("Cal")).toEqual(["ABSENCES", "INACTIVE", "MISSING_WORK"]);
    expect((await classAlerts(f.tutor.id, f.c.id)).alerts.every((x) => x.name !== "Ana")).toBe(true);
    await dismissAlert(f.admin.id, f.c.id, f.cal.id, "INACTIVE", 7);
    expect((await classAlerts(f.admin.id, f.c.id)).alerts.filter((x) => x.name === "Cal").map((x) => x.kind)).not.toContain("INACTIVE");
    expect(await outcome(() => dismissAlert(f.viewer.id, f.c.id, f.cal.id, "ABSENCES", null))).toBe("denied");
    expect(await outcome(() => dismissAlert(f.tutor.id, f.c.id, f.ana.id, "ABSENCES", null))).toBe("hidden");
  });
});

describe("roster import", () => {
  const csv = '﻿Name,Email,Group,Target,Baseline,Baseline_Date\r\n"Diaz, Ana",new1@school.org,Tuesday,1200,970,2026-09-14\r\nBo,new2@school.org,,,,\r\n';

  it("parses quoted CSV with a BOM and reports bad rows", () => {
    const { rows } = readRoster(csv);
    expect(rows[0]).toMatchObject({ name: "Diaz, Ana", email: "new1@school.org", group: "Tuesday", target: 1200, baseline: 970, errors: [] });
    const bad = readRoster("email,target\nnot-an-email,1205\nx@y.org,\nx@y.org,1200\n").rows;
    expect(bad[0].errors).toEqual(["email isn't valid", "target must be 400–1600 in steps of 10"]);
    expect(bad[2].errors).toEqual(["email is listed twice"]);
    expect(readRoster("name\nAna").error).toMatch(/email/);
  });

  it("sends nothing if a row is bad; otherwise invites, and applies group, goal and baseline on joining", async () => {
    const f = await fixture();
    await expect(importRoster(f.admin.id, f.c.id, "email\nbad")).rejects.toThrow("Nothing was sent");
    expect(sent).toHaveLength(0);
    expect(await outcome(() => previewRoster(f.tutor.id, f.c.id, csv))).toBe("denied");
    expect(await importRoster(f.admin.id, f.c.id, csv)).toEqual({ invited: 2, alreadyIn: 0 });
    expect(sent.map((m) => m.to).sort()).toEqual(["new1@school.org", "new2@school.org"]);
    const ana2 = await createUser("Ana Diaz");
    await db.user.update({ where: { id: ana2.id }, data: { email: "new1@school.org" } });
    const code = (await db.class.findUniqueOrThrow({ where: { id: f.c.id } })).joinCode;
    await joinClass(ana2.id, code);
    expect(await db.classGroupMember.count({ where: { userId: ana2.id, group: { name: "Tuesday", classId: f.c.id } } })).toBe(1);
    expect(await db.studentProfile.findUnique({ where: { userId: ana2.id } })).toMatchObject({ targetScore: 1200 });
    expect(await db.scoreRecord.findFirst({ where: { studentId: ana2.id } })).toMatchObject({ total: 970, isBaseline: true });
  });
});

describe("grade export", () => {
  it("exports students in scope; emails only for managers who ask; viewers can't export", async () => {
    const f = await fixture();
    await db.user.update({ where: { id: f.ana.id }, data: { name: "=HYPERLINK(evil)" } });
    await assignQuestions(f.admin.id, { classIds: [f.c.id], worksheetId: f.ws.id, itemIds: [], title: "Set 1" });
    const all = await exportGrades(f.admin.id, f.c.id, { contacts: true });
    expect(all.csv).toContain("Email");
    expect(all.csv).toContain(`'=HYPERLINK(evil)`); // can't run as a formula
    const tutor = await exportGrades(f.tutor.id, f.c.id, { contacts: true });
    expect(tutor.csv).not.toContain("Email");
    expect(tutor.csv).not.toContain("HYPERLINK");
    expect(tutor.csv.trim().split("\r\n")).toHaveLength(3); // header + Ben + Cal
    expect(await outcome(() => exportGrades(f.viewer.id, f.c.id))).toBe("denied");
    expect(await outcome(() => exportGrades(f.outsider.id, f.c.id))).toBe("hidden");
  });
});

describe("guardian emails", () => {
  it("need recorded consent, the class setting, and stop after unsubscribing", async () => {
    const f = await fixture();
    await expect(addGuardian(f.admin.id, f.c.id, f.ana.id, { name: "Mom", email: "mom@home.org", consent: false })).rejects.toThrow("agreed");
    expect(await outcome(() => addGuardian(f.tutor.id, f.c.id, f.ben.id, { name: "Dad", email: "dad@home.org", consent: true }))).toBe("denied");
    await addGuardian(f.admin.id, f.c.id, f.ana.id, { name: "Mom", email: "mom@home.org", consent: true });
    expect(await guardiansOf(f.ana.id, f.ana.id)).toHaveLength(1); // the student sees who gets it
    expect(await outcome(() => guardiansOf(f.ben.id, f.ana.id))).toBe("hidden");
    const sunday = new Date("2026-11-15T17:00:00Z");
    expect(await sendGuardianSummaries(sunday)).toBe(0); // the class hasn't turned it on
    await db.class.update({ where: { id: f.c.id }, data: { guardianSummaries: true } });
    expect(await sendGuardianSummaries(new Date("2026-11-14T17:00:00Z"))).toBe(0); // only Sunday evenings
    expect(await sendGuardianSummaries(sunday)).toBe(1);
    expect(await sendGuardianSummaries(sunday)).toBe(0); // once a week
    const mail = sent.find((m) => m.to === "mom@home.org")!;
    expect(mail.text).toContain("Ana's week");
    expect(mail.text).not.toMatch(/@example\.com/); // no other students' details
    const token = /unsubscribe\/([\w-]+)/.exec(mail.text)![1];
    expect(await unsubscribeGuardian(token)).toBe(true);
    expect(await sendGuardianSummaries(new Date("2026-11-22T17:00:00Z"))).toBe(0);
  });
});
