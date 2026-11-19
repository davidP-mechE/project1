import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { can, classAccess, ClassError, studentIdsInScope, type ClassAccess } from "./access";
import { assignQuestionSet } from "./classes";
import { notify } from "./notifications";
import { domainOfSkill, skillStats } from "./skill-stats";
import { AUTO_SIZE, pickAutoSet, swapFor, weekOf, type PoolQuestion } from "@/lib/practice/auto";

/**
 * Weekly auto-assigned practice. Each week (the worker's hourly job builds any
 * class's batch that's missing for the week) every student in a class gets a
 * proposed set of 8–12 published bank questions on their weakest skills (the
 * rules are in src/lib/weekly.ts; no AI, so it serves "no AI" students
 * too). Staff review the batch: remove or swap questions, take a student out,
 * then approve all at once. Each approved set becomes a question set (hidden
 * from the bank's lists) assigned to that one student with a due date.
 *
 * Scope: staff see and act on their own students only; a subject-limited
 * specialist acts only on sets whose skills are all in their subjects.
 */

const DAY = 86_400_000;
const RECENT_CORRECT_DAYS = 30;
const RECENT_AUTO_DAYS = 21;

type Inputs = { pool: PoolQuestion[]; exclude: Map<string, Set<string>>; seen: Map<string, Set<string>> };

async function inputsFor(studentIds: string[], now: Date): Promise<Inputs> {
  const [pool, attempts, recentAuto] = await Promise.all([
    db.bankQuestion.findMany({ where: { status: "published", skillId: { not: null } }, select: { id: true, skillId: true, difficulty: true } }),
    db.bankAttempt.findMany({ where: { userId: { in: studentIds } }, select: { userId: true, questionId: true, correct: true, createdAt: true } }),
    db.autoPracticeItem.findMany({ where: { studentId: { in: studentIds }, createdAt: { gte: new Date(now.getTime() - RECENT_AUTO_DAYS * DAY) } }, select: { studentId: true, questionIds: true } }),
  ]);
  const exclude = new Map<string, Set<string>>();
  const seen = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => m.set(k, (m.get(k) ?? new Set()).add(v));
  const cutoff = now.getTime() - RECENT_CORRECT_DAYS * DAY;
  for (const a of attempts) {
    add(seen, a.userId, a.questionId);
    if (a.correct && a.createdAt.getTime() >= cutoff) add(exclude, a.userId, a.questionId);
  }
  for (const r of recentAuto) for (const q of r.questionIds) add(exclude, r.studentId, q);
  return { pool: pool.map((q) => ({ id: q.id, skillId: q.skillId!, difficulty: q.difficulty })), exclude, seen };
}

/**
 * Build a class's batch for the week, if it doesn't have one (no permission
 * check: the worker and buildBatchNow call it). Students who already have a
 * set this week from another class of the same program are left out.
 */
export async function buildBatch(classId: string, now = new Date(), opts: { replacePending?: boolean } = {}) {
  const week = weekOf(now);
  const c = await db.class.findUnique({ where: { id: classId }, select: { id: true, name: true, programId: true, archivedAt: true, members: { select: { userId: true } } } });
  if (!c || c.archivedAt) return null;
  const existing = await db.autoPracticeBatch.findUnique({ where: { classId_weekOf: { classId, weekOf: week } }, select: { id: true } });
  if (existing && !opts.replacePending) return { id: existing.id, created: false };
  const ids = c.members.map((m) => m.userId);
  const elsewhere = new Set(
    (await db.autoPracticeItem.findMany({ where: { studentId: { in: ids }, status: { not: "REMOVED" }, batch: { weekOf: week, classId: { not: classId }, class: { programId: c.programId } } }, select: { studentId: true } })).map((x) => x.studentId),
  );
  const [stats, inputs] = await Promise.all([skillStats(ids, now), inputsFor(ids, now)]);
  const batch = existing ?? (await db.autoPracticeBatch.create({ data: { classId, weekOf: week, createdAt: now } }));
  const keep = existing ? new Set((await db.autoPracticeItem.findMany({ where: { batchId: batch.id, status: { not: "PENDING" } }, select: { studentId: true } })).map((x) => x.studentId)) : new Set<string>();
  if (existing) await db.autoPracticeItem.deleteMany({ where: { batchId: batch.id, status: "PENDING" } });
  const skipped: { studentId: string; reason: string }[] = [];
  let made = 0;
  for (const id of ids) {
    if (keep.has(id)) continue;
    if (elsewhere.has(id)) {
      skipped.push({ studentId: id, reason: "Already has a set this week from another class." });
      continue;
    }
    const r = pickAutoSet({ stats: stats.get(id) ?? [], pool: inputs.pool, exclude: inputs.exclude.get(id) ?? new Set(), seen: inputs.seen.get(id) ?? new Set(), seed: `${id}:${week}`, size: AUTO_SIZE });
    if ("reason" in r) {
      skipped.push({ studentId: id, reason: r.reason });
      continue;
    }
    await db.autoPracticeItem.create({ data: { batchId: batch.id, studentId: id, questionIds: r.questionIds, skillIds: r.skillIds, createdAt: now } });
    made++;
  }
  await db.autoPracticeBatch.update({ where: { id: batch.id }, data: { skipped } });
  if (made > 0) {
    const staff = await db.classStaff.findMany({ where: { classId, role: { in: ["TEACHER", "SPECIALIST"] } }, select: { userId: true } });
    const p = await db.program.findUnique({ where: { id: c.programId }, select: { adminId: true } });
    await notify([...staff.map((s) => s.userId), ...(p ? [p.adminId] : [])], { kind: "review", key: `auto:${classId}:${week}`, title: `This week's practice for ${c.name} is ready to approve`, href: `/teach/${classId}/weekly` }, now);
  }
  return { id: batch.id, created: !existing, made, skipped: skipped.length };
}

/** Hourly from the worker: build this week's batch for every live class with students that doesn't have one. */
export async function buildWeeklyBatches(now = new Date()) {
  const week = weekOf(now);
  const classes = await db.class.findMany({ where: { archivedAt: null, members: { some: {} }, autoBatches: { none: { weekOf: week } } }, select: { id: true } });
  let built = 0;
  for (const c of classes) if ((await buildBatch(c.id, now))?.created) built++;
  return built;
}

/** May this person act on a set with these skills? (Teachers and the admin: yes; specialists: only inside their subjects.) */
function canActOn(a: ClassAccess, skillIds: string[]) {
  if (!can(a, "teach")) return false;
  return !a.subjects || skillIds.every((s) => a.subjects!.has(domainOfSkill(s) ?? ""));
}

/** The batch screen: this week's batch (or the given week's) for the viewer's students. */
export async function autoBatchView(userId: string, classId: string, opts: { week?: string } = {}, now = new Date()) {
  const access = await classAccess(userId, classId);
  const week = opts.week && /^\d{4}-\d{2}-\d{2}$/.test(opts.week) ? opts.week : weekOf(now);
  const batch = await db.autoPracticeBatch.findUnique({ where: { classId_weekOf: { classId, weekOf: week } }, include: { items: { include: { student: { select: { id: true, name: true } } }, orderBy: { student: { name: "asc" } } } } });
  const scope = new Set(await studentIdsInScope(access));
  const weeks = (await db.autoPracticeBatch.findMany({ where: { classId }, orderBy: { weekOf: "desc" }, take: 8, select: { weekOf: true } })).map((b) => b.weekOf);
  if (!batch) return { access, week, weeks, batch: null, items: [], skipped: [], canBuild: can(access, "teach") };
  const items = batch.items.filter((i) => scope.has(i.studentId));
  const qs = await db.bankQuestion.findMany({ where: { id: { in: items.flatMap((i) => i.questionIds) } }, select: { id: true, stem: true, difficulty: true, status: true, skillId: true, skill: { select: { name: true } } } });
  const qOf = new Map(qs.map((q) => [q.id, q]));
  const skills = await db.skill.findMany({ where: { id: { in: items.flatMap((i) => i.skillIds) } }, select: { id: true, name: true } });
  const skillName = new Map(skills.map((s) => [s.id, s.name]));
  const names = new Map((await db.user.findMany({ where: { id: { in: [...scope] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const skipped = ((batch.skipped as { studentId: string; reason: string }[]) ?? []).filter((s) => scope.has(s.studentId)).map((s) => ({ ...s, name: names.get(s.studentId) ?? "Student" }));
  return {
    access,
    week,
    weeks,
    batch: { id: batch.id, createdAt: batch.createdAt },
    canBuild: can(access, "teach"),
    skipped,
    items: items.map((i) => {
      const allowed = canActOn(access, i.skillIds);
      return {
        id: i.id,
        student: i.student,
        status: i.status as "PENDING" | "APPROVED" | "REMOVED",
        assignmentId: i.assignmentId,
        canAct: allowed,
        skills: i.skillIds.map((s) => skillName.get(s) ?? "Skill"),
        // Out-of-subject sets show only their size to a specialist.
        questions: allowed
          ? i.questionIds.map((id) => {
              const q = qOf.get(id);
              return { id, stem: q?.stem.replace(/\s+/g, " ").slice(0, 160) ?? "(deleted)", skill: q?.skill?.name ?? "", difficulty: q?.difficulty ?? 2, published: q?.status === "published" };
            })
          : [],
        count: i.questionIds.length,
      };
    }),
  };
}

/** One item the viewer may change (pending, their student, in their subjects), with its class access. */
async function itemFor(userId: string, itemId: string) {
  const it = await db.autoPracticeItem.findUnique({ where: { id: itemId }, include: { batch: { select: { classId: true } } } });
  if (!it) throw new NotFoundError("Not found");
  const access = await classAccess(userId, it.batch.classId, "teach");
  if (!(await studentIdsInScope(access)).includes(it.studentId)) throw new NotFoundError("Not found");
  if (!canActOn(access, it.skillIds)) throw new ClassError("That set is outside your subjects.", 403);
  return { it, access };
}

export async function removeQuestion(userId: string, itemId: string, questionId: string) {
  const { it } = await itemFor(userId, itemId);
  if (it.status !== "PENDING") throw new ClassError("That set has already been approved or removed.");
  if (!it.questionIds.includes(questionId)) throw new NotFoundError("Not found");
  if (it.questionIds.length <= 1) throw new ClassError("A set needs at least one question. Take the student out instead.");
  await db.autoPracticeItem.update({ where: { id: it.id }, data: { questionIds: it.questionIds.filter((q) => q !== questionId) } });
}

/** Replace one question with another published question on the same skill. */
export async function swapQuestion(userId: string, itemId: string, questionId: string, now = new Date()) {
  const { it } = await itemFor(userId, itemId);
  if (it.status !== "PENDING") throw new ClassError("That set has already been approved or removed.");
  if (!it.questionIds.includes(questionId)) throw new NotFoundError("Not found");
  const out = await db.bankQuestion.findUnique({ where: { id: questionId }, select: { id: true, skillId: true, difficulty: true } });
  if (!out?.skillId) throw new ClassError("That question has no skill to match.");
  const inputs = await inputsFor([it.studentId], now);
  const next = swapFor({ current: it.questionIds, out: { id: out.id, skillId: out.skillId, difficulty: out.difficulty }, pool: inputs.pool, exclude: inputs.exclude.get(it.studentId) ?? new Set(), seen: inputs.seen.get(it.studentId) ?? new Set() });
  if (!next) throw new ClassError("No other published question on that skill to swap in.");
  await db.autoPracticeItem.update({ where: { id: it.id }, data: { questionIds: it.questionIds.map((q) => (q === questionId ? next.id : q)) } });
  return next.id;
}

/** Take a student's set out of the batch (or put it back). */
export async function setItemRemoved(userId: string, itemId: string, removed: boolean) {
  const { it } = await itemFor(userId, itemId);
  if (it.status === "APPROVED") throw new ClassError("That set is already assigned.");
  await db.autoPracticeItem.update({ where: { id: it.id }, data: { status: removed ? "REMOVED" : "PENDING" } });
}

/** Rebuild this week's pending sets now (approved ones stay). */
export async function buildBatchNow(userId: string, classId: string, now = new Date()) {
  await classAccess(userId, classId, "teach");
  return buildBatch(classId, now, { replacePending: true });
}

/**
 * Approve every pending set the viewer may act on: each becomes a published,
 * class-only question set for that student and an assignment due on `dueAt`.
 */
export async function approveBatch(userId: string, classId: string, input: { batchId: string; dueAt: string | Date }, now = new Date()) {
  const access = await classAccess(userId, classId, "teach");
  const batch = await db.autoPracticeBatch.findFirst({ where: { id: input.batchId, classId }, include: { items: { where: { status: "PENDING" }, include: { student: { select: { name: true } } } } } });
  if (!batch) throw new NotFoundError("Not found");
  const due = new Date(input.dueAt);
  if (Number.isNaN(due.getTime()) || due <= now) throw new ClassError("Choose a due date in the future.");
  const scope = new Set(await studentIdsInScope(access));
  const published = new Set((await db.bankQuestion.findMany({ where: { id: { in: batch.items.flatMap((i) => i.questionIds) }, status: "published" }, select: { id: true } })).map((q) => q.id));
  let approved = 0;
  for (const it of batch.items) {
    if (!scope.has(it.studentId) || !canActOn(access, it.skillIds)) continue;
    const qs = it.questionIds.filter((q) => published.has(q));
    if (!qs.length) continue;
    const first = it.student.name.split(" ")[0] || "Student";
    const title = `Practice for ${first} · week of ${new Date(`${batch.weekOf}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
    const set = await db.questionSet.create({ data: { title, description: "Built from your weakest skills this week.", authorId: userId, questionIds: qs, skillIds: it.skillIds, visibility: "class", status: "published", autoForStudentId: it.studentId } });
    const a = await assignQuestionSet(userId, classId, { setId: set.id, title, dueAt: due, targets: { studentIds: [it.studentId], groupIds: [] } });
    await db.autoPracticeItem.update({ where: { id: it.id }, data: { status: "APPROVED", questionIds: qs, assignmentId: a.id, approvedById: userId, approvedAt: now } });
    approved++;
  }
  return { approved };
}
