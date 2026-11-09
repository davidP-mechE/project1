/**
 * Splits the book's text into overlapping passages ("chunks") of about
 * 400 tokens, remembering which pages each one came from. These power search
 * and the "Ask the book" tutor, which cites the chunk's pages.
 */

export type PageText = { pageNumber: number; text: string };
export type Chunk = { ordinal: number; pageStart: number; pageEnd: number; text: string; tokenCount: number };

/** Rough token count: English averages about 4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type Piece = { text: string; page: number };

/** Break a paragraph that is too long into sentence groups (or hard-cut very long sentences). */
function splitLong(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (estimateTokens(s) > maxTokens) {
      if (cur) {
        out.push(cur.trim());
        cur = "";
      }
      for (let i = 0; i < s.length; i += maxTokens * 4) out.push(s.slice(i, i + maxTokens * 4).trim());
      continue;
    }
    if (estimateTokens(cur + s) > maxTokens && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function chunkPages(
  pages: PageText[],
  opts: { maxTokens?: number; overlapTokens?: number } = {},
): Chunk[] {
  const maxTokens = opts.maxTokens ?? 400;
  const overlapTokens = opts.overlapTokens ?? 50;

  const pieces: Piece[] = [];
  for (const p of pages) {
    for (const para of p.text.split(/\n{2,}/)) {
      const t = para.replace(/\s+/g, " ").trim();
      if (!t) continue;
      for (const part of splitLong(t, maxTokens)) pieces.push({ text: part, page: p.pageNumber });
    }
  }

  const chunks: Chunk[] = [];
  let current: Piece[] = [];
  const tokensOf = (ps: Piece[]) => estimateTokens(ps.map((p) => p.text).join("\n\n"));

  const flush = () => {
    if (current.length === 0) return;
    const text = current.map((p) => p.text).join("\n\n");
    chunks.push({
      ordinal: chunks.length,
      pageStart: Math.min(...current.map((p) => p.page)),
      pageEnd: Math.max(...current.map((p) => p.page)),
      text,
      tokenCount: estimateTokens(text),
    });
    // Carry the last paragraph(s) forward (up to overlapTokens) so ideas that span a boundary aren't lost.
    const carry: Piece[] = [];
    for (let i = current.length - 1; i >= 0; i--) {
      if (tokensOf([current[i], ...carry]) > overlapTokens) break;
      carry.unshift(current[i]);
    }
    current = carry.length === current.length ? [] : carry;
  };

  for (const piece of pieces) {
    if (current.length > 0 && tokensOf([...current, piece]) > maxTokens) flush();
    current.push(piece);
  }
  // Only flush the tail if it adds something beyond the overlap already in the previous chunk.
  const prev = chunks.at(-1);
  if (current.length > 0 && !(prev && current.every((p) => prev.text.includes(p.text)))) flush();
  return chunks;
}
