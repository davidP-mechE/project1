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
  // Questions imported before the owner had an account get them as author.
  if (author) await db.bankQuestion.updateMany({ where: { authorId: null, externalId: { startsWith: "W" } }, data: { authorId: author.id } });

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
  return { report, sets, authorFound: Boolean(author) };
}
