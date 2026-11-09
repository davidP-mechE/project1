import type { CourseExport, ExportQuestion } from "./types";
import { pagesLabel, rangeLabel } from "./types";

/**
 * The whole course as one Markdown study guide (math stays as $LaTeX$, which
 * Obsidian, Typora, GitHub and most Markdown apps render). Pure and unit-tested.
 */
export type MarkdownOptions = { answers: boolean; flashcards: boolean };

const letter = (i: number) => String.fromCharCode(65 + i);
/** Lesson headings inside lesson text are demoted so the guide's outline stays intact. */
const demote = (md: string) => md.replace(/^(#{1,4}) /gm, (_m, h: string) => `${"#".repeat(Math.min(6, h.length + 3))} `);
const anchor = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

function questionsMd(qs: ExportQuestion[], answers: boolean): string[] {
  const out: string[] = [];
  qs.forEach((q, i) => {
    out.push(`${i + 1}. ${q.prompt.replace(/\n/g, "\n   ")}`);
    q.choices.forEach((c, j) => out.push(`   - ${letter(j)}. ${c}`));
    if (answers) {
      const ans = q.type === "MULTIPLE_CHOICE" && q.correctChoice !== null ? `${letter(q.correctChoice)}. ${q.choices[q.correctChoice] ?? ""}` : q.answer;
      out.push("", `   **Answer:** ${ans}${q.pageRefs.length ? ` _(${pagesLabel(q.pageRefs)})_` : ""}`);
      if (q.steps.length) q.steps.forEach((s, j) => out.push(`   ${j + 1}) ${s}`));
      if (q.explanation) out.push(`   _${q.explanation.replace(/\n+/g, " ")}_`);
    }
    out.push("");
  });
  return out;
}

export function courseToMarkdown(c: CourseExport, opts: MarkdownOptions, exportedAt: Date): string {
  const out: string[] = [`# ${c.title}`, "", `_Study guide made with Coursebook from "${c.bookFilename}" on ${exportedAt.toISOString().slice(0, 10)}. Page numbers refer to the original book._`, "", "## Contents", ""];
  c.units.forEach((u) => {
    out.push(`- [${u.title}](#${anchor(u.title)})`);
    u.lessons.forEach((l) => out.push(`  - [${l.title}](#${anchor(l.title)})`));
  });
  if (c.finalExam.length) out.push("- [Final exam](#final-exam)");
  out.push("");
  for (const u of c.units) {
    out.push(`## ${u.title}`, "");
    if (u.summary) out.push("**Unit summary**", "", u.summary.trim(), "");
    for (const l of u.lessons) {
      out.push(`### ${l.title}`, "", `_${rangeLabel(l.pageStart, l.pageEnd)}_`, "");
      if (l.objectives.length) out.push("**You'll learn to:**", "", ...l.objectives.map((o) => `- ${o}`), "");
      out.push(demote(l.explanation.trim()), "");
      if (l.workedExamples.length) {
        out.push("#### Worked examples", "");
        for (const w of l.workedExamples) {
          out.push(`**${w.title}**${w.pageRefs.length ? ` _(${pagesLabel(w.pageRefs)})_` : ""}`, "", w.problem, "", ...w.steps.map((s, i) => `${i + 1}. ${s}`), "", `**Answer:** ${w.answer}`, "");
        }
      }
      if (l.keyTerms.length) out.push("#### Key terms", "", ...l.keyTerms.map((k) => `- **${k.term}**: ${k.definition}`), "");
      if (l.questions.length) out.push("#### Practice questions", "", ...questionsMd(l.questions, opts.answers));
      if (opts.flashcards && l.flashcards.length) {
        out.push("#### Flashcards", "", "| Front | Back |", "| --- | --- |", ...l.flashcards.map((f) => `| ${f.front.replace(/\|/g, "\\|").replace(/\n/g, " ")} | ${f.back.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`), "");
      }
    }
    if (u.test.length) out.push(`### ${u.title}: unit test`, "", ...questionsMd(u.test, opts.answers));
  }
  if (c.finalExam.length) out.push("## Final exam", "", ...questionsMd(c.finalExam, opts.answers));
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
