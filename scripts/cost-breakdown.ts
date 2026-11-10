/**
 * What generating a course actually cost, step by step, from the recorded
 * usage of every Claude call (model, tokens, cache use, batch or not).
 *
 *   npm run cost:breakdown                 the most recently generated course
 *   npm run cost:breakdown -- <courseId>   a specific course
 *   npm run cost:breakdown -- --all        every course, all time
 *
 * Uses DATABASE_URL from .env (or the environment).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const STEP: Record<string, string> = {
  LESSON: "Lessons + practice questions",
  FLASHCARDS: "Flashcards",
  PAGE_REPAIR: "Reading equation-heavy pages",
  ASSESSMENT: "Unit summaries, tests, final exam",
  QUESTIONS: "New questions (regenerate, Review drills)",
  GRADING: "Grading written answers",
  TUTOR: "Tutor",
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Needs DATABASE_URL (in .env or the environment).");
    process.exit(1);
  }
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
    const all = process.argv.includes("--all");
    let courseId: string | null = null;
    if (!all) {
      courseId =
        arg ??
        (
          await db.usageEvent.findFirst({
            where: { feature: "LESSON", courseId: { not: null } },
            orderBy: { createdAt: "desc" },
            select: { courseId: true },
          })
        )?.courseId ??
        null;
      if (!courseId) {
        console.error(
          "No generated course found. Generate one first, or pass a course id.",
        );
        process.exit(1);
      }
    }
    const where = courseId ? { courseId } : {};
    const course = courseId
      ? await db.course.findUnique({
          where: { id: courseId },
          select: {
            title: true,
            _count: {
              select: { lessons: { where: { generatedAt: { not: null } } } },
            },
          },
        })
      : null;
    const rows = await db.usageEvent.groupBy({
      by: ["feature", "model", "batch"],
      where,
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        costMicroUsd: true,
      },
    });
    if (rows.length === 0) {
      console.log("No Claude usage recorded for this course.");
      return;
    }
    const total = rows.reduce((n, r) => n + (r._sum.costMicroUsd ?? 0), 0);
    rows.sort(
      (a, b) => (b._sum.costMicroUsd ?? 0) - (a._sum.costMicroUsd ?? 0),
    );

    console.log(
      course
        ? `\n"${course.title}" (${course._count.lessons} lessons written)`
        : "\nAll courses",
    );
    console.log(`Total: $${(total / 1e6).toFixed(3)}\n`);
    const head = [
      "Step",
      "Model",
      "Batch",
      "Calls",
      "Input",
      "Cache read",
      "Cache write",
      "Output",
      "Cost",
      "Share",
    ];
    const table = rows.map((r) => [
      STEP[r.feature] ?? r.feature,
      r.model,
      r.batch ? "yes" : "",
      String(r._count._all),
      String(r._sum.inputTokens ?? 0),
      String(r._sum.cacheReadTokens ?? 0),
      String(r._sum.cacheWriteTokens ?? 0),
      String(r._sum.outputTokens ?? 0),
      `$${((r._sum.costMicroUsd ?? 0) / 1e6).toFixed(3)}`,
      total > 0
        ? `${Math.round(((r._sum.costMicroUsd ?? 0) / total) * 100)}%`
        : "-",
    ]);
    const widths = head.map((h, i) =>
      Math.max(h.length, ...table.map((row) => row[i].length)),
    );
    const line = (cells: string[]) =>
      cells
        .map((c, i) => (i >= 3 ? c.padStart(widths[i]) : c.padEnd(widths[i])))
        .join("  ");
    console.log(line(head));
    for (const row of table) console.log(line(row));
    console.log(
      "\nOutput tokens include Claude's thinking. Batch rows are already at half price.",
    );
  } finally {
    await db.$disconnect();
  }
}

void main();
