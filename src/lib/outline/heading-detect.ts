import type { Line } from "@/lib/pdf/lines";
import type { OutlineEntry } from "./types";

/**
 * Finds chapter and section headings when the PDF has no bookmarks.
 * Idea: body text uses one common font size; headings are noticeably bigger.
 * The biggest heading size that repeats becomes "chapter", the next "section".
 */

export type PageLines = { pageNumber: number; lines: Line[] };

const round = (n: number) => Math.round(n * 2) / 2; // to the nearest 0.5pt

/** The font size used by the most characters. */
export function bodyFontSize(pages: PageLines[]): number {
  const counts = new Map<number, number>();
  for (const p of pages) for (const l of p.lines) counts.set(round(l.size), (counts.get(round(l.size)) ?? 0) + l.text.length);
  let best = 0;
  let bestCount = -1;
  for (const [size, count] of counts) if (count > bestCount) [best, bestCount] = [size, count];
  return best;
}

/** Text that appears on many pages (running headers/footers, page numbers) is not a heading. */
function repeatedLineKeys(pages: PageLines[]): Set<string> {
  const seen = new Map<string, Set<number>>();
  for (const p of pages) {
    for (const l of p.lines) {
      const key = l.text.toLowerCase().replace(/\d+/g, "#").trim();
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(p.pageNumber);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.2));
  return new Set([...seen.entries()].filter(([, s]) => s.size >= threshold).map(([k]) => k));
}

type Candidate = { text: string; size: number; page: number; y: number; startsAtTop: boolean };

function looksLikeHeadingText(text: string): boolean {
  if (text.length < 2 || text.length > 120) return false;
  if (!/\p{L}/u.test(text)) return false;
  if (/^(\d+|[ivxlc]+)$/i.test(text)) return false; // page number
  if (text.split(/\s+/).length > 16) return false;
  if (/[.,;:]$/.test(text) && !/^\d+(\.\d+)*\.$/.test(text)) return false; // sentence-like
  return true;
}

export function detectHeadings(pages: PageLines[]): OutlineEntry[] {
  const body = bodyFontSize(pages);
  if (!body) return [];
  const repeated = repeatedLineKeys(pages);

  // 1) Collect lines clearly bigger than body text, merging multi-line headings.
  const candidates: Candidate[] = [];
  for (const p of pages) {
    const content = p.lines.filter((l) => !repeated.has(l.text.toLowerCase().replace(/\d+/g, "#").trim()));
    const topY = content.length ? Math.max(...content.map((l) => l.y)) : 0;
    let prev: Candidate | null = null;
    for (const l of content) {
      if (l.size < body * 1.2 || !looksLikeHeadingText(l.text)) {
        prev = null;
        continue;
      }
      if (prev && Math.abs(prev.size - l.size) <= 0.5 && prev.y - l.y <= l.size * 1.6) {
        prev.text = `${prev.text} ${l.text}`; // second line of the same heading
        prev.y = l.y;
        continue;
      }
      prev = { text: l.text, size: round(l.size), page: p.pageNumber, y: l.y, startsAtTop: l.y >= topY - 0.5 };
      candidates.push(prev);
    }
  }
  if (candidates.length < 2) return [];

  // 2) Group sizes within 1pt of each other and rank them, biggest first.
  const sizes = [...new Set(candidates.map((c) => c.size))].sort((a, b) => b - a);
  const clusters: number[][] = [];
  for (const s of sizes) {
    const last = clusters.at(-1);
    if (last && last[0] - s <= 1) last.push(s);
    else clusters.push([s]);
  }
  const clusterOf = (size: number) => clusters.findIndex((c) => c.includes(size));
  const countIn = (i: number) => candidates.filter((c) => clusterOf(c.size) === i).length;

  // Ignore one-off giant text such as the title on the title page.
  const usable = clusters.map((_, i) => i).filter((i) => countIn(i) >= 2);
  if (usable.length === 0) return [];
  const [chapterCluster, sectionCluster] = usable;

  const entries: OutlineEntry[] = [];
  for (const c of candidates) {
    const cl = clusterOf(c.size);
    let level: 1 | 2 | null = cl === chapterCluster ? 1 : cl === sectionCluster ? 2 : null;
    // With only one heading size, use numbering to tell sections ("2.1 …") from chapters ("2 …").
    if (sectionCluster === undefined && level === 1 && /^\d+\.\d+\b/.test(c.text)) level = 2;
    if (level) entries.push({ title: c.text.replace(/\s+/g, " ").trim(), level, page: c.page, startsAtTop: c.startsAtTop });
  }
  return entries;
}
