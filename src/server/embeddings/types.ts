/** Turns text into meaning vectors. The real one runs in the worker (local.ts); tests use a fake. */
export interface Embedder {
  readonly model: string;
  embedPassages(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

/** What the web app uses for questions: may return null (worker busy or down), then search is keyword-only. */
export interface QueryEmbedder {
  readonly model: string;
  embedQuery(text: string): Promise<number[] | null>;
}
