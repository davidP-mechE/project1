import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { computeInsights } from "@/lib/tracker/insights";
import { toCsv } from "@/lib/csv";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Insights and the redo list for one student. These functions take the
 * student's id and do no permission check themselves: the student's own pages
 * pass their own id; staff pages check class scope first (src/server/tutor-view.ts).
 */

export async function studentInsights(studentId: string) {
  const [attempts, items, bankAttempts, skills, errorTypes] = await Promise.all([
    db.testAttempt.findMany({ where: { userId: studentId }, select: { id: true, dateTaken: true, total: true, scoreRw: true, scoreMath: true, status: true, test: { select: { name: true } } } }),
    db.attemptItem.findMany({ where: { attempt: { userId: studentId } }, select: { attemptId: true, result: true, skillId: true, errorTypeId: true } }),
    db.bankAttempt.findMany({ where: { userId: studentId }, select: { correct: true, createdAt: true, question: { select: { skillId: true } } } }),
    db.skill.findMany({ where: { parentId: { not: null } }, select: { id: true, name: true, domain: true, section: true } }),
    db.errorType.findMany({ orderBy: { order: "asc" }, select: { id: true, label: true } }),
  ]);
  const out = computeInsights({
    attempts: attempts.map((a) => ({ ...a, testName: a.test.name })),
    items,
    bankAttempts: bankAttempts.map((b) => ({ correct: b.correct, createdAt: b.createdAt, skillId: b.question.skillId })),
    skills,
    errorTypes,
  });
  return { ...out, errorTypes, focus: await withSets(out.focus) };
}

/** Link each "Focus next" skill to the published, public set with the most published questions on it. */
async function withSets(focus: { skillId: string; name: string; misses: number }[]) {
  if (!focus.length) return [];
  const sets = await db.questionSet.findMany({ where: { status: "published", visibility: "public", skillIds: { hasSome: focus.map((f) => f.skillId) } }, select: { id: true, title: true, questionIds: true } });
  const qs = await db.bankQuestion.findMany({ where: { id: { in: sets.flatMap((s) => s.questionIds) }, status: "published" }, select: { id: true, skillId: true } });
  const skillOf = new Map(qs.map((q) => [q.id, q.skillId]));
  return focus.map((f) => {
    let best: { id: string; title: string; n: number } | null = null;
    for (const s of sets) {
      const n = s.questionIds.filter((id) => skillOf.get(id) === f.skillId).length;
      if (n > 0 && (!best || n > best.n)) best = { id: s.id, title: s.title, n };
    }
    return { ...f, set: best };
  });
}

// ─── Redo list ───────────────────────────────────────────────────────────

export type RedoFilters = { skillId?: string; errorTypeId?: string; status?: string };

function redoWhere(studentId: string, f: RedoFilters): Prisma.AttemptItemWhereInput {
  return {
    attempt: { userId: studentId },
    result: { in: ["wrong", "guessed", "skipped"] },
    ...(f.skillId ? { skillId: f.skillId } : {}),
    ...(f.errorTypeId ? { errorTypeId: f.errorTypeId } : {}),
    ...(f.status === "to_redo" || f.status === "redone_correct" || f.status === "still_wrong" ? { redoStatus: f.status } : {}),
  };
}

/** Every missed, skipped or guessed question, newest test first, with its test, module and number. */
export async function redoList(studentId: string, f: RedoFilters = {}) {
  const rows = await db.attemptItem.findMany({
    where: redoWhere(studentId, f),
    orderBy: [{ attempt: { dateTaken: "desc" } }, { section: "desc" }, { module: "asc" }, { questionNumber: "asc" }],
    select: { id: true, section: true, module: true, questionNumber: true, result: true, note: true, redoStatus: true, skill: { select: { id: true, name: true } }, errorType: { select: { id: true, label: true } }, attempt: { select: { id: true, dateTaken: true, test: { select: { name: true } } } } },
    take: 1000,
  });
  return rows;
}

export async function setRedoStatus(studentId: string, itemId: string, status: "to_redo" | "redone_correct" | "still_wrong") {
  const item = await db.attemptItem.findUnique({ where: { id: itemId }, select: { attempt: { select: { userId: true } } } });
  if (!item || item.attempt.userId !== studentId) throw new NotFoundError("Not found");
  await db.attemptItem.update({ where: { id: itemId }, data: { redoStatus: status } });
}

const STATUS_LABEL = { to_redo: "To redo", redone_correct: "Redone (correct)", still_wrong: "Still wrong" } as const;

export async function redoCsv(studentId: string, f: RedoFilters = {}) {
  const rows = await redoList(studentId, f);
  return toCsv([
    ["Test", "Date", "Section", "Module", "Question", "Result", "Skill", "Error type", "Note", "Status"],
    ...rows.map((r) => [r.attempt.test.name, r.attempt.dateTaken.toISOString().slice(0, 10), r.section === "rw" ? "Reading and Writing" : "Math", r.module, r.questionNumber, r.result, r.skill?.name ?? "", r.errorType?.label ?? "", r.note ?? "", STATUS_LABEL[r.redoStatus]]),
  ]);
}
