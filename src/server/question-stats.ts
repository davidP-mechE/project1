import "server-only";
import { db } from "./db";
import { requireAuthor } from "./bank";
import { flagsFor, summarize, type AnswerRow, type Flag, type VersionStats } from "@/lib/bank/stats";

/**
 * Per-question statistics from bank attempts (practice, assigned sets and live
 * runs): the current version on its own, older versions together, open
 * reports, and "likely bad question" flags (current version only).
 */

export type QuestionStats = { version: number; current: VersionStats; older: VersionStats; olderVersions: number[]; openReports: number; flags: Flag[] };

export async function statsFor(questionIds: string[]): Promise<Map<string, QuestionStats>> {
  if (!questionIds.length) return new Map();
  const [questions, grouped, reports] = await Promise.all([
    db.bankQuestion.findMany({ where: { id: { in: questionIds } }, select: { id: true, version: true, difficulty: true, type: true } }),
    db.bankAttempt.groupBy({ by: ["questionId", "questionVersion", "answerGiven", "correct"], where: { questionId: { in: questionIds } }, _count: { _all: true }, _sum: { timeSeconds: true } }),
    db.questionReport.groupBy({ by: ["bankQuestionId"], where: { bankQuestionId: { in: questionIds }, status: "OPEN" }, _count: { _all: true } }),
  ]);
  const rowsOf = new Map<string, { cur: AnswerRow[]; old: AnswerRow[]; versions: Set<number> }>();
  const versionOf = new Map(questions.map((q) => [q.id, q.version]));
  for (const g of grouped) {
    const r = rowsOf.get(g.questionId) ?? { cur: [], old: [], versions: new Set<number>() };
    const row = { answerGiven: g.answerGiven, correct: g.correct, n: g._count._all, seconds: g._sum.timeSeconds ?? 0 };
    if (g.questionVersion === versionOf.get(g.questionId)) r.cur.push(row);
    else {
      r.old.push(row);
      r.versions.add(g.questionVersion);
    }
    rowsOf.set(g.questionId, r);
  }
  const reportsOf = new Map(reports.map((r) => [r.bankQuestionId!, r._count._all]));
  const out = new Map<string, QuestionStats>();
  for (const q of questions) {
    const r = rowsOf.get(q.id);
    const current = summarize(r?.cur ?? []);
    const openReports = reportsOf.get(q.id) ?? 0;
    out.set(q.id, { version: q.version, current, older: summarize(r?.old ?? []), olderVersions: [...(r?.versions ?? [])].sort((a, b) => a - b), openReports, flags: flagsFor({ difficulty: q.difficulty, type: q.type }, current, openReports) });
  }
  return out;
}

/** One question's stats, for its page (authors only). */
export async function questionStats(userId: string, questionId: string) {
  await requireAuthor(userId);
  return (await statsFor([questionId])).get(questionId) ?? null;
}
