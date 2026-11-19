import "server-only";
import { db } from "./db";
import { env } from "./env";
import { NotFoundError } from "./courses";
import { ClassError } from "./access";
import { audit } from "./programs";
import { newJoinCode } from "./classes";
import { sendEmail } from "./email";
import { classInviteMessage } from "./email/templates";

/**
 * Start a new semester for a program (its admin only). Each class carried
 * forward gets a fresh copy: same teacher, same staff with the same roles and
 * scopes, the same groups (empty), and a new join code. Last semester's
 * classes are archived, read-only. Nothing about students is deleted: scores,
 * answers, attendance and mistake logs belong to the students and stay.
 * Optionally, last semester's students are invited to the new classes.
 *
 * Classes listed in `copyWork` also bring their courses and assigned work:
 * every course on the class (whose source course still exists) is added to
 * the new class, and its course-lesson and question-set assignments are
 * copied with no dates (the teacher sets new ones). Work aimed at particular
 * students is left behind (those students may not come back), as are each
 * student's own weekly practice sets; work aimed at groups goes to the new
 * class's matching groups.
 */

export type RolloverInput = { semester: string; classIds: string[]; reinvite: boolean; copyWork?: string[] };

const baseName = (name: string) => name.replace(/\s*\((?:fall|spring|summer|winter|autumn|term|semester)[^)]*\)\s*$/i, "").trim();

export async function startSemester(userId: string, programId: string, input: RolloverInput, now = new Date()) {
  const program = await db.program.findFirst({ where: { id: programId, adminId: userId }, select: { id: true, name: true } });
  if (!program) {
    const staff = await db.program.count({ where: { id: programId, classes: { some: { staff: { some: { userId } } } } } });
    if (staff) throw new ClassError("Only the program admin can start a new semester.", 403);
    throw new NotFoundError("Program not found");
  }
  const semester = input.semester.trim().slice(0, 40);
  if (!semester) throw new ClassError("Name the semester, for example Spring 2027.");
  const ids = [...new Set(input.classIds)];
  if (!ids.length) throw new ClassError("Choose at least one class to carry forward.");
  const classes = await db.class.findMany({
    where: { id: { in: ids }, programId, archivedAt: null },
    select: {
      id: true,
      name: true,
      teacherId: true,
      guardianSummaries: true,
      staff: { select: { userId: true, role: true, sections: true, domains: true, groupIds: true, canManageStaff: true } },
      groups: { select: { id: true, name: true } },
      members: { select: { user: { select: { email: true } } } },
      courses: { where: { sourceCourseId: { not: null } }, orderBy: { createdAt: "asc" }, select: { id: true, sourceCourseId: true, title: true } },
      assignments: {
        where: { OR: [{ kind: "LESSONS", classCourse: { sourceCourseId: { not: null } } }, { kind: "QUESTION_SET", questionSet: { status: "published", visibility: { not: "private" }, autoForStudentId: null } }] },
        orderBy: { createdAt: "asc" },
        select: { kind: true, classCourseId: true, title: true, note: true, lessonIds: true, timeLimitMin: true, section: true, domains: true, groupIds: true, studentIds: true, questionSetId: true, calculator: true },
      },
    },
  });
  const copyWork = new Set(input.copyWork ?? []);
  if ([...copyWork].some((id) => !ids.includes(id))) throw new ClassError("Courses can only be copied for classes you're carrying forward.");
  if (classes.length !== ids.length) throw new ClassError("Some of those classes aren't active classes in this program.");

  const created: { id: string; name: string; joinCode: string; invited: string[]; courses: number; assignments: number }[] = [];
  await db.$transaction(async (tx) => {
    for (const c of classes) {
      const name = `${baseName(c.name)} (${semester})`.slice(0, 120);
      const fresh = await tx.class.create({ data: { programId, teacherId: c.teacherId, name, joinCode: newJoinCode(), guardianSummaries: c.guardianSummaries } });
      const groupMap = new Map<string, string>();
      for (const g of c.groups) groupMap.set(g.id, (await tx.classGroup.create({ data: { classId: fresh.id, name: g.name } })).id);
      await tx.classStaff.createMany({
        data: c.staff.map((s) => ({ classId: fresh.id, userId: s.userId, role: s.role, sections: s.sections, domains: s.domains, groupIds: s.groupIds.flatMap((g) => (groupMap.has(g) ? [groupMap.get(g)!] : [])), canManageStaff: s.canManageStaff, addedById: userId })),
      });
      let courses = 0;
      let assignments = 0;
      if (copyWork.has(c.id)) {
        const courseMap = new Map<string, string>();
        for (const cc of c.courses) courseMap.set(cc.id, (await tx.classCourse.create({ data: { classId: fresh.id, sourceCourseId: cc.sourceCourseId, title: cc.title } })).id);
        courses = courseMap.size;
        const rows = c.assignments.flatMap((a) => {
          // Only whole-class or group work; groups map onto the new class's groups.
          if (a.studentIds.length && !a.groupIds.length) return [];
          const groupIds = a.groupIds.flatMap((g) => (groupMap.has(g) ? [groupMap.get(g)!] : []));
          if (a.groupIds.length && !groupIds.length) return [];
          if (a.kind === "LESSONS" && !(a.classCourseId && courseMap.has(a.classCourseId))) return [];
          return [{ classId: fresh.id, kind: a.kind, classCourseId: a.classCourseId ? (courseMap.get(a.classCourseId) ?? null) : null, title: a.title, note: a.note, lessonIds: a.lessonIds, timeLimitMin: a.timeLimitMin, section: a.section, domains: a.domains, groupIds, studentIds: [], questionSetId: a.questionSetId, calculator: a.calculator }];
        });
        if (rows.length) await tx.assignment.createMany({ data: rows });
        assignments = rows.length;
      }
      await tx.class.update({ where: { id: c.id }, data: { archivedAt: now } });
      const emails = input.reinvite ? [...new Set(c.members.map((m) => m.user.email.toLowerCase()))] : [];
      if (emails.length) await tx.classInvite.createMany({ data: emails.map((email) => ({ classId: fresh.id, email })) });
      created.push({ id: fresh.id, name, joinCode: fresh.joinCode, invited: emails, courses, assignments });
    }
    await audit(tx, {
      programId,
      actorId: userId,
      action: "program.semester",
      targetType: "program",
      targetId: programId,
      summary: `Started ${semester}: ${classes.length} class${classes.length === 1 ? "" : "es"} carried forward${copyWork.size ? `, courses and work copied for ${copyWork.size}` : ""}${input.reinvite ? ", students re-invited" : ""}; last semester's classes archived`,
      after: { semester, from: classes.map((c) => c.id), to: created.map((c) => c.id), copied: created.map((c) => ({ courses: c.courses, assignments: c.assignments })) },
    });
  });

  if (input.reinvite) {
    const me = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
    for (const c of created) {
      for (const to of c.invited) {
        await sendEmail(classInviteMessage({ to, teacherName: me.name || "Your program admin", className: c.name, code: c.joinCode, url: `${env.APP_URL}/join/${c.joinCode}` })).catch((err) => console.warn("[rollover] invite not sent:", err instanceof Error ? err.message : err));
      }
    }
  }
  return { created: created.map(({ id, name, joinCode, invited, courses, assignments }) => ({ id, name, joinCode, invited: invited.length, courses, assignments })) };
}
