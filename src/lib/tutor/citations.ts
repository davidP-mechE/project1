/**
 * Page citations in tutor answers, written by the model as [p. 12] or
 * [pp. 12–13]. Only pages from the passages it was given are allowed; any
 * other citation is removed, so the tutor can never point to a page it didn't
 * read. Pure and unit-tested.
 */

const CITE = /\[(pp?)\.\s*(\d{1,5})(?:\s*[–—-]\s*(\d{1,5}))?\]/g;

export function checkCitations(text: string, allowed: Set<number>): { text: string; pages: number[]; removed: number } {
  const pages = new Set<number>();
  let removed = 0;
  const cleaned = text.replace(CITE, (whole, _p: string, a: string, b?: string) => {
    const start = Number(a);
    const end = b ? Number(b) : start;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const ok: number[] = [];
    for (let n = lo; n <= hi && n - lo < 50; n++) if (allowed.has(n)) ok.push(n);
    if (ok.length === 0) {
      removed++;
      return "";
    }
    ok.forEach((n) => pages.add(n));
    // Keep a valid single page or range as written; shrink a partly-invalid range to the valid pages.
    if (ok.length === hi - lo + 1) return whole;
    return ok.length === 1 ? `[p. ${ok[0]}]` : `[pp. ${ok[0]}–${ok[ok.length - 1]}]`;
  });
  return { text: cleaned.replace(/[ \t]+([.,;:])/g, "$1").replace(/[ \t]{2,}/g, " "), pages: [...pages].sort((x, y) => x - y), removed };
}

/** The sentence the model is told to start with when the book doesn't cover the question. */
export const NOT_IN_BOOK = "The book doesn't cover this.";
export const saysNotInBook = (answer: string) => answer.trimStart().toLowerCase().startsWith(NOT_IN_BOOK.toLowerCase().slice(0, -1));
