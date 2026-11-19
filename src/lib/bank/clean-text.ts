/**
 * Cleans text read from College Board PDFs and screenshots before it reaches
 * the question bank: the page clutter of a Question Bank export (question IDs,
 * "Assessment / Test / Domain / Skill / Difficulty" headers, answer-key lines),
 * PDF extraction leftovers (ligatures, soft hyphens, zero-width and replacement
 * characters, odd spaces, words split across lines) and stray whitespace.
 *
 * Claude is asked for clean text too; this is the second line of defence, so
 * it only removes things that are never part of a real question.
 */

const LIGATURES: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };

/** Whole lines that are page furniture in College Board exports. */
const CLUTTER_LINES: RegExp[] = [
  /^question id\b.*$/i,
  /^id:\s*[0-9a-f]{6,}\b.*$/i,
  /^(assessment|test|domain|skill|difficulty)\s*:?\s*$/i,
  /^((assessment|test|domain|skill|difficulty)\s*){2,}$/i, // the header row of an export
  /^(sat|psat\/nmsqt|psat 10|psat 8\/9)$/i,
  /^(assessment|test|domain|skill|difficulty)\s*:?\s+(sat|psat.*|reading and writing|math|easy|medium|hard)\s*$/i,
  /^sat\s+(reading and writing|math)\s*$/i,
  /^correct answer\s*:?.*$/i,
  /^rationale\s*:?\s*$/i,
  /^question difficulty\s*:?.*$/i,
  /^page \d+( of \d+)?$/i,
  /^©?\s*\d{4}\s+college board.*$/i,
  /^copyright\b.*college board.*$/i,
  /^(collegeboard\.org|satsuite\.collegeboard\.org).*$/i,
];

export function cleanQuestionText(input: string): string {
  let s = input.normalize("NFC");
  s = s.replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c);
  s = s
    .replace(/\r\n?/g, "\n")
    .replace(/[­​-‍⁠﻿]/g, "") // soft hyphen, zero-width characters, BOM
    .replace(/�/g, "") // replacement character from a bad decode
    .replace(/[  -   　]/g, " ") // odd spaces
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "") // control characters
    .replace(/\t/g, " ");
  // Words hyphenated across a line break ("photo-\nsynthesis"), but not real dashes or list items.
  s = s.replace(/([a-z])-\n([a-z])/g, "$1$2");
  const lines = s.split("\n").map((l) => l.replace(/ {2,}/g, " ").trim());
  const kept = lines.filter((l) => !CLUTTER_LINES.some((re) => re.test(l)));
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A one-line field (a choice, a skill): clean, then fold line breaks into spaces. */
export function cleanInline(input: string): string {
  return cleanQuestionText(input).replace(/\s*\n\s*/g, " ").trim();
}

/** Strip a leading choice letter the reader may have kept ("A) 12", "(B) 12", "C. 12"). */
export function stripChoiceLetter(choice: string): string {
  return choice.replace(/^\(?[A-Da-d][).:]\s+/, "").trim();
}
