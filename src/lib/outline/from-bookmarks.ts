import type { OutlineEntry } from "./types";

/** A PDF bookmark after we've resolved its destination to a page. */
export type Bookmark = { title: string; page: number | null; startsAtTop: boolean; children: Bookmark[] };

const PART = /^part\s+([ivxlc]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;

function clean(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

/**
 * Many big textbooks group chapters into "Part I, Part II…". Parts are too
 * big to be units, so if the top level is mostly parts (or a few wrappers
 * whose children have their own children), we use the next level down.
 */
function unwrapParts(top: Bookmark[]): Bookmark[] {
  if (top.length === 0) return top;
  const withChildren = top.filter((b) => b.children.length > 0);
  const parts = top.filter((b) => PART.test(clean(b.title)) && b.children.length > 0);
  const wrapperLike =
    top.length <= 3 && withChildren.length === top.length && withChildren.every((b) => b.children.some((c) => c.children.length > 0));
  if (parts.length >= Math.ceil(withChildren.length / 2) && parts.length > 0) {
    return top.flatMap((b) => (PART.test(clean(b.title)) && b.children.length > 0 ? b.children : [b]));
  }
  if (wrapperLike) return top.flatMap((b) => b.children);
  return top;
}

/** Converts the PDF bookmark tree into a flat list of chapter (level 1) and section (level 2) entries. */
export function entriesFromBookmarks(bookmarks: Bookmark[], pageCount: number): OutlineEntry[] {
  let top = bookmarks;
  // A single root bookmark (often the book title) wrapping everything: skip it.
  if (top.length === 1 && top[0].children.length > 1) top = top[0].children;
  top = unwrapParts(top);

  const entries: OutlineEntry[] = [];
  const valid = (b: Bookmark) => b.page !== null && b.page >= 1 && b.page <= pageCount && clean(b.title).length > 0;
  for (const chapter of top) {
    const sections = chapter.children.filter(valid);
    // A chapter bookmark without its own destination takes its first section's page.
    const page = valid(chapter) ? chapter.page! : sections[0]?.page;
    if (!page || clean(chapter.title).length === 0) continue;
    entries.push({ title: clean(chapter.title), level: 1, page, startsAtTop: valid(chapter) ? chapter.startsAtTop : true });
    for (const s of sections) {
      entries.push({ title: clean(s.title), level: 2, page: s.page!, startsAtTop: s.startsAtTop });
    }
  }
  // Bookmarks are occasionally out of order; keep reading order by page, stable for ties.
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.page - b.e.page || a.i - b.i)
    .map(({ e }) => e);
}
