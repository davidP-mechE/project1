import os from "node:os";
import path from "node:path";
import { EMBEDDING_DIMS, EMBEDDING_MODEL, QUERY_INSTRUCTION } from "@/lib/tutor/embedding";
import type { Embedder } from "./types";

/**
 * Local embeddings with transformers.js (ONNX on the CPU). WORKER ONLY: the
 * runtime is large (~550 MB with its native libraries), so the web app never
 * imports this file; it asks the worker instead (see query.ts).
 * The model (~34 MB) is downloaded from Hugging Face on first use and cached.
 */
type Extractor = (texts: string[], opts: { pooling: "cls"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

export class LocalEmbedder implements Embedder {
  readonly model = EMBEDDING_MODEL;
  private extractor: Promise<Extractor> | null = null;

  constructor(private readonly opts: { cacheDir?: string } = {}) {}

  private load(): Promise<Extractor> {
    this.extractor ??= (async () => {
      const t = await import("@huggingface/transformers");
      // Outside the project folder by default: the dev server watches the project and would keep reloading.
      t.env.cacheDir = this.opts.cacheDir ?? path.join(os.homedir(), ".cache", "coursebook", "models");
      const pipe = await t.pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });
      return pipe as unknown as Extractor;
    })().catch((err) => {
      this.extractor = null; // try again next time (e.g. the download failed)
      throw err;
    });
    return this.extractor;
  }

  private async run(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.load();
    const out = (await extractor(texts, { pooling: "cls", normalize: true })).tolist();
    if (out.some((v) => v.length !== EMBEDDING_DIMS)) throw new Error("Unexpected embedding size");
    return out;
  }

  embedPassages(texts: string[]) {
    return this.run(texts.map((t) => t.slice(0, 4_000)));
  }

  async embedQuery(text: string) {
    return (await this.run([QUERY_INSTRUCTION + text.slice(0, 2_000)]))[0];
  }
}
