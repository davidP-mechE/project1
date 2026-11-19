import "server-only";
import { db } from "./db";
import type { SkillStat } from "@/lib/practice/auto";

/**
 * Per-student, per-skill results over a window, from what the site already
 * records: question-bank practice (answered, correct), class assignments on
 * tagged worksheet questions, the error log (missed practice-test questions)
 * and the mistake log (open misses). Used by weekly auto practice and by
 * suggested small groups. Callers check scope first.
 */
export async function skillStats(studentIds: string[], now = new Date(), days = 60): Promise<Map<string, SkillStat[]>> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const [skills, bank, assignment, logged, mistakes] = await Promise.all([
    db.skill.findMany({ where: { parentId: { not: null } }, select: { id: true, name: true } }),
    db.bankAttempt.findMany({ where: { userId: { in: studentIds }, createdAt: { gte: since } }, select: { userId: true, correct: true, question: { select: { skillId: true } } } }),
    db.assignmentAnswer.findMany({ where: { userId: { in: studentIds }, createdAt: { gte: since }, item: { skill: { not: null } } }, select: { userId: true, score: true, item: { select: { skill: true } } } }),
    db.attemptItem.findMany({ where: { attempt: { userId: { in: studentIds }, dateTaken: { gte: since } }, result: { in: ["wrong", "guessed"] }, skillId: { not: null } }, select: { skillId: true, attempt: { select: { userId: true } } } }),
    db.mistakeItem.findMany({ where: { studentId: { in: studentIds }, retiredAt: null, skill: { not: null } }, select: { studentId: true, skill: true } }),
  ]);
  const byName = new Map(skills.map((s) => [s.name.toLowerCase(), s.id]));
  const out = new Map<string, Map<string, SkillStat>>();
  const stat = (studentId: string, skillId: string) => {
    const m = out.get(studentId) ?? new Map<string, SkillStat>();
    out.set(studentId, m);
    const s = m.get(skillId) ?? { skillId, misses: 0, answered: 0, correct: 0 };
    m.set(skillId, s);
    return s;
  };
  for (const b of bank) {
    if (!b.question.skillId) continue;
    const s = stat(b.userId, b.question.skillId);
    s.answered += 1;
    if (b.correct) s.correct += 1;
  }
  for (const a of assignment) {
    const id = byName.get(a.item.skill!.toLowerCase());
    if (!id) continue;
    const s = stat(a.userId, id);
    s.answered += 1;
    if (a.score >= 1) s.correct += 1;
  }
  for (const l of logged) stat(l.attempt.userId, l.skillId!).misses += 1;
  for (const m of mistakes) {
    const id = byName.get(m.skill!.toLowerCase());
    if (id) stat(m.studentId, id).misses += 1;
  }
  return new Map(studentIds.map((id) => [id, [...(out.get(id)?.values() ?? [])]]));
}

/** The domain id of a skill id like "rw.conventions.boundaries". */
export const domainOfSkill = (skillId: string | null | undefined) => skillId?.split(".")[1] ?? null;
