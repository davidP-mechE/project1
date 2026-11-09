/**
 * Front matter (title page, copyright, contents, preface…) and back matter
 * (index, bibliography…) aren't worth turning into lessons, so they're
 * marked and skipped by default. Students can include them in course settings.
 */

const FRONT = [
  /^(front )?cover$/,
  /^half[- ]?title( page)?$/,
  /^title( page)?$/,
  /^copyright( page)?$/,
  /^dedication$/,
  /^epigraph$/,
  /^(table of )?contents$/,
  /^(brief|detailed) contents$/,
  /^contents (in brief|at a glance)$/,
  /^list of (figures|tables|illustrations|abbreviations|symbols)$/,
  /^foreword$/,
  /^prefaces?( to the .*)?$/,
  /^acknowledg(e)?ments?$/,
  /^about (the|this) (authors?|book|edition)$/,
  /^how to use this (book|text)$/,
  /^(note )?to the (student|instructor|teacher|reader)s?$/,
];

const BACK = [
  /^(subject |author |name )?index( of \w+)?$/,
  /^bibliography$/,
  /^references$/,
  /^works cited$/,
  /^(further|suggested) reading$/,
  /^glossary( of terms)?$/,
  /^(photo |image )?credits$/,
  /^colophon$/,
  /^back cover$/,
  /^about the authors?$/,
  /^answers to (selected|odd[- ]numbered|odd) (exercises|problems|questions)$/,
];

/** Strip leading numbering like "A.", "1", "Chapter 3:" so "A Index" or "12 References" still match. */
function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(chapter|appendix)\s+[\w.]+[:.\s-]*/i, "")
    .replace(/^[\divxlcA-Z]{1,4}[.)]?\s+/i, "")
    .replace(/[^\p{L}\p{N} '-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyTitle(title: string): "front" | "back" | null {
  const t = title.toLowerCase().replace(/\s+/g, " ").trim();
  const n = normalize(title);
  for (const re of FRONT) if (re.test(t) || re.test(n)) return "front";
  for (const re of BACK) if (re.test(t) || re.test(n)) return "back";
  return null;
}

/** Recognises pages that are front/back matter from their text alone. */
export function classifyPageText(text: string): "copyright" | "contents" | "index" | null {
  const t = text.toLowerCase();
  if (/(©|\(c\)|copyright)/.test(t) && /(all rights reserved|isbn|library of congress|printed in)/.test(t)) return "copyright";
  const lines = text.split(/\n+/).filter((l) => l.trim());
  if (/^\s*(table of )?contents\b/i.test(text)) {
    const withPageNums = lines.filter((l) => /(\.{3,}|\s)\d{1,4}\s*$/.test(l)).length;
    if (withPageNums >= 3) return "contents";
  }
  // Index pages: many short entries ending in page-number lists, e.g. "resistor, 6, 7".
  const indexEntries = text.split(/\n+|(?<=\d)\s+(?=[A-Za-z])/).filter((l) => /^[A-Za-z][^,]{1,60},\s*\d{1,4}(,\s*\d{1,4}|[-–]\d{1,4})*\s*$/.test(l.trim())).length;
  if (indexEntries >= 5) return "index";
  return null;
}
