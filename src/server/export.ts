import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { LessonContentSchema } from "@/lib/ai/lesson-schema";
import type { CourseExport, ExportQuestion } from "@/lib/export/types";

/** Load a whole course for exporting. Only the student's own course; skipped and unwritten lessons are left out. */
export async function getCourseExport(userId: string, courseId: string): Promise<CourseExport> {
  const course = await db.course.findFirst({
    where: { id: courseId, userId },
    select: { title: true, book: { select: { originalFilename: true, kind: true } } },
  });
  if (!course) throw new NotFoundError("Course not found");
  const q = { orderBy: { order: "asc" as const }, select: { type: true, prompt: true, choices: true, correctChoice: true, answer: true, explanation: true, steps: true, pageRefs: true, topic: true } };
  const [units, final] = await Promise.all([
    db.unit.findMany({
      where: { courseId },
      orderBy: { order: "asc" },
      select: {
        title: true,
        assessments: { where: { status: "READY" }, select: { summary: true, questions: q } },
        lessons: {
          where: { skip: false, generatedAt: { not: null } },
          orderBy: { order: "asc" },
          select: {
            title: true,
            pageStart: true,
            pageEnd: true,
            content: true,
            questions: { where: { scope: "LESSON" }, ...q },
            flashcards: { orderBy: { order: "asc" }, select: { id: true, front: true, back: true, pageRefs: true } },
          },
        },
      },
    }),
    db.assessment.findFirst({ where: { courseId, kind: "FINAL_EXAM", status: "READY" }, select: { questions: q } }),
  ]);
  return {
    title: course.title,
    bookFilename: course.book.originalFilename,
    kind: course.book.kind,
    units: units
      .map((u) => ({
        title: u.title,
        summary: u.assessments[0]?.summary ?? null,
        test: (u.assessments[0]?.questions ?? []) as ExportQuestion[],
        lessons: u.lessons.flatMap((l) => {
          const c = LessonContentSchema.safeParse(l.content);
          if (!c.success) return [];
          return [{ title: l.title, pageStart: l.pageStart, pageEnd: l.pageEnd, ...c.data, questions: l.questions as ExportQuestion[], flashcards: l.flashcards }];
        }),
      }))
      .filter((u) => u.lessons.length > 0),
    finalExam: (final?.questions ?? []) as ExportQuestion[],
  };
}

let sql: Promise<SqlJsStatic> | null = null;
/**
 * The SQLite engine (WebAssembly) used to build Anki decks. Loaded once.
 * The .wasm file is read with fs from a literal path (not imported), so the
 * bundler leaves it alone and deployment file tracing still includes it.
 */
export function sqlJs(): Promise<SqlJsStatic> {
  sql ??= (async () => {
    let file = path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm");
    if (!existsSync(file)) file = path.join(path.dirname(createRequire(import.meta.url).resolve("sql.js")), "sql-wasm.wasm");
    const wasm = readFileSync(file);
    return initSqlJs({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
  })();
  return sql;
}
