import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { createClass } from "@/server/classes";
import { createGroup } from "@/server/groups";
import { bulkMessage, contacts, getThread, listThreads, sendMessage, startThread, tutorsOf, unreadThreadCount } from "@/server/messages";
import { classAnnouncements, createAnnouncement, deleteAnnouncement, studentAnnouncements, updateAnnouncement } from "@/server/announcements";
import { getNotificationPrefs, listNotifications, markNotificationsRead, notify, saveNotificationPrefs, unreadCount } from "@/server/notifications";
import { createUser, resetDb } from "../helpers/db";

/**
 * Messaging, announcements and notifications: who may reach whom.
 * Fixture: one program (admin), a teacher, a Math specialist (whole class),
 * an R&W specialist limited to group B, a viewer, students Ana and Ben in
 * group A and Cal and Dee in group B, and a second program with its own
 * teacher and student.
 */

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/email", () => ({
  sendEmail: async (m: { to: string; subject: string; text: string }) => {
    sent.push(m);
  },
}));

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
});

async function staffAs(classId: string, userId: string, role: "TEACHER" | "SPECIALIST" | "VIEWER", scope: { sections?: string[]; groupIds?: string[] } = {}) {
  await db.classStaff.create({ data: { classId, userId, role, sections: scope.sections ?? [], domains: [], groupIds: scope.groupIds ?? [] } });
}

async function fixture() {
  const [admin, teacher, math, rw, viewer, ana, ben, cal, dee, otherAdmin, otherStudent] = await Promise.all(
    ["Admin", "Teacher", "Math Spec", "RW Spec", "Viewer", "Ana", "Ben", "Cal", "Dee", "Other Admin", "Olly"].map((n) => createUser(n)),
  );
  const c = await createClass(admin.id, "SAT Fall");
  for (const s of [ana, ben, cal, dee]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  const groupA = await createGroup(admin.id, c.id, "Group A", [ana.id, ben.id]);
  const groupB = await createGroup(admin.id, c.id, "Group B", [cal.id, dee.id]);
  await staffAs(c.id, teacher.id, "TEACHER");
  await staffAs(c.id, math.id, "SPECIALIST", { sections: ["MATH"] });
  await staffAs(c.id, rw.id, "SPECIALIST", { sections: ["RW"], groupIds: [groupB.id] });
  await staffAs(c.id, viewer.id, "VIEWER");
  const other = await createClass(otherAdmin.id, "Other program class");
  await db.classMember.create({ data: { classId: other.id, userId: otherStudent.id } });
  return { admin, teacher, math, rw, viewer, ana, ben, cal, dee, otherAdmin, otherStudent, c, other, groupA, groupB };
}

describe("who can start a conversation", () => {
  it("lets staff message only students in their scope", async () => {
    const f = await fixture();
    await expect(startThread(f.teacher.id, { classId: f.c.id, studentId: f.ana.id })).resolves.toBeTruthy();
    await expect(startThread(f.math.id, { classId: f.c.id, studentId: f.ana.id })).resolves.toBeTruthy();
    await expect(startThread(f.admin.id, { classId: f.c.id, studentId: f.dee.id })).resolves.toBeTruthy();
    // Group-limited specialist: group B only.
    await expect(startThread(f.rw.id, { classId: f.c.id, studentId: f.cal.id })).resolves.toBeTruthy();
    await expect(startThread(f.rw.id, { classId: f.c.id, studentId: f.ana.id })).rejects.toBeInstanceOf(NotFoundError);
    // Viewers can't message.
    await expect(startThread(f.viewer.id, { classId: f.c.id, studentId: f.ana.id })).rejects.toBeInstanceOf(Error);
    // Another program's staff, and students outside the class.
    await expect(startThread(f.otherAdmin.id, { classId: f.c.id, studentId: f.ana.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(startThread(f.teacher.id, { classId: f.c.id, studentId: f.otherStudent.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(startThread(f.teacher.id, { classId: f.other.id, studentId: f.otherStudent.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets students message only their own tutors", async () => {
    const f = await fixture();
    const anaTutors = (await tutorsOf(f.ana.id)).map((t) => t.staffId).sort();
    // The admin created the class, so they're one of its teachers too.
    expect(anaTutors).toEqual([f.admin.id, f.teacher.id, f.math.id].sort());
    const calTutors = (await tutorsOf(f.cal.id)).map((t) => t.staffId).sort();
    expect(calTutors).toEqual([f.admin.id, f.teacher.id, f.math.id, f.rw.id].sort());
    await expect(startThread(f.ana.id, { classId: f.c.id, staffId: f.teacher.id })).resolves.toBeTruthy();
    await expect(startThread(f.ana.id, { classId: f.c.id, staffId: f.rw.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(startThread(f.ana.id, { classId: f.c.id, staffId: f.viewer.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(startThread(f.ana.id, { classId: f.c.id, staffId: f.ben.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(startThread(f.ana.id, { classId: f.other.id, staffId: f.otherAdmin.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("offers only reachable people as contacts", async () => {
    const f = await fixture();
    const rw = await contacts(f.rw.id);
    expect(rw.staffClasses).toHaveLength(1);
    expect(rw.staffClasses[0].students.map((s) => s.name).sort()).toEqual(["Cal", "Dee"]);
    expect(rw.staffClasses[0].groups.map((g) => g.name)).toEqual(["Group B"]);
    expect((await contacts(f.viewer.id)).staffClasses).toHaveLength(0);
    expect((await contacts(f.ana.id)).tutors.map((t) => t.name).sort()).toEqual(["Admin", "Math Spec", "Teacher"]);
  });
});

describe("reading and replying", () => {
  it("keeps threads private to the pair, with read-only access for the program admin", async () => {
    const f = await fixture();
    const t = await startThread(f.teacher.id, { classId: f.c.id, studentId: f.ana.id });
    await sendMessage(f.teacher.id, t.id, "Nice work on the diagnostic.");
    await sendMessage(f.ana.id, t.id, "Thanks!");
    const asAna = await getThread(f.ana.id, t.id);
    expect(asAna.messages.map((m) => m.body)).toEqual(["Nice work on the diagnostic.", "Thanks!"]);
    const asAdmin = await getThread(f.admin.id, t.id);
    expect(asAdmin.viewer).toEqual({ mode: "admin", canReply: false });
    await expect(sendMessage(f.admin.id, t.id, "Hi")).rejects.toBeInstanceOf(ClassError);
    for (const u of [f.ben, f.math, f.rw, f.viewer, f.otherAdmin]) {
      await expect(getThread(u.id, t.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(sendMessage(u.id, t.id, "Hi")).rejects.toBeInstanceOf(NotFoundError);
    }
    const program = await listThreads(f.admin.id, { view: "program" });
    expect(program.threads).toHaveLength(1);
    await expect(listThreads(f.teacher.id, { view: "program" })).rejects.toBeInstanceOf(ClassError);
    await expect(listThreads(f.otherAdmin.id, { view: "program" }).then((r) => r.threads.length)).resolves.toBe(0);
  });

  it("closes a thread when the tutor loses the student from their scope", async () => {
    const f = await fixture();
    const t = await startThread(f.rw.id, { classId: f.c.id, studentId: f.cal.id });
    await sendMessage(f.rw.id, t.id, "Let's look at transitions.");
    // Cal moves to group A.
    await db.classGroupMember.delete({ where: { groupId_userId: { groupId: f.groupB.id, userId: f.cal.id } } });
    await db.classGroupMember.create({ data: { groupId: f.groupA.id, userId: f.cal.id } });
    await expect(getThread(f.rw.id, t.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listThreads(f.rw.id)).threads).toHaveLength(0);
    const asCal = await getThread(f.cal.id, t.id);
    expect(asCal.viewer.canReply).toBe(false);
    await expect(sendMessage(f.cal.id, t.id, "ok")).rejects.toBeInstanceOf(ClassError);
  });

  it("tracks unread threads and notifies without the message text", async () => {
    const f = await fixture();
    const t = await startThread(f.teacher.id, { classId: f.c.id, studentId: f.ana.id });
    await sendMessage(f.teacher.id, t.id, "Your secret study plan");
    expect(await unreadThreadCount(f.ana.id)).toBe(1);
    expect(await unreadCount(f.ana.id)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).not.toContain("secret study plan");
    expect(sent[0].subject).toBe("New message from Teacher");
    await getThread(f.ana.id, t.id);
    expect(await unreadThreadCount(f.ana.id)).toBe(0);
    expect(await unreadCount(f.ana.id)).toBe(0);
    // A second message within the hour: notice comes back, no second email.
    await sendMessage(f.teacher.id, t.id, "One more thing");
    expect(await unreadCount(f.ana.id)).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("validates and rate-limits messages", async () => {
    const f = await fixture();
    const t = await startThread(f.teacher.id, { classId: f.c.id, studentId: f.ana.id });
    await expect(sendMessage(f.teacher.id, t.id, "   ")).rejects.toThrow(/Write a message/);
    await expect(sendMessage(f.teacher.id, t.id, "x".repeat(4001))).rejects.toThrow(/up to/);
    const now = new Date();
    await db.message.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ threadId: t.id, authorId: f.teacher.id, body: `m${i}`, createdAt: now })) });
    await expect(sendMessage(f.teacher.id, t.id, "one too many", now)).rejects.toThrow(/a lot of messages/);
  });
});

describe("bulk messages", () => {
  it("reaches only the sender's scope, one private thread each", async () => {
    const f = await fixture();
    const r = await bulkMessage(f.rw.id, f.c.id, { body: "Practice test Saturday." });
    expect(r.sent).toBe(2);
    const threads = await db.messageThread.findMany({ where: { staffId: f.rw.id }, select: { studentId: true } });
    expect(threads.map((t) => t.studentId).sort()).toEqual([f.cal.id, f.dee.id].sort());
    await expect(bulkMessage(f.rw.id, f.c.id, { groupIds: [f.groupA.id], body: "Hi" })).rejects.toBeInstanceOf(ClassError);
    await expect(bulkMessage(f.rw.id, f.c.id, { studentIds: [f.ana.id], body: "Hi" })).rejects.toBeInstanceOf(ClassError);
    await expect(bulkMessage(f.viewer.id, f.c.id, { body: "Hi" })).rejects.toBeInstanceOf(ClassError);
    await expect(bulkMessage(f.otherAdmin.id, f.c.id, { body: "Hi" })).rejects.toBeInstanceOf(NotFoundError);
    const all = await bulkMessage(f.teacher.id, f.c.id, { groupIds: [f.groupA.id], body: "Group A: bring calculators." });
    expect(all.sent).toBe(2);
    // Cal can't see Dee's copy.
    const deeThread = await db.messageThread.findFirstOrThrow({ where: { studentId: f.dee.id, staffId: f.rw.id } });
    await expect(getThread(f.cal.id, deeThread.id)).rejects.toBeInstanceOf(NotFoundError);
    const log = await db.auditLog.findMany({ where: { action: "message.bulk" } });
    expect(log).toHaveLength(2);
  });

  it("limits group messages per hour", async () => {
    const f = await fixture();
    for (let i = 0; i < 6; i++) await bulkMessage(f.teacher.id, f.c.id, { body: `Note ${i}` });
    await expect(bulkMessage(f.teacher.id, f.c.id, { body: "Seventh" })).rejects.toThrow(/up to 6/);
  });
});

describe("announcements", () => {
  it("posts within scope and shows students only their class's and groups' posts", async () => {
    const f = await fixture();
    await createAnnouncement(f.teacher.id, f.c.id, { title: "Welcome", body: "First session Monday.", pinned: true });
    await createAnnouncement(f.rw.id, f.c.id, { groupId: f.groupB.id, title: "Group B reading", body: "Read chapter 2." });
    await expect(createAnnouncement(f.rw.id, f.c.id, { title: "Everyone", body: "x" })).rejects.toBeInstanceOf(ClassError);
    await expect(createAnnouncement(f.rw.id, f.c.id, { groupId: f.groupA.id, title: "A", body: "x" })).rejects.toBeInstanceOf(ClassError);
    await expect(createAnnouncement(f.viewer.id, f.c.id, { title: "V", body: "x" })).rejects.toBeInstanceOf(ClassError);
    await expect(createAnnouncement(f.otherAdmin.id, f.c.id, { title: "O", body: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createAnnouncement(f.ana.id, f.c.id, { title: "S", body: "x" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await studentAnnouncements(f.ana.id)).map((a) => a.title)).toEqual(["Welcome"]);
    expect((await studentAnnouncements(f.cal.id)).map((a) => a.title)).toEqual(["Welcome", "Group B reading"]);
    expect(await studentAnnouncements(f.otherStudent.id)).toEqual([]);
    expect(await unreadCount(f.cal.id)).toBe(2);
    // Staff view: the R&W specialist sees class-wide and group B posts; the viewer reads all.
    expect((await classAnnouncements(f.rw.id, f.c.id)).rows).toHaveLength(2);
    const v = await classAnnouncements(f.viewer.id, f.c.id);
    expect(v.canPost).toBe(false);
    expect(v.rows.every((r) => !r.canEdit)).toBe(true);
  });

  it("lets the author or a teacher edit and delete", async () => {
    const f = await fixture();
    const a = await createAnnouncement(f.rw.id, f.c.id, { groupId: f.groupB.id, title: "Group B", body: "Hi" });
    const t = await createAnnouncement(f.teacher.id, f.c.id, { title: "Class", body: "Hi" });
    await expect(updateAnnouncement(f.math.id, a.id, { title: "Hacked" })).rejects.toBeInstanceOf(ClassError);
    await expect(updateAnnouncement(f.rw.id, t.id, { title: "Hacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateAnnouncement(f.ana.id, a.id, { pinned: true })).rejects.toBeInstanceOf(NotFoundError);
    await updateAnnouncement(f.rw.id, a.id, { title: "Group B update", pinned: true });
    await updateAnnouncement(f.teacher.id, a.id, { body: "Edited by teacher" });
    const row = await db.announcement.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ title: "Group B update", body: "Edited by teacher", pinned: true });
    await expect(deleteAnnouncement(f.viewer.id, a.id)).rejects.toBeInstanceOf(ClassError);
    await deleteAnnouncement(f.admin.id, a.id);
    expect(await db.notification.count({ where: { key: `announcement:${a.id}` } })).toBe(0);
  });
});

describe("notification settings", () => {
  it("respects each person's choices and keeps notices private", async () => {
    const f = await fixture();
    expect((await getNotificationPrefs(f.ana.id)).messages).toEqual({ site: true, email: true });
    await saveNotificationPrefs(f.ana.id, { messages: { site: false, email: false }, junk: { site: 1 } });
    const t = await startThread(f.teacher.id, { classId: f.c.id, studentId: f.ana.id });
    await sendMessage(f.teacher.id, t.id, "Hello");
    expect(await unreadCount(f.ana.id)).toBe(0);
    expect(sent).toHaveLength(0);
    await saveNotificationPrefs(f.cal.id, { announcements: { site: true, email: true } });
    await createAnnouncement(f.teacher.id, f.c.id, { title: "Mock test", body: "Saturday 9am" });
    expect(sent.map((m) => m.to)).toEqual([f.cal.email]);
    const n = await listNotifications(f.cal.id);
    expect(n.rows).toHaveLength(1);
    // Someone else can't mark Cal's notice read.
    expect(await markNotificationsRead(f.dee.id, n.rows[0].id)).toBe(0);
    expect(await markNotificationsRead(f.cal.id, n.rows[0].id)).toBe(1);
    expect(await unreadCount(f.cal.id)).toBe(0);
  });

  it("pages long notification lists", async () => {
    const f = await fixture();
    for (let i = 0; i < 35; i++) await notify([f.ana.id], { kind: "announcements", key: `k${i}`, title: `N${i}`, href: "/dashboard" }, new Date(Date.UTC(2026, 0, 1, 0, i)));
    const p1 = await listNotifications(f.ana.id);
    expect(p1.rows).toHaveLength(30);
    const p2 = await listNotifications(f.ana.id, { before: p1.next! });
    expect(p2.rows).toHaveLength(5);
    expect(p2.next).toBeNull();
  });
});

describe("a program's public page", () => {
  it("is off until its admin sets an address and makes it live, and shows only public fields", async () => {
    const { updateProgram, publicProgram } = await import("@/server/programs");
    const f = await fixture();
    const p = await db.program.findFirstOrThrow({ where: { adminId: f.admin.id } });
    await expect(updateProgram(f.admin.id, p.id, { isPublic: true })).rejects.toThrow(/page address/);
    await expect(updateProgram(f.admin.id, p.id, { slug: "Bad Slug!" })).rejects.toThrow(/lowercase/);
    await expect(updateProgram(f.admin.id, p.id, { slug: "admin" })).rejects.toThrow(/lowercase/);
    await expect(updateProgram(f.teacher.id, p.id, { slug: "1600" })).rejects.toBeTruthy();
    await updateProgram(f.admin.id, p.id, { name: "The 1600 Project", slug: "1600", schoolAverage: 970, goalGain: 300 });
    expect(await publicProgram("1600")).toBeNull();
    await updateProgram(f.admin.id, p.id, { isPublic: true });
    const page = await publicProgram("1600");
    expect(page).toMatchObject({ name: "The 1600 Project", schoolAverage: 970, goalGain: 300 });
    expect(Object.keys(page!)).not.toContain("adminId");
    const other = await db.program.findFirstOrThrow({ where: { adminId: f.otherAdmin.id } });
    await expect(updateProgram(f.otherAdmin.id, other.id, { slug: "1600" })).rejects.toThrow(/already uses/);
    expect(await publicProgram("../etc")).toBeNull();
  });

  it("shows a student only the programs they're in", async () => {
    const { studentPrograms } = await import("@/server/programs");
    const f = await fixture();
    await db.program.updateMany({ where: { adminId: f.admin.id }, data: { name: "The 1600 Project" } });
    expect((await studentPrograms(f.ana.id)).map((p) => p.name)).toEqual(["The 1600 Project"]);
    expect((await studentPrograms(f.otherStudent.id)).map((p) => p.name)).not.toContain("The 1600 Project");
    const loner = await createUser("Loner");
    expect(await studentPrograms(loner.id)).toEqual([]);
  });
});
