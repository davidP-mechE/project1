/**
 * The embedding model used to find passages by meaning (Phase 7).
 * bge-small-en-v1.5: small (34 MB quantized), runs on CPU in the worker, free,
 * and nothing leaves the server. Changing EMBEDDING_MODEL makes the worker
 * re-embed every book (chunks remember which model embedded them).
 */
export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBEDDING_DIMS = 384;
/** bge models retrieve better when the question (not the passages) carries this instruction. */
export const QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: ";

/** pgvector's text format: "[0.1,0.2,...]". Only ever built from numbers. */
export function toPgVector(v: number[]): string {
  if (v.length !== EMBEDDING_DIMS || !v.every((x) => Number.isFinite(x))) throw new Error("Invalid embedding");
  return `[${v.map((x) => x.toFixed(6)).join(",")}]`;
}
