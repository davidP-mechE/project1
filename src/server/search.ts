import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { buildTsQuery } from "@/lib/search/query";

/**
 * Full-text search in one course: the written lessons and the book's own text.
 * Uses Postgres's built-in search (generated `tsv` columns with GIN indexes,
 * see the Phase 6 migration). Queries are parameterized; the search text is
 * only ever passed as a value, never spliced into SQL.
 */

const HEADLINE = "StartSel=\u0001, StopSel=\u0002, MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter= … ";
const LIMIT = 20;

export type LessonHit = { id: string; title: string; unitTitle: string; pageStart: number; pageEnd: number; snippet: string };
export type BookHit = { id: string; pageStart: number; pageEnd: number; snippet: string; lessonId: string | null; lessonTitle: string | null };

export async function searchCourse(userId: string, courseId: string, input: string) {
  const course = await db.course.findFirst({ where: { id: courseId, userId }, select: { id: true, bookId: true } });
  if (!course) throw new NotFoundError("Course not found");
  const tsquery = buildTsQuery(input);
  if (!tsquery) return { query: null, lessons: [] as LessonHit[], book: [] as BookHit[] };

  const [lessons, chunks, ranges] = await Promise.all([
    db.$queryRaw<LessonHit[]>`
      SELECT l.id, l.title, u.title AS "unitTitle", l."pageStart", l."pageEnd",
             ts_headline('english', coalesce(l.content->>'explanation', ''), q, ${HEADLINE}) AS snippet
      FROM "Lesson" l
      JOIN "Unit" u ON u.id = l."unitId"
      JOIN "Course" c ON c.id = l."courseId",
           to_tsquery('english', ${tsquery}) q
      WHERE c.id = ${courseId} AND c."userId" = ${userId} AND l.skip = false AND l.tsv @@ q
      ORDER BY ts_rank(l.tsv, q) DESC, u."order", l."order"
      LIMIT ${LIMIT}`,
    db.$queryRaw<{ id: string; pageStart: number; pageEnd: number; snippet: string }[]>`
      SELECT ch.id, ch."pageStart", ch."pageEnd",
             ts_headline('english', ch.text, q, ${HEADLINE}) AS snippet
      FROM "Chunk" ch
      JOIN "Course" c ON c."bookId" = ch."bookId",
           to_tsquery('english', ${tsquery}) q
      WHERE c.id = ${courseId} AND c."userId" = ${userId} AND ch.tsv @@ q
      ORDER BY ts_rank(ch.tsv, q) DESC, ch."pageStart"
      LIMIT ${LIMIT}`,
    db.lesson.findMany({ where: { courseId, skip: false }, select: { id: true, title: true, pageStart: true, pageEnd: true, generatedAt: true } }),
  ]);
  // For each book passage, the lesson that covers that page (to open it beside the book).
  const book: BookHit[] = chunks.map((ch) => {
    const l = ranges.find((r) => r.generatedAt && ch.pageStart >= r.pageStart && ch.pageStart <= r.pageEnd);
    return { ...ch, lessonId: l?.id ?? null, lessonTitle: l?.title ?? null };
  });
  return { query: tsquery, lessons, book };
}
