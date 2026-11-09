/** A course's notes and highlights as one Markdown document. Pure and unit-tested. */

export type NotesExportLesson = {
  title: string;
  unitTitle: string;
  pageStart: number;
  pageEnd: number;
  note: string | null;
  highlights: { exact: string; note: string; color: string }[];
};

/** Quote text safely inside a Markdown blockquote (every line prefixed). */
function quote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join("\n");
}

export function notesToMarkdown(courseTitle: string, lessons: NotesExportLesson[], exportedAt: Date): string {
  const out: string[] = [`# ${courseTitle}: my notes`, "", `_Exported from Coursebook on ${exportedAt.toISOString().slice(0, 10)}._`, ""];
  let unit: string | null = null;
  const withContent = lessons.filter((l) => (l.note && l.note.trim()) || l.highlights.length > 0);
  if (withContent.length === 0) out.push("No notes or highlights yet.", "");
  for (const l of withContent) {
    if (l.unitTitle !== unit) {
      unit = l.unitTitle;
      out.push(`## ${unit}`, "");
    }
    const pages = l.pageStart === l.pageEnd ? `p. ${l.pageStart}` : `pp. ${l.pageStart}–${l.pageEnd}`;
    out.push(`### ${l.title} (${pages})`, "");
    if (l.note && l.note.trim()) out.push(l.note.trim(), "");
    if (l.highlights.length > 0) {
      out.push("**Highlights**", "");
      for (const h of l.highlights) {
        out.push(quote(h.exact), "");
        if (h.note.trim()) out.push(`${h.note.trim()}`, "");
      }
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}
