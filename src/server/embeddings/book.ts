import { db } from "../db";
import { EMBEDDING_MODEL, toPgVector } from "@/lib/tutor/embedding";
import type { Embedder } from "./types";

/**
 * Give every passage of a book a meaning vector (runs in the worker after a
 * book is processed). Resumable: only passages not yet embedded with the
 * current model are done, in small batches, so a crash or restart continues
 * where it stopped and the tutor can use what's ready meanwhile.
 */
export async function embedBook(bookId: string, embedder: Embedder, opts: { batch?: number } = {}) {
  const batch = opts.batch ?? 16;
  let done = 0;
  for (;;) {
    const chunks = await db.chunk.findMany({
      where: { bookId, OR: [{ embeddingModel: null }, { embeddingModel: { not: embedder.model } }] },
      orderBy: { ordinal: "asc" },
      take: batch,
      select: { id: true, text: true },
    });
    if (chunks.length === 0) return done;
    const vectors = await embedder.embedPassages(chunks.map((c) => c.text));
    await db.$transaction(
      chunks.map((c, i) => db.$executeRaw`UPDATE "Chunk" SET embedding = ${toPgVector(vectors[i])}::vector, "embeddingModel" = ${embedder.model} WHERE id = ${c.id}`),
    );
    done += chunks.length;
  }
}

/** Books with passages that still need (re-)embedding, e.g. books processed before Phase 7. */
export async function booksNeedingEmbeddings(model = EMBEDDING_MODEL) {
  const rows = await db.chunk.findMany({
    where: { OR: [{ embeddingModel: null }, { embeddingModel: { not: model } }], book: { status: "READY" } },
    distinct: ["bookId"],
    select: { bookId: true },
  });
  return rows.map((r) => r.bookId);
}

/** How much of a book is ready for meaning search (0–1), for the tutor's status line. */
export async function embeddingProgress(bookId: string, model = EMBEDDING_MODEL) {
  const [total, ready] = await Promise.all([db.chunk.count({ where: { bookId } }), db.chunk.count({ where: { bookId, embeddingModel: model } })]);
  return total === 0 ? 1 : ready / total;
}
