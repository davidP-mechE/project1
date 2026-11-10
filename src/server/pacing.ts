import "server-only";
import { db } from "./db";
import { buildPlan } from "@/lib/sat/practice";
import { DOMAINS } from "@/lib/sat/domains";

/**
 * A student's weekly plan back from their test date, rebuilt from their
 * latest results each time it's shown (weakest domains first, a practice test
 * every 4 weeks, review in the last week, their assigned work in its week).
 * Callers check who may see it.
 */

/** Accuracy per SAT domain over the last 90 days: assignments, diagnostics and College Board questions. */
export async function domainAccuracy(studentId: string, now = new Date()) {
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const [assignment, diagnostic, external] = await Promise.all([
    db.assignmentAnswer.findMany({ where: { userId: studentId, createdAt: { gte: since }, item: { domain: { not: null } } }, select: { score: true, item: { select: { domain: true } } } }),
    db.diagnosticAnswer.findMany({ where: { attempt: { userId: studentId }, updatedAt: { gte: since } }, select: { correct: true, itemId: true } }),
    db.externalResult.findMany({ where: { userId: studentId, createdAt: { gte: since }, result: { not: "SKIPPED" } }, select: { result: true, itemKey: true, assignment: { select: { externalItems: true } } } }),
  ]);
  const diagItems = await db.worksheetItem.findMany({ where: { id: { in: diagnostic.map((d) => d.itemId) } }, select: { id: true, domain: true } });
  const domainOf = new Map(diagItems.map((i) => [i.id, i.domain]));
  const tally = new Map<string, { n: number; sum: number }>();
  const add = (d: string | null | undefined, v: number) => {
    if (!d) return;
    const t = tally.get(d) ?? { n: 0, sum: 0 };
    t.n += 1;
    t.sum += v;
    tally.set(d, t);
  };
  for (const a of assignment) add(a.item.domain, a.score);
  for (const d of diagnostic) add(domainOf.get(d.itemId), d.correct ? 1 : 0);
  for (const e of external) {
    const items = Array.isArray(e.assignment.externalItems) ? (e.assignment.externalItems as { key: string; domain: string }[]) : [];
    add(items.find((i) => i.key === e.itemKey)?.domain, e.result === "CORRECT" ? 1 : 0);
  }
  return Object.fromEntries(DOMAINS.map((d) => [d.id, tally.get(d.id) && tally.get(d.id)!.n >= 3 ? tally.get(d.id)!.sum / tally.get(d.id)!.n : null]));
}

export async function planFor(studentId: string, now = new Date()) {
  const profile = await db.studentProfile.findUnique({ where: { userId: studentId }, select: { testDate: true } });
  if (!profile?.testDate || profile.testDate <= now) return null;
  const [accuracy, assignments] = await Promise.all([
    domainAccuracy(studentId, now),
    db.assignment.findMany({ where: { class: { members: { some: { userId: studentId } }, archivedAt: null }, dueAt: { gte: now, lte: profile.testDate } }, select: { title: true, dueAt: true } }),
  ]);
  return { testDate: profile.testDate, accuracy, weeks: buildPlan({ now, testDate: profile.testDate, accuracy, assignments }) };
}
