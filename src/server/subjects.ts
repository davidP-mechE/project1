import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { getCourseMastery } from "./mastery";
import { getSkills } from "./review";
import { classifySubject, isSubjectId, subjectOf, SUBJECTS, type SubjectId } from "@/lib/subjects";

/**
 * The Mastery page: how well the student knows each subject (Mathematics,
 * Physics, English & writing…), across all their courses in it.
 */

/** Detect a course's subject from its title and outline, and save it (once; the student can change it). */
export async function detectSubject(courseId: string): Promise<SubjectId> {
  const course = await db.course.findUniqueOrThrow({
    where: { id: courseId },
    select: { title: true, subject: true, units: { select: { title: true, lessons: { select: { title: true } } } } },
  });
  if (isSubjectId(course.subject)) return course.subject;
  const outline = course.units.flatMap((u) => [u.title, ...u.lessons.map((l) => l.title)]).join("\n");
  const { subject } = classifySubject(course.title, outline);
  await db.course.update({ where: { id: courseId }, data: { subject } });
  return subject;
}

export async function setCourseSubject(userId: string, courseId: string, subject: unknown) {
  if (!isSubjectId(subject)) throw new Error("Unknown subject");
  const { count } = await db.course.updateMany({ where: { id: courseId, userId }, data: { subject } });
  if (count === 0) throw new NotFoundError("Course not found");
}

export async function getSubjectMastery(userId: string, now = new Date()) {
  const courses = await db.course.findMany({
    where: { userId, archivedAt: null, status: { in: ["ACTIVE", "GENERATING"] } },
    orderBy: { title: "asc" },
    select: { id: true, title: true, subject: true, book: { select: { kind: true } } },
  });
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [masteries, skills, recent] = await Promise.all([
    Promise.all(courses.map((c) => getCourseMastery(userId, c.id))),
    getSkills(userId),
    db.questionAttempt.groupBy({ by: ["courseId", "correct"], where: { userId, createdAt: { gte: since }, courseId: { in: courses.map((c) => c.id) } }, _count: { _all: true } }),
  ]);
  const skillsByCourse = new Map(skills.map((s) => [s.id, s.skills]));
  const rows = await Promise.all(
    courses.map(async (c, i) => {
      const subject = isSubjectId(c.subject) ? c.subject : await detectSubject(c.id);
      const answered = recent.filter((r) => r.courseId === c.id).reduce((n, r) => n + r._count._all, 0);
      const right = recent.filter((r) => r.courseId === c.id && r.correct).reduce((n, r) => n + r._count._all, 0);
      const courseSkills = skillsByCourse.get(c.id) ?? [];
      return {
        id: c.id,
        title: c.title,
        kind: c.book.kind,
        subject,
        mastery: masteries[i].overall.score,
        lessons: masteries[i].overall.counts,
        answered,
        right,
        skills: { total: courseSkills.length, hammered: courseSkills.filter((s) => s.stats.status === "hammered").length },
        weakest: courseSkills.filter((s) => s.stats.status === "shaky").slice(0, 3).map((s) => ({ key: s.key, topic: s.topic, accuracy: s.stats.accuracy })),
      };
    }),
  );
  const subjects = SUBJECTS.map((s) => {
    const cs = rows.filter((r) => r.subject === s.id);
    const answered = cs.reduce((n, c) => n + c.answered, 0);
    return {
      ...s,
      courses: cs,
      mastery: cs.length ? cs.reduce((n, c) => n + c.mastery, 0) / cs.length : 0,
      accuracy: answered ? cs.reduce((n, c) => n + c.right, 0) / answered : null,
      skills: { total: cs.reduce((n, c) => n + c.skills.total, 0), hammered: cs.reduce((n, c) => n + c.skills.hammered, 0) },
    };
  }).filter((s) => s.courses.length > 0);
  subjects.sort((a, b) => b.courses.length - a.courses.length || a.name.localeCompare(b.name));
  return { subjects, courseCount: rows.length };
}

export const subjectName = (id: string | null | undefined) => subjectOf(id).name;
