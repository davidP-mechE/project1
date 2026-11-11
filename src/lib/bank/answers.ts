/**
 * Checking answers to bank questions (pure, shared by the server and tests).
 *
 * Grid-ins follow the digital SAT's rules for student-produced responses:
 *  - equivalent forms are accepted: 3/4 = 0.75 = .75; 12.50 = 12.5; −5 = -5
 *  - for an answer that doesn't end (2/3), a decimal is accepted when it fills
 *    at least 3 decimal places and is either rounded or cut off: .666, .667, 0.6667
 *  - a shorter decimal (0.67) is not accepted for 2/3
 *  - mixed numbers ("1 1/2") are not valid entries
 * The stored answer may list several accepted answers separated by "|" or ";".
 */

const MINUS = /[−‒–—﹣－]/g;

/** Normalise what was typed: unicode minus signs, spaces, a leading "+". */
export function cleanEntry(raw: string): string {
  return raw.replace(MINUS, "-").replace(/\s+/g, "").replace(/^\+/, "").replace(/,(?=\d{3}(\D|$))/g, "");
}

type Parsed = { value: number; kind: "fraction" | "decimal" | "integer"; places: number };

/** Parse a grid-in entry: an integer, a decimal, or a fraction a/b (each part may be a decimal). */
export function parseEntry(raw: string): Parsed | null {
  const s = cleanEntry(raw);
  if (!s) return null;
  const frac = /^(-?)(\d+(?:\.\d+)?|\.\d+)\/(\d+(?:\.\d+)?|\.\d+)$/.exec(s);
  if (frac) {
    const den = Number(frac[3]);
    if (!den) return null;
    const v = Number(frac[2]) / den;
    return { value: frac[1] ? -v : v, kind: "fraction", places: 0 };
  }
  const dec = /^-?(\d+\.?\d*|\.\d+)$/.exec(s);
  if (!dec) return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  const places = s.includes(".") ? s.split(".")[1].length : 0;
  return { value: v, kind: places ? "decimal" : "integer", places };
}

const EPS = 1e-9;
const close = (a: number, b: number) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

function truncate(v: number, places: number) {
  const f = 10 ** places;
  return Math.trunc(v * f + (v >= 0 ? EPS : -EPS)) / f;
}
function round(v: number, places: number) {
  const f = 10 ** places;
  return Math.round((v + (v >= 0 ? EPS : -EPS)) * f) / f;
}

/** Does `given` match one accepted value? */
export function sameValue(given: string, accepted: string): boolean {
  const g = parseEntry(given);
  const a = parseEntry(accepted);
  if (!g || !a) return cleanEntry(given).toLowerCase() === cleanEntry(accepted).toLowerCase() && cleanEntry(given) !== "";
  if (close(g.value, a.value)) return true;
  // A decimal for a value that doesn't fit: at least 3 places, rounded or cut off.
  if (g.kind === "decimal" && g.places >= 3) {
    return close(g.value, truncate(a.value, g.places)) || close(g.value, round(a.value, g.places));
  }
  return false;
}

export const acceptedAnswers = (answer: string) =>
  answer
    .split(/[|;]/)
    .map((s) => s.trim())
    .filter(Boolean);

export function gridInCorrect(given: string, answer: string): boolean {
  if (/^\s*-?\d+\s+\d+\/\d+\s*$/.test(given.replace(MINUS, "-"))) return false; // mixed number
  return acceptedAnswers(answer).some((a) => sameValue(given, a));
}

export const LETTERS = ["A", "B", "C", "D"] as const;
export const letterIndex = (l: string) => LETTERS.indexOf(l.trim().toUpperCase() as (typeof LETTERS)[number]);

export type CheckResult = { correct: boolean; likelyMistake: string | null; normalized: string };

/**
 * Check an answer. For a wrong MCQ choice, or a wrong grid-in value that matches
 * one of the distractor notes' keys, return that note as the likely mistake.
 */
export function checkBankAnswer(q: { type: "mcq" | "grid_in"; answer: string; distractorNotes: unknown }, given: string): CheckResult {
  const notes = (q.distractorNotes && typeof q.distractorNotes === "object" ? q.distractorNotes : {}) as Record<string, unknown>;
  if (q.type === "mcq") {
    const letter = given.trim().toUpperCase();
    const correct = letter === q.answer.trim().toUpperCase();
    const note = !correct && typeof notes[letter] === "string" ? (notes[letter] as string) : null;
    return { correct, likelyMistake: note, normalized: letter };
  }
  const correct = gridInCorrect(given, q.answer);
  let note: string | null = null;
  if (!correct) {
    for (const [k, v] of Object.entries(notes)) {
      if (typeof v === "string" && sameValue(given, k)) {
        note = v;
        break;
      }
    }
  }
  return { correct, likelyMistake: note, normalized: cleanEntry(given) };
}
