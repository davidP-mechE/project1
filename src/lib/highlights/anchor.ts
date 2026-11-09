/**
 * Anchoring highlights to lesson text by quote, not by position:
 * { exact, prefix, suffix } is the highlighted text plus a little context.
 * To show a highlight again, find `exact` in the current text, preferring the
 * occurrence whose surroundings best match. If the lesson was rewritten and
 * the text is gone, the highlight is "orphaned" (kept, listed on the Notes page).
 * Pure and unit-tested; the browser part is in components/study/highlights.tsx.
 */

export const CONTEXT_CHARS = 32;
export const MAX_HIGHLIGHT_CHARS = 2_000;

export type Anchor = { exact: string; prefix: string; suffix: string };

export function describeRange(text: string, start: number, end: number): Anchor | null {
  // Trim whitespace at the edges of the selection.
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end <= start || end - start > MAX_HIGHLIGHT_CHARS) return null;
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(end, end + CONTEXT_CHARS),
  };
}

function commonSuffix(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefix(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Where the anchor is in `text` now, or null if the quoted text no longer appears. */
export function locate(text: string, anchor: Anchor): { start: number; end: number } | null {
  if (!anchor.exact) return null;
  let best: { start: number; score: number } | null = null;
  for (let i = text.indexOf(anchor.exact); i !== -1; i = text.indexOf(anchor.exact, i + 1)) {
    const before = text.slice(Math.max(0, i - anchor.prefix.length), i);
    const after = text.slice(i + anchor.exact.length, i + anchor.exact.length + anchor.suffix.length);
    const score = commonSuffix(before, anchor.prefix) + commonPrefix(after, anchor.suffix);
    if (!best || score > best.score) best = { start: i, score };
  }
  return best ? { start: best.start, end: best.start + anchor.exact.length } : null;
}
