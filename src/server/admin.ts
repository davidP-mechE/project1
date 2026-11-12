import "server-only";
import { notFound } from "next/navigation";
import { db } from "./db";
import { getSession } from "./session";
import { isSiteAdminRole } from "./roles";
import { periodStart } from "@/lib/usage/limits";
import { limitsForPlan } from "./limits";
import { retryProcessing } from "./courses";
import { startGeneration } from "./generation/lessons";
import { regenerateAssessment } from "./generation/assessments";

/**
 * The admin page's data and actions. Only for users whose role is ADMIN (or OWNER) in the
 * database (checked on every call, not from the session cookie, so removing
 * the role takes effect at once). Everyone else gets a plain 404.
 */

export async function requireAdmin() {
  const session = await getSession();
  if (!session) notFound();
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true, role: true } });
  if (!isSiteAdminRole(user?.role)) notFound();
  return user;
}

const daysAgo = (n: number, now: Date) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
/** Students with any study activity (minutes, reviews, answers, lessons) on a day since then. Days are local dates, so allow one day of slack. */
const activeSince = (since: Date) =>
  db.studyDay
    .findMany({ where: { day: { gte: new Date(since.getTime() - 86_400_000).toISOString().slice(0, 10) } }, distinct: ["userId"], select: { userId: true } })
    .then((r) => r.length);
const usd = (micro: number | null | undefined) => (micro ?? 0) / 1_000_000;

export async function getOverview(now = new Date()) {
  const week = daysAgo(7, now);
  const month = daysAgo(30, now);
  const [users, verified, new7, new30, active7, active30, books, failedBooks, courses, lessonsReady, spend30, spendMonth] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { emailVerified: true } }),
    db.user.count({ where: { createdAt: { gte: week } } }),
    db.user.count({ where: { createdAt: { gte: month } } }),
    activeSince(week),
    activeSince(month),
    db.book.count({ where: { status: { not: "AWAITING_UPLOAD" } } }),
    db.book.count({ where: { status: "FAILED" } }),
    db.course.count(),
    db.lesson.count({ where: { status: "READY" } }),
    db.usageEvent.aggregate({ where: { createdAt: { gte: month } }, _sum: { costMicroUsd: true } }),
    db.usageEvent.aggregate({ where: { createdAt: { gte: periodStart(now) } }, _sum: { costMicroUsd: true } }),
  ]);
  return {
    users,
    verified,
    new7,
    new30,
    active7,
    active30,
    books,
    failedBooks,
    courses,
    lessonsReady,
    spend30: usd(spend30._sum.costMicroUsd),
    spendMonth: usd(spendMonth._sum.costMicroUsd),
  };
}

/** Claude API spend over the last 30 days: by feature, by model, by day, and the top users. */
export async function getAiSpend(now = new Date()) {
  const since = daysAgo(30, now);
  const where = { createdAt: { gte: since } };
  const [byFeature, byModel, byUser, daily] = await Promise.all([
    db.usageEvent.groupBy({ by: ["feature"], where, _sum: { costMicroUsd: true, inputTokens: true, outputTokens: true }, _count: { _all: true } }),
    db.usageEvent.groupBy({ by: ["model"], where, _sum: { costMicroUsd: true }, _count: { _all: true } }),
    db.usageEvent.groupBy({ by: ["userId"], where, _sum: { costMicroUsd: true }, orderBy: { _sum: { costMicroUsd: "desc" } }, take: 10 }),
    db.$queryRaw<{ day: string; micro: bigint }[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, SUM("costMicroUsd")::bigint AS micro
      FROM "UsageEvent" WHERE "createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1`,
  ]);
  const users = await db.user.findMany({ where: { id: { in: byUser.map((u) => u.userId) } }, select: { id: true, email: true, plan: true } });
  const emailOf = new Map(users.map((u) => [u.id, u]));
  return {
    byFeature: byFeature
      .map((f) => ({
        feature: f.feature,
        calls: f._count._all,
        usd: usd(f._sum.costMicroUsd),
        inputTokens: f._sum.inputTokens ?? 0,
        outputTokens: f._sum.outputTokens ?? 0,
      }))
      .sort((a, b) => b.usd - a.usd),
    byModel: byModel.map((m) => ({ model: m.model, calls: m._count._all, usd: usd(m._sum.costMicroUsd) })).sort((a, b) => b.usd - a.usd),
    topUsers: byUser.map((u) => ({
      userId: u.userId,
      email: emailOf.get(u.userId)?.email ?? "(deleted account)",
      plan: emailOf.get(u.userId)?.plan ?? null,
      usd: usd(u._sum.costMicroUsd),
    })),
    daily: daily.map((d) => ({ day: d.day, usd: Number(d.micro) / 1_000_000 })),
  };
}

/** How much each feature was used in the last 30 days (from the feature's own tables, plus AnalyticsEvent). */
export async function getFeatureUsage(now = new Date()) {
  const since = daysAgo(30, now);
  const c = { createdAt: { gte: since } };
  const [signUps, uploads, lessons, answers, claudeGraded, reviews, tutor, tests, highlights, notes, plans, events] = await Promise.all([
    db.user.count({ where: c }),
    db.book.count({ where: { ...c, status: { not: "AWAITING_UPLOAD" } } }),
    db.usageEvent.findMany({ where: { ...c, feature: "LESSON", lessonId: { not: null } }, distinct: ["lessonId"], select: { lessonId: true } }).then((r) => r.length),
    db.questionAttempt.count({ where: { ...c, assessmentAttemptId: null } }),
    db.questionAttempt.count({ where: { ...c, gradedBy: "CLAUDE" } }),
    db.reviewLog.count({ where: { reviewedAt: { gte: since } } }),
    db.tutorMessage.count({ where: { ...c, role: "USER" } }),
    db.assessmentAttempt.count({ where: c }),
    db.highlight.count({ where: c }),
    db.note.count({ where: c }),
    db.studyPlan.count({ where: c }),
    db.analyticsEvent.findMany({ where: c, select: { name: true, props: true } }),
  ]);
  const exports = new Map<string, number>();
  let searches = 0;
  let prints = 0;
  for (const e of events) {
    if (e.name === "search_used") searches++;
    else if (e.name === "print_opened") prints++;
    else if (e.name === "export_downloaded") {
      const format = String((e.props as { format?: string } | null)?.format ?? "other");
      exports.set(format, (exports.get(format) ?? 0) + 1);
    }
  }
  return [
    { label: "Sign-ups", count: signUps },
    { label: "Books uploaded", count: uploads },
    { label: "Lessons written by Claude", count: lessons },
    { label: "Practice answers", count: answers },
    { label: "Answers graded by Claude", count: claudeGraded },
    { label: "Flashcard reviews", count: reviews },
    { label: "Tutor questions", count: tutor },
    { label: "Tests taken", count: tests },
    { label: "Highlights", count: highlights },
    { label: "Notes", count: notes },
    { label: "Study plans made", count: plans },
    { label: "Searches", count: searches },
    { label: "Study guides printed", count: prints },
    ...[...exports.entries()].sort().map(([format, count]) => ({ label: `Downloads (${format})`, count })),
  ];
}

/** Work that failed: books that couldn't be read, lessons and tests Claude couldn't write. */
export async function getFailures() {
  const [books, lessonGroups, assessments] = await Promise.all([
    db.book.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        originalFilename: true,
        error: true,
        updatedAt: true,
        user: { select: { email: true } },
        course: { select: { id: true } },
        jobs: { orderBy: { createdAt: "desc" }, take: 1, select: { errorDetail: true, step: true, attempts: true } },
      },
    }),
    db.lesson.groupBy({ by: ["courseId"], where: { status: "FAILED" }, _count: { _all: true } }),
    db.assessment.findMany({
      where: { status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, kind: true, error: true, courseId: true, course: { select: { title: true, user: { select: { email: true } } } }, unit: { select: { title: true } } },
    }),
  ]);
  const courses = await db.course.findMany({
    where: { id: { in: lessonGroups.map((g) => g.courseId) } },
    select: { id: true, title: true, user: { select: { email: true } }, lessons: { where: { status: "FAILED" }, take: 1, select: { error: true } } },
  });
  const failedCount = new Map(lessonGroups.map((g) => [g.courseId, g._count._all]));
  return {
    books: books.map((b) => ({
      id: b.id,
      courseId: b.course?.id ?? null,
      filename: b.originalFilename,
      email: b.user.email,
      error: b.error,
      detail: b.jobs[0]?.errorDetail ?? null,
      step: b.jobs[0]?.step ?? null,
      at: b.updatedAt,
    })),
    lessons: courses.map((c) => ({ courseId: c.id, title: c.title, email: c.user.email, failed: failedCount.get(c.id) ?? 0, error: c.lessons[0]?.error ?? null })),
    assessments: assessments.map((a) => ({
      id: a.id,
      courseId: a.courseId,
      title: a.kind === "FINAL_EXAM" ? `Final exam · ${a.course.title}` : `Unit test · ${a.unit?.title ?? ""} · ${a.course.title}`,
      email: a.course.user.email,
      error: a.error,
    })),
  };
}

export async function listUsers(query: string, now = new Date()) {
  const q = query.trim().slice(0, 100);
  const users = await db.user.findMany({
    where: q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, name: true, email: true, emailVerified: true, role: true, plan: true, createdAt: true, _count: { select: { courses: true } } },
  });
  const spend = await db.usageEvent.groupBy({
    by: ["userId"],
    where: { userId: { in: users.map((u) => u.id) }, createdAt: { gte: periodStart(now) } },
    _sum: { costMicroUsd: true },
  });
  const spendOf = new Map(spend.map((s) => [s.userId, usd(s._sum.costMicroUsd)]));
  return users.map((u) => ({
    ...u,
    courses: u._count.courses,
    usdThisMonth: spendOf.get(u.id) ?? 0,
    budget: limitsForPlan(u.plan).monthlyAiUsd,
  }));
}

// ─── Actions ────────────────────────────────────────────────────────────────

export async function setUserPlan(adminId: string, userId: string, plan: "FREE" | "PRO") {
  await db.user.update({ where: { id: userId }, data: { plan } });
  console.info(`[admin] ${adminId} set plan of ${userId} to ${plan}`);
}

/** Retry on the owner's behalf (so their limits and ownership checks still apply). */
export async function retryBook(adminId: string, bookId: string) {
  const book = await db.book.findUnique({ where: { id: bookId }, select: { userId: true, course: { select: { id: true } } } });
  if (!book?.course) return { ok: false as const, error: "That book no longer exists." };
  console.info(`[admin] ${adminId} retried processing of book ${bookId}`);
  return retryProcessing(book.userId, book.course.id);
}

export async function retryLessons(adminId: string, courseId: string) {
  const course = await db.course.findUnique({ where: { id: courseId }, select: { userId: true } });
  if (!course) return { queued: 0 };
  console.info(`[admin] ${adminId} retried failed lessons in ${courseId}`);
  return startGeneration(course.userId, courseId);
}

export async function retryAssessment(adminId: string, assessmentId: string) {
  const a = await db.assessment.findUnique({ where: { id: assessmentId }, select: { course: { select: { userId: true } } } });
  if (!a) return;
  console.info(`[admin] ${adminId} retried assessment ${assessmentId}`);
  await regenerateAssessment(a.course.userId, assessmentId);
}
