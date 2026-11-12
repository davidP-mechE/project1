import "server-only";
import { allowsProgram, programAccess, programDeniedMessage, programIdFilter } from "./program-access";
import { randomInt } from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { NotFoundError } from "./courses";
import { storageKeys } from "./storage";
import { copyCourseTo, snapshotFiles } from "./course-copy";
import { rateLimit } from "./rate-limit";
import { recordUsage } from "./usage";
import { bumpActivity } from "./activity";
import { claudeGradesLastHour, studyBudget } from "./study";
import { sendEmail } from "./email";
import { classInviteMessage } from "./email/templates";
import { AiError } from "./ai/writer";
import type { Grader } from "./ai/grader";
import { RATE_RULES } from "@/lib/usage/rate-limit";
import { gradeMultipleChoice, normalizeGrade, type GradeResult } from "@/lib/grading/grade";
import { checkResponse, quickCheck } from "@/lib/grading/normalize";
import { assignmentAccess, assignmentInScope, classAccess, ClassError, memberWhere, type ClassAccess } from "./access";
import { scopeCovers, isSection, isDomain, workDomains } from "@/lib/sat/domains";
import { ensureProgramFor } from "./programs";
import { externalItemsOf } from "./external";
import { addMistakes } from "./mistakes";
import { applyRosterDetails } from "./roster";
import { assignedTo, cleanTargets, groupsByClass, isAssignedToStudent, studentsTargeted, type Targets } from "./targets";
import type { AssignmentKind, Prisma } from "@/generated/prisma/client";

export { ClassError };

/**
 * Classes: a teacher (any user) creates a class, invites students by email or
 * with a join code, and assigns work with due dates:
 *  - LESSONS: their own course, or chosen lessons from it. Each student gets
 *    their own copy of the course (like the Hub) the first time they start, so
 *    their progress, notes and answers are theirs.
 *  - QUESTIONS: questions from a worksheet the teacher uploaded
 *    (src/server/worksheets.ts), optionally filed under one of their courses
 *    and timed. Answers are checked right away (multiple choice instantly,
 *    written answers by Claude against the answer key).
 * Teachers see progress on assigned work only, never a student's own courses.
 *
 * RULE: every teacher-side function goes through classAccess() (src/server/access.ts)
 * and filters students and assignments by the caller's scope; student-side
 * functions check membership.
 */

const MAX_CLASSES = 50;
const MAX_STUDENTS = 300;
const MAX_INVITES_AT_ONCE = 60;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

export const newJoinCode = () => Array.from({ length: 7 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
const joinUrl = (code: string) => `${env.APP_URL}/join/${code}`;

// ─── Teacher: classes and students ───────────────────────────────────────

/** The class, for someone allowed to change it and its students (program admin or teacher). */
async function teacherClass(userId: string, classId: string) {
  await classAccess(userId, classId, "manageClass");
  return db.class.findUniqueOrThrow({ where: { id: classId } });
}

/**
 * A new class in one of the caller's programs (they must be its admin). Someone
 * with no program gets one, so any tutor can start.
 */
export async function createClass(userId: string, name: string, programId?: string) {
  const n = name.trim().slice(0, 120);
  if (!n) throw new ClassError("Give the class a name.");
  const program = await ensureProgramFor(userId, programId);
  const rules = await programAccess(userId);
  if (!allowsProgram(rules, program.id)) throw new ClassError(programDeniedMessage(rules), 403);
  if ((await db.class.count({ where: { programId: program.id, archivedAt: null } })) >= MAX_CLASSES) throw new ClassError(`A program can have up to ${MAX_CLASSES} classes. Archive old ones first.`);
  for (let i = 0; i < 5; i++) {
    try {
      return await db.class.create({ data: { programId: program.id, teacherId: userId, name: n, joinCode: newJoinCode(), staff: { create: { userId, role: "TEACHER", addedById: userId } } } });
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err; // code already taken: try another
    }
  }
  throw new ClassError("Couldn't create the class. Please try again.");
}

export async function updateClass(userId: string, classId: string, patch: { name?: string; archived?: boolean; newCode?: boolean }) {
  await teacherClass(userId, classId);
  const data: { name?: string; archivedAt?: Date | null; joinCode?: string } = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim().slice(0, 120);
    if (!n) throw new ClassError("Give the class a name.");
    data.name = n;
  }
  if (patch.archived !== undefined) data.archivedAt = patch.archived ? new Date() : null;
  if (patch.newCode) data.joinCode = newJoinCode();
  await db.class.update({ where: { id: classId }, data });
}

/** Classes the person is program admin or staff on, with their role in each. */
export async function listTeaching(userId: string) {
  const programId = programIdFilter(await programAccess(userId));
  const rows = await db.class.findMany({
    where: { OR: [{ program: { adminId: userId } }, { staff: { some: { userId } } }], ...(programId ? { programId } : {}) },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      joinCode: true,
      archivedAt: true,
      createdAt: true,
      program: { select: { id: true, name: true, adminId: true } },
      staff: { where: { userId }, select: { role: true } },
      _count: { select: { members: true, assignments: true } },
    },
  });
  return rows.map(({ staff, ...c }) => ({ ...c, role: (c.program.adminId === userId ? "ADMIN" : staff[0]?.role ?? "VIEWER") as ClassAccess["role"] }));
}

/** Everything the teacher's class page shows except the progress report. */
export async function getClassForTeacher(userId: string, classId: string) {
  const access = await classAccess(userId, classId);
  const c = await db.class.findFirst({
    where: { id: classId },
    include: {
      members: { where: memberWhere(access), orderBy: { joinedAt: "asc" }, select: { joinedAt: true, user: { select: { id: true, name: true, email: true } } } },
      invites: { orderBy: { createdAt: "desc" }, select: { id: true, email: true, createdAt: true } },
      assignments: {
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        select: { id: true, kind: true, title: true, note: true, dueAt: true, timeLimitMin: true, lessonIds: true, itemIds: true, createdAt: true, section: true, domains: true, classCourse: { select: { id: true, title: true } }, worksheet: { select: { id: true, title: true } } },
      },
    },
  });
  if (!c) throw new NotFoundError("Class not found");
  const manage = access.role === "ADMIN" || access.role === "TEACHER";
  return {
    ...c,
    // Viewers see names only, not contact details.
    members: access.role === "VIEWER" ? c.members.map((m) => ({ ...m, user: { ...m.user, email: "" } })) : c.members,
    invites: manage ? c.invites : [],
    assignments: c.assignments.filter((a) => assignmentInScope(access, a)),
    joinUrl: joinUrl(c.joinCode),
    access,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Invite students by email: each gets a link to join (they sign up first if they're new). */
export async function inviteStudents(userId: string, classId: string, raw: string) {
  const c = await teacherClass(userId, classId);
  const teacher = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  const emails = [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) throw new ClassError("Enter at least one email address.");
  if (emails.length > MAX_INVITES_AT_ONCE) throw new ClassError(`Invite up to ${MAX_INVITES_AT_ONCE} students at a time.`);
  const invalid = emails.filter((e) => !EMAIL.test(e) || e.length > 254);
  const valid = emails.filter((e) => !invalid.includes(e));
  const members = new Set((await db.classMember.findMany({ where: { classId, user: { email: { in: valid } } }, select: { user: { select: { email: true } } } })).map((m) => m.user.email.toLowerCase()));
  const toInvite = valid.filter((e) => !members.has(e));
  for (let i = 0; i < toInvite.length; i++) {
    const limited = await rateLimit(RATE_RULES.classInvite, userId);
    if (!limited.ok) throw new ClassError(`You've sent a lot of invitations today. ${i > 0 ? `${i} were sent; ` : ""}try the rest tomorrow, or share the class code ${c.joinCode}.`, 429);
    await db.classInvite.upsert({ where: { classId_email: { classId, email: toInvite[i] } }, create: { classId, email: toInvite[i] }, update: { createdAt: new Date() } });
    await sendEmail(classInviteMessage({ to: toInvite[i], teacherName: teacher.name || "Your teacher", className: c.name, code: c.joinCode, url: joinUrl(c.joinCode) })).catch((err) => {
      console.warn("[classes] invite email not sent:", err instanceof Error ? err.message : err);
    });
  }
  return { invited: toInvite, alreadyIn: valid.filter((e) => members.has(e)), invalid };
}

export async function cancelInvite(userId: string, classId: string, inviteId: string) {
  await teacherClass(userId, classId);
  await db.classInvite.deleteMany({ where: { id: inviteId, classId } });
}

/** Take a student out of the class. They keep their copies of courses (they're theirs now). */
export async function removeStudent(userId: string, classId: string, studentId: string) {
  await teacherClass(userId, classId);
  await db.classMember.deleteMany({ where: { classId, userId: studentId } });
}

// ─── Students: joining ───────────────────────────────────────────────────

/** What the join page shows before joining. */
export async function classByCode(code: string) {
  const c = await db.class.findUnique({ where: { joinCode: normalizeCode(code) }, select: { id: true, name: true, archivedAt: true, teacher: { select: { name: true } } } });
  return c && !c.archivedAt ? { id: c.id, name: c.name, teacherName: c.teacher.name } : null;
}

export async function joinClass(userId: string, code: string) {
  const limited = await rateLimit(RATE_RULES.classJoin, userId);
  if (!limited.ok) throw new ClassError("Too many tries. Please wait a while and check the code with your teacher.", 429);
  const c = await db.class.findUnique({ where: { joinCode: normalizeCode(code) }, select: { id: true, teacherId: true, archivedAt: true, isDemo: true, programId: true, _count: { select: { members: true } } } });
  if (!c || c.archivedAt) throw new ClassError("No class has that code. Check it with your teacher.", 404);
  const rules = await programAccess(userId);
  if (!allowsProgram(rules, c.programId)) throw new ClassError(programDeniedMessage(rules), 403);
  // Demo classes only take demo accounts, so real students never mix with demo data.
  if (c.isDemo && !(await db.user.count({ where: { id: userId, isDemo: true } }))) throw new ClassError("No class has that code. Check it with your teacher.", 404);
  const staff = await db.class.count({ where: { id: c.id, OR: [{ program: { adminId: userId } }, { staff: { some: { userId } } }] } });
  if (staff) throw new ClassError("You're on this class's staff. Open it under Teaching.");
  const already = await db.classMember.findUnique({ where: { classId_userId: { classId: c.id, userId } } });
  if (already) return c.id;
  if (c._count.members >= MAX_STUDENTS) throw new ClassError("This class is full. Ask your teacher.");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  await db.classMember.create({ data: { classId: c.id, userId } });
  // A roster import may have set their group, goal and baseline.
  await applyRosterDetails(c.id, userId, user.email);
  await db.classInvite.deleteMany({ where: { classId: c.id, email: user.email.toLowerCase() } });
  return c.id;
}

export async function leaveClass(userId: string, classId: string) {
  await db.classMember.deleteMany({ where: { classId, userId } });
}

async function membership(userId: string, classId: string) {
  const m = await db.classMember.findUnique({ where: { classId_userId: { classId, userId } }, select: { id: true, class: { select: { programId: true } } } });
  if (!m || !allowsProgram(await programAccess(userId), m.class.programId)) throw new NotFoundError("Class not found");
}

// ─── Teacher: assigning work ─────────────────────────────────────────────

/** The teacher's own courses that can be assigned, with their lessons (for the assignment form). */
export async function assignableCourses(userId: string) {
  const courses = await db.course.findMany({
    where: { userId, archivedAt: null, catalogEntryId: null, classCourseId: null, status: { in: ["ACTIVE", "GENERATING"] } },
    orderBy: { lastOpenedAt: { sort: "desc", nulls: "last" } },
    select: {
      id: true,
      title: true,
      book: { select: { kind: true } },
      units: {
        orderBy: { order: "asc" },
        select: { id: true, title: true, lessons: { where: { skip: false }, orderBy: { order: "asc" }, select: { id: true, title: true, status: true } } },
      },
    },
  });
  return courses.map((c) => ({ ...c, units: c.units.filter((u) => u.lessons.length > 0) }));
}

/** The class's entry for one of the teacher's courses (made the first time it's used in the class). */
async function classCourseFor(userId: string, classId: string, courseId: string) {
  const course = await db.course.findFirst({ where: { id: courseId, userId, catalogEntryId: null, classCourseId: null }, select: { id: true, title: true } });
  if (!course) throw new ClassError("Choose one of your own courses.");
  return db.classCourse.upsert({
    where: { classId_sourceCourseId: { classId, sourceCourseId: courseId } },
    create: { classId, sourceCourseId: courseId, title: course.title },
    update: { title: course.title },
  });
}

/** The subject an assignment covers, checked against the caller's scope. */
function subjectFor(access: ClassAccess, input: { section?: string | null; domains?: string[] }) {
  const domains = [...new Set((input.domains ?? []).filter(isDomain))];
  const section = isSection(input.section) ? input.section : null;
  const work = { section, domains };
  if (!scopeCovers(access.subjects, work)) {
    throw new ClassError(workDomains(work).length ? "That subject is outside what you cover in this class." : "Choose the subject this covers (you can only assign work in your subjects).", 403);
  }
  return work;
}

function parseDue(due: string | Date | null | undefined): Date | null {
  if (!due) return null;
  const d = due instanceof Date ? due : new Date(due);
  if (Number.isNaN(d.getTime())) throw new ClassError("That due date isn't valid.");
  return d;
}

export type LessonAssignmentInput = { courseId: string; lessonIds: string[]; title?: string; note?: string; dueAt?: string | Date | null; section?: string | null; domains?: string[]; targets?: Partial<Targets> };

/** Assign a course (no lessons chosen = the whole course), or chosen lessons from it. */
export async function assignLessons(userId: string, classId: string, input: LessonAssignmentInput) {
  const access = await classAccess(userId, classId, "teach");
  const subject = subjectFor(access, input);
  const targets = await cleanTargets(access, input.targets);
  const cc = await classCourseFor(userId, classId, input.courseId);
  const lessons = input.lessonIds.length
    ? await db.lesson.findMany({ where: { id: { in: input.lessonIds }, courseId: input.courseId, skip: false }, orderBy: [{ unit: { order: "asc" } }, { order: "asc" }], select: { id: true, title: true } })
    : [];
  if (input.lessonIds.length > 0 && lessons.length !== new Set(input.lessonIds).size) throw new ClassError("Some of those lessons aren't in this course.");
  const title =
    input.title?.trim().slice(0, 200) ||
    (lessons.length === 0 ? cc.title : lessons.length === 1 ? lessons[0].title : `${lessons[0].title} + ${lessons.length - 1} more`);
  return db.assignment.create({
    data: { classId, kind: "LESSONS", classCourseId: cc.id, title, note: input.note?.trim().slice(0, 2000) || null, lessonIds: lessons.map((l) => l.id), dueAt: parseDue(input.dueAt), ...subject, ...targets },
  });
}

export type QuestionAssignmentInput = {
  classIds: string[];
  worksheetId: string;
  itemIds: string[];
  title: string;
  courseId?: string | null;
  note?: string;
  dueAt?: string | Date | null;
  timeLimitMin?: number | null;
  /** Groups or students; only when assigning to one class. */
  targets?: Partial<Targets>;
};

/** Assign questions from a worksheet to one or more classes, optionally filed under a course and timed. */
export async function assignQuestions(userId: string, input: QuestionAssignmentInput) {
  const ws = await db.worksheet.findFirst({ where: { id: input.worksheetId, ownerId: userId, status: "READY" }, select: { id: true, title: true, source: true, items: { where: { archivedAt: null }, orderBy: { order: "asc" }, select: { id: true, section: true, domain: true, approvedAt: true } } } });
  if (!ws) throw new ClassError("Choose a worksheet that has finished reading.");
  const order = ws.items.map((i) => i.id);
  const chosen = input.itemIds.length ? order.filter((id) => input.itemIds.includes(id)) : order;
  if (chosen.length === 0) throw new ClassError("Choose at least one question.");
  if (input.itemIds.length && chosen.length !== new Set(input.itemIds).size) throw new ClassError("Some of those questions aren't on this worksheet.");
  // Questions Claude drafted reach students only after a staff member approves them.
  if (ws.source === "AI_DRAFT" && ws.items.some((i) => chosen.includes(i.id) && !i.approvedAt)) throw new ClassError("Approve these drafted questions before assigning them.");
  const classIds = [...new Set(input.classIds)];
  if (classIds.length === 0) throw new ClassError("Choose a class to assign it to.");
  const limit = input.timeLimitMin ? Math.round(input.timeLimitMin) : null;
  if (limit !== null && (limit < 1 || limit > 300)) throw new ClassError("A time limit can be 1 to 300 minutes.");
  const dueAt = parseDue(input.dueAt);
  // The subject follows the chosen questions' tags (one section; their domains).
  const tagged = ws.items.filter((i) => chosen.includes(i.id));
  const sections = new Set(tagged.map((i) => i.section));
  const subject = sections.size === 1 && !sections.has(null) && tagged.every((i) => i.domain) ? { section: [...sections][0], domains: [...new Set(tagged.map((i) => i.domain!))] } : { section: null, domains: [] };
  const created = [];
  const accesses = [];
  for (const classId of classIds) accesses.push(await classAccess(userId, classId, "teach"));
  if (classIds.length > 1 && (input.targets?.groupIds?.length || input.targets?.studentIds?.length)) throw new ClassError("Choose groups or students when assigning to one class at a time.");
  for (const access of accesses) {
    const classId = access.classId;
    const work = subjectFor(access, subject);
    const targets = await cleanTargets(access, input.targets);
    const cc = input.courseId ? await classCourseFor(userId, classId, input.courseId) : null;
    created.push(
      await db.assignment.create({
        data: {
          classId,
          kind: "QUESTIONS",
          classCourseId: cc?.id ?? null,
          title: input.title.trim().slice(0, 200) || ws.title,
          note: input.note?.trim().slice(0, 2000) || null,
          worksheetId: ws.id,
          itemIds: chosen,
          timeLimitMin: limit,
          dueAt,
          ...work,
          ...targets,
        },
      }),
    );
  }
  return created;
}

export type LogTestAssignmentInput = { testId: string; title?: string; note?: string; dueAt?: string | Date | null; targets?: Partial<Targets> };

/** "Log Practice Test N by <date>": done when the student finishes a log of that test. */
export async function assignLogTest(userId: string, classId: string, input: LogTestAssignmentInput) {
  const access = await classAccess(userId, classId, "teach");
  const test = await db.practiceTest.findFirst({ where: { id: input.testId, shared: true }, select: { id: true, name: true } });
  if (!test) throw new ClassError("Choose a test from the catalog.");
  const targets = await cleanTargets(access, input.targets);
  const dueAt = parseDue(input.dueAt);
  return db.assignment.create({
    data: { classId, kind: "LOG_TEST", practiceTestId: test.id, title: input.title?.trim().slice(0, 200) || `Log ${test.name}`, note: input.note?.trim().slice(0, 2000) || null, dueAt, ...targets },
  });
}

export type SetAssignmentInput = { setId: string; title?: string; note?: string; dueAt?: string | Date | null; timeLimitMin?: number | null; calculator?: "ALLOWED" | "BY_HAND"; targets?: Partial<Targets> };

/** A published question-bank set, played in the practice player, with the calculator allowed or by hand only. */
export async function assignQuestionSet(userId: string, classId: string, input: SetAssignmentInput) {
  const access = await classAccess(userId, classId, "teach");
  const set = await db.questionSet.findUnique({ where: { id: input.setId }, select: { id: true, title: true, status: true, visibility: true, questionIds: true } });
  if (!set || set.status !== "published" || set.visibility === "private") throw new ClassError("Choose a published set that classes can use.");
  const limit = input.timeLimitMin ? Math.round(input.timeLimitMin) : null;
  if (limit !== null && (limit < 1 || limit > 300)) throw new ClassError("A time limit can be 1 to 300 minutes.");
  const targets = await cleanTargets(access, input.targets);
  const sections = new Set((await db.bankQuestion.findMany({ where: { id: { in: set.questionIds } }, select: { section: true } })).map((q) => q.section));
  const section = sections.size === 1 ? ([...sections][0] === "math" ? "MATH" : "RW") : null;
  const work = subjectFor(access, { section, domains: [] });
  return db.assignment.create({
    data: {
      classId,
      kind: "QUESTION_SET",
      questionSetId: set.id,
      title: input.title?.trim().slice(0, 200) || set.title,
      note: input.note?.trim().slice(0, 2000) || null,
      dueAt: parseDue(input.dueAt),
      timeLimitMin: limit,
      calculator: input.calculator === "BY_HAND" ? "BY_HAND" : "ALLOWED",
      ...work,
      ...targets,
    },
  });
}

export async function updateAssignment(userId: string, assignmentId: string, patch: { title?: string; dueAt?: string | null; note?: string }) {
  await assignmentAccess(userId, assignmentId, "teach");
  const a = { id: assignmentId };
  await db.assignment.update({
    where: { id: a.id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 200) || "Assignment" } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: parseDue(patch.dueAt) } : {}),
      ...(patch.note !== undefined ? { note: patch.note.trim().slice(0, 2000) || null } : {}),
    },
  });
}

/** Delete an assignment (students' answers to it go too; their course copies stay). */
export async function deleteAssignment(userId: string, assignmentId: string) {
  await assignmentAccess(userId, assignmentId, "teach");
  await db.assignment.delete({ where: { id: assignmentId } });
}

// ─── Students: doing the work ────────────────────────────────────────────

/**
 * The student's own copy of a class course, made the first time they need it.
 * The course's files are snapshotted for the class once (again if the teacher's
 * file changes, e.g. slides were added), and shared by every student's copy.
 */
export async function ensureStudentCopy(userId: string, classCourseId: string): Promise<string> {
  const existing = await db.course.findFirst({ where: { userId, classCourseId }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (existing) return existing.id;
  let cc = await db.classCourse.findUniqueOrThrow({
    where: { id: classCourseId },
    include: { sourceCourse: { select: { id: true, subject: true, book: { select: { storageKey: true, coverKey: true, figures: { select: { storageKey: true } } } } } } },
  });
  if (!cc.sourceCourse) throw new ClassError("Your teacher has deleted this course, so it can't be opened any more.", 410);
  if (!cc.fileKey || cc.snapshotOf !== cc.sourceCourse.book.storageKey) {
    const files = await snapshotFiles(cc.sourceCourse.book, storageKeys.classCoursePrefix(cc.id, Date.now()));
    cc = await db.classCourse.update({ where: { id: cc.id }, data: { ...files, snapshotOf: cc.sourceCourse.book.storageKey }, include: { sourceCourse: { select: { id: true, subject: true, book: { select: { storageKey: true, coverKey: true, figures: { select: { storageKey: true } } } } } } } });
  }
  return copyCourseTo(userId, cc.sourceCourse!.id, { fileKey: cc.fileKey!, coverKey: cc.coverKey, figuresPrefix: cc.figuresPrefix! }, { classCourseId: cc.id, subject: cc.sourceCourse!.subject });
}

async function studentAssignment(userId: string, assignmentId: string) {
  const a = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: { class: { select: { id: true, name: true, archivedAt: true, teacher: { select: { name: true } } } }, classCourse: { select: { id: true, title: true, sourceCourseId: true } } },
  });
  if (!a) throw new NotFoundError("Assignment not found");
  await membership(userId, a.classId);
  if (!(await isAssignedToStudent(a, userId))) throw new NotFoundError("Assignment not found");
  return a;
}

/** Open a lessons assignment: make the student's copy if needed and pick where to start. */
export async function startLessons(userId: string, assignmentId: string): Promise<{ courseId: string; lessonId: string | null }> {
  const a = await studentAssignment(userId, assignmentId);
  if (a.kind !== "LESSONS" || !a.classCourse) throw new ClassError("This assignment has no lessons.");
  const courseId = await ensureStudentCopy(userId, a.classCourse.id);
  const lessons = await db.lesson.findMany({
    where: { courseId, skip: false, ...(a.lessonIds.length ? { sourceLessonId: { in: a.lessonIds } } : {}) },
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    select: { id: true, progress: { where: { userId }, select: { completedAt: true } } },
  });
  const next = lessons.find((l) => !l.progress[0]?.completedAt) ?? lessons[0];
  return { courseId, lessonId: next?.id ?? null };
}

type ItemForGrading = { id: string; type: "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "STEP_BY_STEP"; prompt: string; choices: string[]; correctChoice: number | null; answer: string; explanation: string; steps: string[]; topic: string; version: number };

/** Clock for a timed set: when it ends, and whether answers are still taken. */
function timing(a: { timeLimitMin: number | null }, start: { startedAt: Date; submittedAt: Date | null } | null, now: Date) {
  const endsAt = a.timeLimitMin && start ? new Date(start.startedAt.getTime() + a.timeLimitMin * 60_000) : null;
  const handedIn = Boolean(start?.submittedAt) || (endsAt !== null && now >= endsAt);
  return { endsAt, handedIn, started: Boolean(start) };
}

/** A question set for a student: the questions (no answers until they've answered or handed in), their answers, the clock. */
export async function getQuestionAssignment(userId: string, assignmentId: string, now = new Date()) {
  const a = await studentAssignment(userId, assignmentId);
  if (a.kind !== "QUESTIONS") throw new ClassError("This assignment has no questions.");
  const [items, answers, start] = await Promise.all([
    db.worksheetItem.findMany({ where: { id: { in: a.itemIds } } }),
    db.assignmentAnswer.findMany({ where: { assignmentId, userId }, orderBy: { createdAt: "asc" } }),
    db.assignmentStart.findUnique({ where: { assignmentId_userId: { assignmentId, userId } } }),
  ]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const latest = new Map(answers.map((x) => [x.itemId, x]));
  const t = timing(a, start, now);
  const timed = Boolean(a.timeLimitMin);
  // Timed sets show results after handing in; untimed ones right away (and can be retried).
  const reveal = !timed || t.handedIn;
  const questions = a.itemIds
    .map((id) => byId.get(id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .map((i, n) => {
      const mine = latest.get(i.id);
      const showKey = reveal && Boolean(mine);
      return {
        id: i.id,
        number: n + 1,
        label: i.label,
        type: i.type,
        prompt: i.prompt,
        choices: i.choices,
        topic: i.topic,
        answer: showKey ? { correctChoice: i.correctChoice, answer: i.answer, explanation: i.explanation, steps: i.steps } : null,
        mine: mine
          ? { choice: mine.choice, response: mine.response ?? "", ...(reveal ? { correct: mine.correct, score: mine.score, verdict: mine.verdict, feedback: mine.feedback, gradedBy: mine.gradedBy } : {}) }
          : null,
      };
    });
  const answered = questions.filter((q) => q.mine).length;
  const score = reveal ? questions.reduce((n, q) => n + (q.mine && "score" in q.mine ? (q.mine.score as number) : 0), 0) : null;
  return {
    id: a.id,
    title: a.title,
    note: a.note,
    dueAt: a.dueAt,
    className: a.class.name,
    classId: a.class.id,
    course: a.classCourse ? { id: a.classCourse.id, title: a.classCourse.title } : null,
    timeLimitMin: a.timeLimitMin,
    started: t.started,
    endsAt: t.endsAt,
    handedIn: t.handedIn,
    reveal,
    questions,
    answered,
    score,
  };
}

/** Start the clock on a timed set (once). */
export async function startQuestions(userId: string, assignmentId: string) {
  await studentAssignment(userId, assignmentId);
  await db.assignmentStart.upsert({ where: { assignmentId_userId: { assignmentId, userId } }, create: { assignmentId, userId }, update: {} });
}

/** Hand in a set: a timed one locks and shows results; an untimed one is marked done. */
export async function handIn(userId: string, assignmentId: string) {
  await studentAssignment(userId, assignmentId);
  await db.assignmentStart.upsert({
    where: { assignmentId_userId: { assignmentId, userId } },
    create: { assignmentId, userId, submittedAt: new Date() },
    update: { submittedAt: new Date() },
  });
}

/** Check one answer to a question in a set and save it (the latest answer counts). */
export async function answerQuestion(
  userId: string,
  assignmentId: string,
  itemId: string,
  input: { choice?: unknown; response?: unknown },
  deps: { grader: Grader | null },
  now = new Date(),
) {
  const a = await studentAssignment(userId, assignmentId);
  if (a.kind !== "QUESTIONS" || !a.itemIds.includes(itemId)) throw new NotFoundError("Question not found");
  const start = await db.assignmentStart.findUnique({ where: { assignmentId_userId: { assignmentId, userId } } });
  const t = timing(a, start, now);
  if (a.timeLimitMin && !t.started) throw new ClassError("Start the timer first.");
  if (a.timeLimitMin && t.handedIn) throw new ClassError("Time's up: this set has been handed in.", 409);
  if (!a.timeLimitMin && start?.submittedAt) throw new ClassError("You've handed this in already.", 409);
  const item = (await db.worksheetItem.findUnique({ where: { id: itemId } })) as ItemForGrading | null;
  if (!item) throw new NotFoundError("Question not found");

  const g = await gradeItem(userId, item, input, deps);
  await db.assignmentAnswer.create({
    data: { assignmentId, itemId, userId, choice: g.choice, response: g.response, correct: g.result.correct, score: g.result.score, verdict: g.result.verdict, feedback: g.result.feedback, gradedBy: g.gradedBy, itemVersion: item.version },
  });
  await bumpActivity(userId, { questionsAnswered: 1, questionsCorrect: g.result.correct ? 1 : 0 });
  // Wrong answers go into the mistake log (unchecked ones, with no grader, don't).
  if (!g.result.correct && g.gradedBy !== "NONE") {
    const tags = await db.worksheetItem.findUniqueOrThrow({ where: { id: itemId }, select: { label: true, section: true, domain: true, skill: true } });
    await addMistakes(userId, [{ sourceType: "ASSIGNMENT", sourceId: `${assignmentId}:${itemId}`, itemId, section: tags.section, domain: tags.domain, skill: tags.skill, label: `${a.title}: question ${tags.label}` }], now);
  }
  // In a timed set the result stays hidden until it's handed in.
  return a.timeLimitMin ? { saved: true as const } : { saved: true as const, ...g.result, gradedBy: g.gradedBy, answer: { correctChoice: item.correctChoice, answer: item.answer, explanation: item.explanation, steps: item.steps } };
}

async function gradeItem(userId: string, item: ItemForGrading, input: { choice?: unknown; response?: unknown }, deps: { grader: Grader | null }) {
  if (item.type === "MULTIPLE_CHOICE") {
    const r = gradeMultipleChoice(item, input.choice);
    if ("error" in r) throw new ClassError(r.error);
    return { result: r, gradedBy: "LOCAL", choice: input.choice as number, response: null as string | null };
  }
  const checked = checkResponse(input.response);
  if (!checked.ok) throw new ClassError(checked.error);
  const response = checked.text;
  if (quickCheck(item.answer, response) === "correct") {
    return { result: { verdict: "CORRECT", correct: true, score: 1, feedback: "Correct!" } as GradeResult, gradedBy: "LOCAL", choice: null, response };
  }
  if (!deps.grader) {
    // No Claude on this server: save it for the teacher to look at, marked as not checked.
    return { result: { verdict: "INCORRECT", correct: false, score: 0, feedback: "Saved. It couldn't be checked automatically; compare it with the answer." } as GradeResult, gradedBy: "NONE", choice: null, response };
  }
  if ((await claudeGradesLastHour(userId)) >= env.GRADING_PER_HOUR) {
    throw new ClassError(`You've had ${env.GRADING_PER_HOUR} answers checked in the last hour, the hourly limit. Please try again a bit later.`, 429);
  }
  await studyBudget(userId);
  const usage = { userId, feature: "GRADING" as const };
  try {
    const graded = await deps.grader.grade({ type: item.type, prompt: item.prompt, answer: item.answer, explanation: item.explanation, steps: item.steps, response, pages: [] });
    await recordUsage(usage, graded.calls);
    return { result: normalizeGrade(graded.value), gradedBy: deps.grader.kind === "demo" ? "DEMO" : "CLAUDE", choice: null, response };
  } catch (err) {
    if (err instanceof AiError) {
      await recordUsage(usage, err.calls);
      throw new ClassError(err.userMessage, err.kind === "retryable" ? 503 : 502);
    }
    throw err;
  }
}

// ─── Progress ────────────────────────────────────────────────────────────

export type CellStatus = "not_started" | "in_progress" | "done" | "not_assigned";
export type Cell = { status: CellStatus; done: number; total: number; score: number | null; late: boolean; lastActive: Date | null };

type AssignmentRow = { id: string; kind: AssignmentKind; dueAt: Date | null; timeLimitMin: number | null; lessonIds: string[]; itemIds: string[]; classCourseId: string | null; externalItems?: Prisma.JsonValue; practiceTestId?: string | null; questionSetId?: string | null };

/** Every student's progress on every assignment of a class (students × assignments). */
async function progressCells(classId: string, students: string[], assignments: AssignmentRow[], now: Date) {
  const cells = new Map<string, Cell>(); // `${studentId}:${assignmentId}`
  const classCourseIds = [...new Set(assignments.flatMap((a) => (a.kind === "LESSONS" && a.classCourseId ? [a.classCourseId] : [])))];
  const externalIds = assignments.filter((a) => a.kind === "EXTERNAL").map((a) => a.id);
  const diagnosticIds = assignments.filter((a) => a.kind === "DIAGNOSTIC").map((a) => a.id);
  const [copies, answers, starts, external, attempts] = await Promise.all([
    classCourseIds.length
      ? db.course.findMany({
          where: { userId: { in: students }, classCourseId: { in: classCourseIds } },
          select: {
            userId: true,
            classCourseId: true,
            lessons: { where: { skip: false }, select: { sourceLessonId: true, progress: { select: { userId: true, completedAt: true, lastViewedAt: true } } } },
          },
        })
      : [],
    db.assignmentAnswer.findMany({ where: { assignment: { classId }, userId: { in: students } }, orderBy: { createdAt: "asc" }, select: { assignmentId: true, userId: true, itemId: true, score: true, createdAt: true } }),
    db.assignmentStart.findMany({ where: { assignment: { classId }, userId: { in: students } }, select: { assignmentId: true, userId: true, startedAt: true, submittedAt: true } }),
    externalIds.length ? db.externalResult.findMany({ where: { assignmentId: { in: externalIds }, userId: { in: students } }, select: { assignmentId: true, userId: true, itemKey: true, result: true, createdAt: true } }) : [],
    diagnosticIds.length ? db.diagnosticAttempt.findMany({ where: { assignmentId: { in: diagnosticIds }, userId: { in: students } }, orderBy: { attemptNo: "asc" }, select: { assignmentId: true, userId: true, startedAt: true, finishedAt: true, results: true } }) : [],
  ]);
  const testIds = [...new Set(assignments.flatMap((a) => (a.kind === "LOG_TEST" && a.practiceTestId ? [a.practiceTestId] : [])))];
  const setAssignmentIds = assignments.filter((a) => a.kind === "QUESTION_SET").map((a) => a.id);
  const [logs, sittings, setSizes] = await Promise.all([
    testIds.length ? db.testAttempt.findMany({ where: { userId: { in: students }, testId: { in: testIds } }, select: { userId: true, testId: true, status: true, completedAt: true, updatedAt: true } }) : [],
    setAssignmentIds.length
      ? db.practiceSession.findMany({ where: { assignmentId: { in: setAssignmentIds }, userId: { in: students } }, select: { assignmentId: true, userId: true, startedAt: true, finishedAt: true, attempts: { select: { correct: true, createdAt: true } } } })
      : [],
    setAssignmentIds.length ? db.assignment.findMany({ where: { id: { in: setAssignmentIds } }, select: { id: true, questionSet: { select: { questionIds: true } } } }) : [],
  ]);
  const setSize = new Map(setSizes.map((x) => [x.id, x.questionSet?.questionIds.length ?? 0]));
  const attemptOf = new Map(attempts.map((x) => [`${x.userId}:${x.assignmentId}`, x])); // the latest attempt wins
  const externalOf = new Map<string, typeof external>();
  for (const r of external) externalOf.set(`${r.userId}:${r.assignmentId}`, [...(externalOf.get(`${r.userId}:${r.assignmentId}`) ?? []), r]);
  const copyOf = new Map(copies.map((c) => [`${c.userId}:${c.classCourseId}`, c]));
  const latest = new Map<string, { score: number; at: Date }>(); // `${user}:${assignment}:${item}`
  for (const x of answers) latest.set(`${x.userId}:${x.assignmentId}:${x.itemId}`, { score: x.score, at: x.createdAt });
  const startOf = new Map(starts.map((s) => [`${s.userId}:${s.assignmentId}`, s]));

  for (const studentId of students) {
    for (const a of assignments) {
      let cell: Cell;
      if (a.kind === "DIAGNOSTIC") {
        const at = attemptOf.get(`${studentId}:${a.id}`);
        const res = at?.results as { sections?: { correct: number; total: number }[] } | null | undefined;
        const right = res?.sections?.reduce((n, x) => n + x.correct, 0) ?? 0;
        const total = res?.sections?.reduce((n, x) => n + x.total, 0) ?? 0;
        cell = {
          status: at?.finishedAt ? "done" : at ? "in_progress" : "not_started",
          done: at?.finishedAt ? 1 : 0,
          total: 1,
          score: at?.finishedAt && total ? right / total : null,
          late: Boolean(a.dueAt && (at?.finishedAt ? at.finishedAt > a.dueAt : now > a.dueAt)),
          lastActive: at?.finishedAt ?? at?.startedAt ?? null,
        };
      } else if (a.kind === "EXTERNAL") {
        const keys = new Set(externalItemsOf({ externalItems: a.externalItems ?? [] }).map((i) => i.key));
        const got = (externalOf.get(`${studentId}:${a.id}`) ?? []).filter((r) => keys.has(r.itemKey));
        const last = got.reduce<Date | null>((m, r) => (!m || r.createdAt > m ? r.createdAt : m), null);
        const finished = keys.size > 0 && got.length >= keys.size;
        cell = {
          status: finished ? "done" : got.length ? "in_progress" : "not_started",
          done: got.length,
          total: keys.size,
          score: got.length ? got.filter((r) => r.result === "CORRECT").length / keys.size : null,
          late: Boolean(a.dueAt && (finished ? (last ?? now) > a.dueAt : now > a.dueAt)),
          lastActive: last,
        };
      } else if (a.kind === "LOG_TEST") {
        const mine = logs.filter((l) => l.userId === studentId && l.testId === a.practiceTestId);
        const done = mine.filter((l) => l.status === "complete" && l.completedAt).sort((x, y) => x.completedAt!.getTime() - y.completedAt!.getTime())[0];
        const last = mine.reduce<Date | null>((m, l) => (!m || l.updatedAt > m ? l.updatedAt : m), null);
        cell = { status: done ? "done" : mine.length ? "in_progress" : "not_started", done: done ? 1 : 0, total: 1, score: null, late: Boolean(a.dueAt && (done ? done.completedAt! > a.dueAt : now > a.dueAt)), lastActive: last };
      } else if (a.kind === "QUESTION_SET") {
        const mine = sittings.filter((x) => x.userId === studentId && x.assignmentId === a.id);
        const total = setSize.get(a.id) ?? 0;
        const best = mine.reduce<{ right: number; answered: number; finishedAt: Date | null } | null>((m, x) => {
          const right = x.attempts.filter((t) => t.correct).length;
          return !m || right > m.right ? { right, answered: x.attempts.length, finishedAt: x.finishedAt } : m;
        }, null);
        const finished = mine.find((x) => x.finishedAt);
        const last = mine.flatMap((x) => [x.startedAt, ...x.attempts.map((t) => t.createdAt)]).reduce<Date | null>((m, d) => (!m || d > m ? d : m), null);
        cell = {
          status: finished ? "done" : mine.length ? "in_progress" : "not_started",
          done: best?.answered ?? 0,
          total,
          score: best && total ? best.right / total : null,
          late: Boolean(a.dueAt && (finished ? finished.finishedAt! > a.dueAt : now > a.dueAt)),
          lastActive: last,
        };
      } else if (a.kind === "LESSONS") {
        const copy = a.classCourseId ? copyOf.get(`${studentId}:${a.classCourseId}`) : undefined;
        const lessons = copy ? copy.lessons.filter((l) => (a.lessonIds.length ? a.lessonIds.includes(l.sourceLessonId ?? "") : true)) : [];
        const total = a.lessonIds.length || lessons.length;
        const progress = lessons.map((l) => l.progress.find((p) => p.userId === studentId));
        const done = progress.filter((p) => p?.completedAt).length;
        const last = progress.reduce<Date | null>((m, p) => (p && (!m || p.lastViewedAt > m) ? p.lastViewedAt : m), null);
        const finished = total > 0 && done >= total;
        const finishedAt = finished ? progress.reduce<Date | null>((m, p) => (p?.completedAt && (!m || p.completedAt > m) ? p.completedAt : m), null) : null;
        cell = { status: finished ? "done" : last ? "in_progress" : "not_started", done, total, score: null, late: Boolean(a.dueAt && (finishedAt ? finishedAt > a.dueAt : now > a.dueAt)), lastActive: last };
      } else {
        const got = a.itemIds.map((id) => latest.get(`${studentId}:${a.id}:${id}`));
        const answered = got.filter(Boolean).length;
        const start = startOf.get(`${studentId}:${a.id}`);
        const timedOut = a.timeLimitMin && start ? now.getTime() >= start.startedAt.getTime() + a.timeLimitMin * 60_000 : false;
        const finished = Boolean(start?.submittedAt) || timedOut || (!a.timeLimitMin && answered === a.itemIds.length && a.itemIds.length > 0);
        const last = got.reduce<Date | null>((m, g) => (g && (!m || g.at > m) ? g.at : m), start?.startedAt ?? null);
        const doneAt = start?.submittedAt ?? last;
        cell = {
          status: finished ? "done" : answered > 0 || start ? "in_progress" : "not_started",
          done: answered,
          total: a.itemIds.length,
          score: answered > 0 ? got.reduce((n, g) => n + (g?.score ?? 0), 0) / a.itemIds.length : null,
          late: Boolean(a.dueAt && (finished ? (doneAt ?? now) > a.dueAt : now > a.dueAt)),
          lastActive: last,
        };
      }
      cells.set(`${studentId}:${a.id}`, cell);
    }
  }
  return cells;
}

/** The teacher's grid: every student × every assignment, with class averages. */
export async function classProgress(userId: string, classId: string, now = new Date()) {
  const access = await classAccess(userId, classId);
  const c = await db.class.findFirstOrThrow({
    where: { id: classId },
    select: {
      members: { where: memberWhere(access), orderBy: { user: { name: "asc" } }, select: { user: { select: { id: true, name: true, email: true } } } },
      assignments: {
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        select: { id: true, kind: true, title: true, dueAt: true, timeLimitMin: true, lessonIds: true, itemIds: true, classCourseId: true, section: true, domains: true, externalItems: true, groupIds: true, studentIds: true, practiceTestId: true, questionSetId: true, calculator: true, classCourse: { select: { title: true } } },
      },
    },
  });
  const students = c.members.map((m) => m.user);
  const assignments = c.assignments.filter((a) => assignmentInScope(access, a));
  const cells = await progressCells(classId, students.map((s) => s.id), assignments, now);
  for (const a of assignments) {
    const forThem = await studentsTargeted({ ...a, classId }, students.map((s) => s.id));
    for (const st of students) if (!forThem.has(st.id)) cells.set(`${st.id}:${a.id}`, { status: "not_assigned", done: 0, total: 0, score: null, late: false, lastActive: null });
  }
  const summary = assignments.map((a) => {
    const row = students.map((s) => cells.get(`${s.id}:${a.id}`)!).filter((x) => x.status !== "not_assigned");
    const scored = row.filter((x) => x.score !== null);
    return {
      id: a.id,
      done: row.filter((x) => x.status === "done").length,
      average: scored.length ? scored.reduce((n, x) => n + x.score!, 0) / scored.length : null,
    };
  });
  return { students, assignments, cells: Object.fromEntries(cells), summary, access };
}

/** One assignment in detail: each student's result, and for question sets, how the class did on each question. */
export async function assignmentReport(userId: string, assignmentId: string, now = new Date()) {
  const access = await assignmentAccess(userId, assignmentId);
  const a = await db.assignment.findUniqueOrThrow({
    where: { id: assignmentId },
    include: { class: { select: { id: true, name: true, members: { where: memberWhere(access), orderBy: { user: { name: "asc" } }, select: { user: { select: { id: true, name: true, email: true } } } } } }, classCourse: { select: { id: true, title: true } }, worksheet: { select: { id: true, title: true } } },
  });
  const forThem = await studentsTargeted(a, a.class.members.map((m) => m.user.id));
  const students = a.class.members.map((m) => m.user).filter((u) => forThem.has(u.id));
  const cells = await progressCells(a.classId, students.map((s) => s.id), [a], now);
  const rows = students.map((s) => ({ student: s, ...cells.get(`${s.id}:${a.id}`)! }));

  let questions: {
    id: string;
    label: string;
    prompt: string;
    type: string;
    topic: string;
    choices: string[];
    correctChoice: number | null;
    answer: string;
    answerSource: string;
    version: number;
    /** Latest answers given to an earlier version of the question (their grades are kept until re-graded). */
    olderAnswers: number;
    answered: number;
    correctRate: number | null;
    choiceCounts: number[];
    answers: { studentId: string; choice: number | null; response: string | null; correct: boolean; score: number; feedback: string }[];
  }[] = [];
  if (a.kind === "QUESTIONS") {
    const items = await db.worksheetItem.findMany({ where: { id: { in: a.itemIds } } });
    const answers = await db.assignmentAnswer.findMany({ where: { assignmentId: a.id }, orderBy: { createdAt: "asc" } });
    const latest = new Map<string, (typeof answers)[number]>();
    for (const x of answers) latest.set(`${x.userId}:${x.itemId}`, x);
    const byId = new Map(items.map((i) => [i.id, i]));
    questions = a.itemIds.flatMap((id) => {
      const i = byId.get(id);
      if (!i) return [];
      const got = students.map((s) => latest.get(`${s.id}:${i.id}`)).filter((x): x is NonNullable<typeof x> => Boolean(x));
      const choiceCounts = i.choices.map((_, k) => got.filter((g) => g.choice === k).length);
      return [
        {
          id: i.id,
          label: i.label,
          prompt: i.prompt,
          type: i.type,
          topic: i.topic,
          choices: i.choices,
          correctChoice: i.correctChoice,
          answer: i.answer,
          answerSource: i.answerSource,
          version: i.version,
          olderAnswers: got.filter((g) => g.itemVersion < i.version).length,
          answered: got.length,
          correctRate: got.length ? got.reduce((n, g) => n + g.score, 0) / got.length : null,
          choiceCounts,
          answers: got.map((g) => ({ studentId: g.userId, choice: g.choice, response: g.response, correct: g.correct, score: g.score, feedback: g.feedback })),
        },
      ];
    });
  }
  // College Board questions (by link): how the class did on each.
  let external: { key: string; questionId: string; url: string; domain: string; correct: number; incorrect: number; skipped: number; results: { studentId: string; result: string; reason: string | null }[] }[] = [];
  if (a.kind === "EXTERNAL") {
    const results = await db.externalResult.findMany({ where: { assignmentId: a.id, userId: { in: students.map((s) => s.id) } } });
    external = externalItemsOf(a).map((i) => {
      const got = results.filter((r) => r.itemKey === i.key);
      return {
        key: i.key,
        questionId: i.questionId,
        url: i.url,
        domain: i.domain,
        correct: got.filter((r) => r.result === "CORRECT").length,
        incorrect: got.filter((r) => r.result === "INCORRECT").length,
        skipped: got.filter((r) => r.result === "SKIPPED").length,
        results: got.map((r) => ({ studentId: r.userId, result: r.result, reason: r.reason })),
      };
    });
  }
  return { assignment: a, students: rows, questions, external, access };
}

/** How the class does on each skill (worksheet question topics), overall and per student: who needs help with what. */
export async function skillsReport(userId: string, classId: string) {
  const access = await classAccess(userId, classId);
  const c = await db.class.findFirstOrThrow({ where: { id: classId }, select: { members: { where: memberWhere(access), select: { user: { select: { id: true, name: true } } } } } });
  const answers = await db.assignmentAnswer.findMany({
    where: { assignment: { classId }, userId: { in: c.members.map((m) => m.user.id) } },
    orderBy: { createdAt: "asc" },
    select: { userId: true, assignmentId: true, itemId: true, score: true, assignment: { select: { section: true, domains: true } }, item: { select: { topic: true, skill: true, section: true, domain: true } } },
  });
  const latest = new Map<string, { userId: string; topic: string; score: number }>();
  for (const x of answers) {
    if (!assignmentInScope(access, x.assignment)) continue;
    // A tagged question outside the caller's subjects is skipped even inside a mixed assignment.
    if (x.item.domain && !scopeCovers(access.subjects, { section: x.item.section, domains: [x.item.domain] })) continue;
    latest.set(`${x.userId}:${x.assignmentId}:${x.itemId}`, { userId: x.userId, topic: x.item.skill ?? x.item.topic, score: x.score });
  }
  const topics = new Map<string, { n: number; sum: number; byStudent: Map<string, { n: number; sum: number }> }>();
  for (const x of latest.values()) {
    const t = topics.get(x.topic) ?? { n: 0, sum: 0, byStudent: new Map() };
    t.n += 1;
    t.sum += x.score;
    const s = t.byStudent.get(x.userId) ?? { n: 0, sum: 0 };
    s.n += 1;
    s.sum += x.score;
    t.byStudent.set(x.userId, s);
    topics.set(x.topic, t);
  }
  const names = new Map(c.members.map((m) => [m.user.id, m.user.name]));
  return [...topics.entries()]
    .map(([topic, t]) => ({
      topic,
      answers: t.n,
      accuracy: t.sum / t.n,
      // Students below 60% on this skill (with at least 2 answers), weakest first.
      struggling: [...t.byStudent.entries()]
        .filter(([, s]) => s.n >= 2 && s.sum / s.n < 0.6)
        .sort((x, y) => x[1].sum / x[1].n - y[1].sum / y[1].n)
        .map(([id, s]) => ({ id, name: names.get(id) ?? "Student", accuracy: s.sum / s.n })),
    }))
    .sort((x, y) => x.accuracy - y.accuracy);
}

/** The student's classes and assignments, with their own status on each. */
export async function myClasses(userId: string, now = new Date()) {
  const programId = programIdFilter(await programAccess(userId));
  const memberships = await db.classMember.findMany({
    where: { userId, class: { archivedAt: null, ...(programId ? { programId } : {}) } },
    orderBy: { joinedAt: "asc" },
    select: {
      class: {
        select: {
          id: true,
          name: true,
          teacher: { select: { name: true } },
          program: { select: { name: true, badge: true } },
          assignments: {
            orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
            select: { id: true, kind: true, title: true, note: true, dueAt: true, timeLimitMin: true, lessonIds: true, itemIds: true, classCourseId: true, externalItems: true, groupIds: true, studentIds: true, practiceTestId: true, questionSetId: true, calculator: true, classCourse: { select: { title: true } } },
          },
        },
      },
    },
  });
  const out = [];
  const groups = await groupsByClass(userId);
  for (const { class: full } of memberships) {
    // Only work assigned to this student (the whole class, their groups, or them).
    const c = { ...full, assignments: full.assignments.filter((a) => assignedTo(a, userId, groups.get(full.id) ?? new Set())) };
    const cells = await progressCells(c.id, [userId], c.assignments, now);
    out.push({
      id: c.id,
      name: c.name,
      teacherName: c.teacher.name,
      program: c.program,
      assignments: c.assignments.map((a) => ({ ...a, cell: cells.get(`${userId}:${a.id}`)! })),
    });
  }
  return out;
}

/** For the dashboard: unfinished assignments, soonest due first. */
export async function dueAssignments(userId: string, now = new Date(), limit = 5) {
  const classes = await myClasses(userId, now);
  return classes
    .flatMap((c) => c.assignments.filter((a) => a.cell.status !== "done").map((a) => ({ ...a, className: c.name, classId: c.id })))
    .sort((x, y) => (x.dueAt?.getTime() ?? Infinity) - (y.dueAt?.getTime() ?? Infinity))
    .slice(0, limit);
}

/** Assignments a student has under one of their class course copies (shown on that course's page). */
export async function assignmentsForCopy(userId: string, courseId: string) {
  const course = await db.course.findFirst({ where: { id: courseId, userId }, select: { classCourseId: true } });
  if (!course?.classCourseId) return [];
  const rows = await db.assignment.findMany({
    where: { classCourseId: course.classCourseId, class: { members: { some: { userId } }, archivedAt: null } },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
    select: { id: true, kind: true, title: true, dueAt: true, classId: true, groupIds: true, studentIds: true },
  });
  const groups = await groupsByClass(userId);
  return rows.filter((a) => assignedTo(a, userId, groups.get(a.classId) ?? new Set()));
}

/** Whether a class course's snapshot files are still needed (for cleanup tools; nothing deletes them automatically). */
export async function classCourseInUse(classCourseId: string) {
  return (await db.course.count({ where: { classCourseId } })) > 0;
}
