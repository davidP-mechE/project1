import type { CourseExport } from "./types";
import { pagesLabel } from "./types";

/**
 * CSV files (RFC 4180): fields with commas, quotes or line breaks are quoted,
 * quotes doubled. A field starting with = + - @ (or a tab/CR) is prefixed with
 * an apostrophe so spreadsheet apps never run it as a formula. Pure and unit-tested.
 */
export function csvField(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number)[][]): string {
  // BOM so Excel opens UTF-8 (accents, symbols) correctly; CRLF line endings per RFC 4180.
  return `\uFEFF${rows.map((r) => r.map(csvField).join(",")).join("\r\n")}\r\n`;
}

/** Flashcards: front, back, unit, lesson, pages. Imports into Quizlet, Anki (as text), spreadsheets. */
export function flashcardsCsv(course: CourseExport): string {
  const rows: (string | number)[][] = [["Front", "Back", "Unit", "Lesson", "Pages"]];
  for (const u of course.units) for (const l of u.lessons) for (const c of l.flashcards) rows.push([c.front, c.back, u.title, l.title, pagesLabel(c.pageRefs)]);
  return toCsv(rows);
}

/** Every question (practice, unit tests, final exam) with its answer. */
export function questionsCsv(course: CourseExport): string {
  const rows: (string | number)[][] = [["Where", "Type", "Question", "Choices", "Answer", "Explanation", "Topic", "Pages"]];
  const type = { MULTIPLE_CHOICE: "Multiple choice", SHORT_ANSWER: "Short answer", STEP_BY_STEP: "Step by step" };
  const add = (where: string, q: CourseExport["finalExam"][number]) =>
    rows.push([
      where,
      type[q.type],
      q.prompt,
      q.choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join("\n"),
      q.type === "MULTIPLE_CHOICE" && q.correctChoice !== null ? `${String.fromCharCode(65 + q.correctChoice)}. ${q.choices[q.correctChoice] ?? ""}` : q.steps.length ? `${q.steps.join("\n")}\n= ${q.answer}` : q.answer,
      q.explanation,
      q.topic,
      pagesLabel(q.pageRefs),
    ]);
  for (const u of course.units) {
    for (const l of u.lessons) for (const q of l.questions) add(`${u.title} › ${l.title}`, q);
    for (const q of u.test) add(`${u.title} › Unit test`, q);
  }
  for (const q of course.finalExam) add("Final exam", q);
  return toCsv(rows);
}
