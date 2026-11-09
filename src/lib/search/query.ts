/**
 * Turns what a student types into a Postgres full-text query (to_tsquery syntax).
 * Pure and unit-tested. The result is always passed to the database as a
 * parameter, and only ever contains words made of letters/digits plus the
 * operators added here, so typed input can't change the query's meaning.
 *
 *   ohm law          → ohm & law:*         (all words; the last one as a prefix while typing)
 *   "ohm's law"      → (ohm <-> s <-> law) (exact phrase)
 *   current -alternating → current & !alternating
 *   resistor or capacitor → resistor | capacitor:*
 */

export const MAX_QUERY_LENGTH = 200;
const WORD = /[\p{L}\p{N}]+/gu;

type Term = { text: string; negate: boolean; phrase: boolean; or: boolean };

function words(s: string): string[] {
  return (s.toLowerCase().match(WORD) ?? []).slice(0, 12);
}

export function buildTsQuery(input: string): string | null {
  const raw = input.slice(0, MAX_QUERY_LENGTH);
  const terms: Term[] = [];
  const re = /(-?)"([^"]*)"|(-?)([^\s"]+)/g;
  let pendingOr = false;
  for (const m of raw.matchAll(re)) {
    if (m[2] !== undefined) {
      const ws = words(m[2]);
      if (ws.length === 0) continue;
      terms.push({ text: ws.length === 1 ? ws[0] : `(${ws.join(" <-> ")})`, negate: m[1] === "-", phrase: true, or: pendingOr });
      pendingOr = false;
      continue;
    }
    const token = m[4];
    if (/^(or|\|)$/i.test(token) && terms.length > 0) {
      pendingOr = true;
      continue;
    }
    const ws = words(token);
    if (ws.length === 0) continue;
    // "Ohm's" or "I-V" becomes a phrase of its parts.
    terms.push({ text: ws.length === 1 ? ws[0] : `(${ws.join(" <-> ")})`, negate: m[3] === "-", phrase: ws.length > 1, or: pendingOr });
    pendingOr = false;
    if (terms.length >= 12) break;
  }
  // A query of only exclusions matches nothing useful.
  if (!terms.some((t) => !t.negate)) return null;

  // Prefix-match the last plain word, so results appear while typing ("capac" finds "capacitor").
  const last = [...terms].reverse().find((t) => !t.negate && !t.phrase);
  if (last && last === terms[terms.length - 1] && last.text.length >= 2) last.text = `${last.text}:*`;

  let out = "";
  for (const t of terms) {
    const part = t.negate ? `!${t.text}` : t.text;
    out = out ? `${out} ${t.or && !t.negate ? "|" : "&"} ${part}` : part;
  }
  return out;
}

/**
 * Splits a ts_headline snippet (matches wrapped in \u0001…\u0002) into parts to
 * render with <mark>, without ever rendering the text as HTML.
 */
export function splitHighlights(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  for (const piece of snippet.split("\u0001")) {
    const [hit, rest] = piece.includes("\u0002") ? piece.split("\u0002", 2) : [null, piece];
    if (hit) parts.push({ text: hit, match: true });
    if (rest) parts.push({ text: rest, match: false });
  }
  // Tidy Markdown/LaTeX markers that show up in snippets of lesson text.
  return parts.map((p) => ({ ...p, text: p.text.replace(/\*\*|__|`|#{1,6}\s/g, "").replace(/\s+/g, " ") })).filter((p) => p.text.length > 0);
}
