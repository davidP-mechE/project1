import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db } from "../db";
import { runImport } from "../bank";

/**
 * The 1600 Project's weeks 3–6 file: 240 original math questions, imported as
 * drafts (authored by the owner), plus one draft set per week.
 */
export const QUESTION_FILE = "data/questions/1600-weeks3-6-questions.json";

/** The 1600 Project's Reading and Writing questions (original, by lesson ELA-W1 to ELA-W4), with one draft set per lesson. */
export const ELA_QUESTION_FILE = "data/questions/1600-ela-questions.json";

export const ELA_SETS = [
  { lesson: "ELA-W1", title: "R&W Lesson 1 · Central ideas and details" },
  { lesson: "ELA-W2", title: "R&W Lesson 2 · Boundaries" },
  { lesson: "ELA-W3", title: "R&W Lesson 3 · Form, structure, and sense" },
  { lesson: "ELA-W4", title: "R&W Lesson 4 · Transitions and rhetorical synthesis" },
];

export const WEEK_SETS = [
  { week: 3, title: "Week 3 · Linear equations" },
  { week: 4, title: "Week 4 · Systems & inequalities" },
  { week: 5, title: "Week 5 · Ratios, rates & units" },
  { week: 6, title: "Week 6 · Percentages" },
];

export async function seedQuestionFile(root = process.cwd()) {
  const owner = process.env.OWNER_EMAIL?.trim();
  const author = owner ? await db.user.findFirst({ where: { email: { equals: owner, mode: "insensitive" }, emailVerified: true }, select: { id: true } }) : null;
  const text = fs.readFileSync(path.join(root, QUESTION_FILE), "utf8");
  const report = await runImport(text, "json", { commit: true, authorId: author?.id ?? null });
  const elaReport = await runImport(fs.readFileSync(path.join(root, ELA_QUESTION_FILE), "utf8"), "json", { commit: true, authorId: author?.id ?? null });
  // Questions imported before the owner had an account get them as author.
  if (author) await db.bankQuestion.updateMany({ where: { authorId: null, OR: [{ externalId: { startsWith: "W" } }, { externalId: { startsWith: "ELA-" } }] }, data: { authorId: author.id } });

  const sets: { title: string; created: boolean; count: number }[] = [];
  for (const w of WEEK_SETS) {
    const qs = await db.bankQuestion.findMany({ where: { week: w.week, externalId: { startsWith: `W${w.week}-` } }, orderBy: { externalId: "asc" }, select: { id: true, skillId: true } });
    const existing = await db.questionSet.findFirst({ where: { title: w.title }, select: { id: true } });
    if (!existing) {
      await db.questionSet.create({
        data: { title: w.title, authorId: author?.id ?? null, questionIds: qs.map((q) => q.id), skillIds: [...new Set(qs.flatMap((q) => (q.skillId ? [q.skillId] : [])))], visibility: "public", status: "draft" },
      });
    } else if (author) await db.questionSet.updateMany({ where: { id: existing.id, authorId: null }, data: { authorId: author.id } });
    sets.push({ title: w.title, created: !existing, count: qs.length });
  }
  for (const l of ELA_SETS) {
    // In blueprint order (E9 before E10), easiest first.
    const num = (b: string | null) => Number(b?.replace(/\D/g, "") || 0);
    const qs = (await db.bankQuestion.findMany({ where: { lesson: l.lesson, externalId: { startsWith: "ELA-" } }, select: { id: true, skillId: true, blueprint: true, difficulty: true } })).sort((a, b) => num(a.blueprint) - num(b.blueprint) || a.difficulty - b.difficulty);
    const existing = await db.questionSet.findFirst({ where: { title: l.title }, select: { id: true } });
    if (!existing && qs.length) {
      await db.questionSet.create({
        data: { title: l.title, authorId: author?.id ?? null, questionIds: qs.map((q) => q.id), skillIds: [...new Set(qs.flatMap((q) => (q.skillId ? [q.skillId] : [])))], visibility: "public", status: "draft" },
      });
    } else if (existing && author) await db.questionSet.updateMany({ where: { id: existing.id, authorId: null }, data: { authorId: author.id } });
    sets.push({ title: l.title, created: !existing && qs.length > 0, count: qs.length });
  }
  return { report, elaReport, sets, authorFound: Boolean(author) };
}
