import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { createClass } from "@/server/classes";
import { createGroup } from "@/server/groups";
import { awardBadges, myBadges, studentBadges } from "@/server/badges";
import { createUser, resetDb } from "../helpers/db";

/** Badges: earned from activity, never duplicated, visible only to the student and staff in scope. */

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));
beforeEach(resetDb);

const dayStr = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

describe("badges", () => {
  it("awards streak, gain, diagnostic, mistake-log and attendance badges once", async () => {
    const [admin, ana] = await Promise.all([createUser("Admin"), createUser("Ana")]);
    const c = await createClass(admin.id, "SAT Fall");
    await db.classMember.create({ data: { classId: c.id, userId: ana.id } });
    // 6 days in a row of practice, ending today.
    await db.studyDay.createMany({ data: Array.from({ length: 6 }, (_, i) => ({ userId: ana.id, day: dayStr(i), minutes: 20, questionsAnswered: 5, questionsCorrect: 4 })) });
    // Baseline 980, latest 1110: +130.
    await db.scoreRecord.createMany({
      data: [
        { studentId: ana.id, source: "PSAT", takenOn: new Date("2026-03-01T00:00:00Z"), total: 980, isBaseline: true, enteredById: ana.id },
        { studentId: ana.id, source: "PRACTICE_BLUEBOOK", takenOn: new Date("2026-10-01T00:00:00Z"), total: 1110, enteredById: ana.id },
      ],
    });
    // A cleared mistake log.
    await db.mistakeItem.create({ data: { studentId: ana.id, sourceType: "SCORE", sourceId: "x", label: "Q4", due: new Date(), retiredAt: new Date() } });
    // Every session present in a finished month (4 sessions in October 2026).
    for (let i = 0; i < 4; i++) {
      const s = await db.classSession.create({ data: { classId: c.id, startsAt: new Date(Date.UTC(2026, 9, 5 + i * 7, 21)), endsAt: new Date(Date.UTC(2026, 9, 5 + i * 7, 22)), createdById: admin.id } });
      await db.attendanceRecord.create({ data: { sessionId: s.id, studentId: ana.id, status: "PRESENT", markedById: admin.id } });
    }
    const now = new Date("2026-11-10T12:00:00Z");
    const first = await awardBadges(ana.id, now);
    expect(first.map((b) => `${b.kind}:${b.detail}`).sort()).toEqual(["GAIN_100:", "MISTAKES_CLEARED:", "PERFECT_ATTENDANCE:2026-10", "STREAK_5:"].sort());
    expect(await awardBadges(ana.id, now)).toEqual([]);
    const mine = await myBadges(ana.id);
    expect(mine).toHaveLength(4);
    expect(mine.find((b) => b.kind === "PERFECT_ATTENDANCE")?.label).toBe("Perfect attendance, October 2026");
  });

  it("doesn't count a month with an absence, or the current month", async () => {
    const [admin, ben] = await Promise.all([createUser("Admin"), createUser("Ben")]);
    const c = await createClass(admin.id, "SAT Fall");
    await db.classMember.create({ data: { classId: c.id, userId: ben.id } });
    for (let i = 0; i < 4; i++) {
      const s = await db.classSession.create({ data: { classId: c.id, startsAt: new Date(Date.UTC(2026, 9, 5 + i * 7, 21)), endsAt: new Date(Date.UTC(2026, 9, 5 + i * 7, 22)), createdById: admin.id } });
      await db.attendanceRecord.create({ data: { sessionId: s.id, studentId: ben.id, status: i === 2 ? "ABSENT" : "PRESENT", markedById: admin.id } });
    }
    expect((await awardBadges(ben.id, new Date("2026-11-10T12:00:00Z"))).map((b) => b.kind)).not.toContain("PERFECT_ATTENDANCE");
    expect((await awardBadges(ben.id, new Date("2026-10-30T12:00:00Z"))).map((b) => b.kind)).not.toContain("PERFECT_ATTENDANCE");
  });

  it("shows a student's badges only to staff whose scope includes them", async () => {
    const [admin, rwB, ana, cal, other] = await Promise.all(["Admin", "RW B", "Ana", "Cal", "Other"].map((n) => createUser(n)));
    const c = await createClass(admin.id, "SAT Fall");
    for (const s of [ana, cal]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
    const gB = await createGroup(admin.id, c.id, "Group B", [cal.id]);
    await db.classStaff.create({ data: { classId: c.id, userId: rwB.id, role: "SPECIALIST", sections: ["RW"], domains: [], groupIds: [gB.id] } });
    await db.badge.create({ data: { userId: ana.id, kind: "STREAK_5" } });
    expect(await studentBadges(admin.id, c.id, ana.id)).toHaveLength(1);
    await expect(studentBadges(rwB.id, c.id, ana.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(studentBadges(other.id, c.id, ana.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(studentBadges(cal.id, c.id, ana.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
