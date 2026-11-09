/**
 * Choosing the book passages the tutor answers from. Pure and unit-tested.
 *
 * Two searches run on the book's passages:
 *   - keyword (Postgres full text): good at exact terms ("Kirchhoff", "Thevenin")
 *   - meaning (embeddings): good at paraphrases ("why does current split at a junction")
 * They're combined with Reciprocal Rank Fusion: each passage scores
 * 1/(k + rank) in every list it appears in, so passages both searches like rise
 * to the top, without having to compare their very different raw scores.
 */

export type Candidate = { id: string; pageStart: number; pageEnd: number; tokenCount: number };
export type RankedList = string[]; // passage ids, best first

export const RRF_K = 60;
export const MAX_PASSAGES = 8;
export const MAX_CONTEXT_TOKENS = 6_000;
/** Below this cosine similarity, the best meaning match is probably not about the question. */
export const WEAK_SIMILARITY = 0.6;

export function reciprocalRankFusion(lists: RankedList[], k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return scores;
}

/**
 * Pick passages: best fused score first, a small boost for the lesson the
 * student is asking from, until the passage or token budget runs out.
 * Returned in book order, which reads better for the model.
 */
export function selectPassages(
  candidates: Candidate[],
  scores: Map<string, number>,
  opts: { focus?: { pageStart: number; pageEnd: number } | null; maxPassages?: number; maxTokens?: number } = {},
): Candidate[] {
  const focus = opts.focus;
  const boost = (c: Candidate) => (focus && c.pageEnd >= focus.pageStart && c.pageStart <= focus.pageEnd ? 1 / (RRF_K + 3) : 0);
  const ranked = candidates
    .filter((c) => scores.has(c.id))
    .map((c) => ({ c, score: scores.get(c.id)! + boost(c) }))
    .sort((a, b) => b.score - a.score || a.c.pageStart - b.c.pageStart);
  const chosen: Candidate[] = [];
  let tokens = 0;
  for (const { c } of ranked) {
    if (chosen.length >= (opts.maxPassages ?? MAX_PASSAGES)) break;
    if (tokens + c.tokenCount > (opts.maxTokens ?? MAX_CONTEXT_TOKENS) && chosen.length > 0) continue;
    chosen.push(c);
    tokens += c.tokenCount;
  }
  return chosen.sort((a, b) => a.pageStart - b.pageStart);
}

/** How sure we are the book has something on this: drives the "may not be in the book" hint. */
export function retrievalConfidence(input: { keywordHits: number; bestSimilarity: number | null }): "high" | "low" | "none" {
  const strongMeaning = input.bestSimilarity !== null && input.bestSimilarity >= WEAK_SIMILARITY;
  if (input.keywordHits === 0 && !strongMeaning) return input.bestSimilarity === null ? "none" : "low";
  return input.keywordHits > 0 && strongMeaning ? "high" : "low";
}

/** The pages a set of passages covers, e.g. for checking citations. */
export function pagesCovered(passages: { pageStart: number; pageEnd: number }[]): Set<number> {
  const pages = new Set<number>();
  for (const p of passages) for (let n = p.pageStart; n <= p.pageEnd && n - p.pageStart < 50; n++) pages.add(n);
  return pages;
}
