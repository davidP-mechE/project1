import { db } from "../db";
import type { QueryEmbedder } from "../embeddings/types";
import { buildAnyWordTsQuery } from "@/lib/search/query";
import { toPgVector } from "@/lib/tutor/embedding";
import { reciprocalRankFusion, retrievalConfidence, selectPassages } from "@/lib/tutor/retrieval";

/**
 * Find the book passages that best answer a question: keyword search and
 * meaning search over the book's passages, combined (lib/tutor/retrieval.ts).
 * If the question can't be embedded right now, keyword search alone is used.
 * The caller has already checked the student owns the book.
 */
export type Passage = { id: string; pageStart: number; pageEnd: number; text: string };

const PER_LIST = 20;

export async function retrievePassages(input: {
  bookId: string;
  question: string;
  focus?: { pageStart: number; pageEnd: number } | null;
  embedder: QueryEmbedder;
}): Promise<{ passages: Passage[]; mode: "hybrid" | "keyword"; confidence: "high" | "low" | "none" }> {
  const tsq = buildAnyWordTsQuery(input.question);
  const [keyword, vector] = await Promise.all([
    tsq
      ? db.$queryRaw<{ id: string }[]>`
          SELECT ch.id FROM "Chunk" ch, to_tsquery('english', ${tsq}) q
          WHERE ch."bookId" = ${input.bookId} AND ch.tsv @@ q
          ORDER BY ts_rank_cd(ch.tsv, q) DESC, ch.ordinal
          LIMIT ${PER_LIST}`
      : Promise.resolve([]),
    input.embedder.embedQuery(input.question),
  ]);
  const semantic = vector
    ? await db.$queryRaw<{ id: string; sim: number }[]>`
        SELECT ch.id, 1 - (ch.embedding <=> ${toPgVector(vector)}::vector) AS sim FROM "Chunk" ch
        WHERE ch."bookId" = ${input.bookId} AND ch."embeddingModel" = ${input.embedder.model} AND ch.embedding IS NOT NULL
        ORDER BY ch.embedding <=> ${toPgVector(vector)}::vector
        LIMIT ${PER_LIST}`
    : [];

  const scores = reciprocalRankFusion([keyword.map((r) => r.id), semantic.map((r) => r.id)]);
  const ids = [...scores.keys()];
  const candidates = ids.length
    ? await db.chunk.findMany({ where: { id: { in: ids }, bookId: input.bookId }, select: { id: true, pageStart: true, pageEnd: true, tokenCount: true, text: true } })
    : [];
  const chosen = selectPassages(candidates, scores, { focus: input.focus });
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return {
    passages: chosen.map((c) => ({ id: c.id, pageStart: c.pageStart, pageEnd: c.pageEnd, text: byId.get(c.id)!.text })),
    mode: vector ? "hybrid" : "keyword",
    confidence: retrievalConfidence({ keywordHits: keyword.length, bestSimilarity: semantic[0]?.sim ?? null }),
  };
}
