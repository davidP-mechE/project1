import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createScheduler, createWorker, OEM, type Scheduler } from "tesseract.js";

/**
 * OCR with Tesseract (runs locally; nothing is sent to a third party).
 * English language data ships with the @tesseract.js-data/eng package, so no
 * download is needed at runtime.
 */

const langPath = path.join(
  path.dirname(createRequire(import.meta.url).resolve("@tesseract.js-data/eng/package.json")),
  "4.0.0_best_int",
);

export type OcrResult = { text: string; confidence: number };

export class OcrPool {
  private scheduler: Scheduler | null = null;

  constructor(private readonly workers = 2) {}

  private async ensure(): Promise<Scheduler> {
    if (this.scheduler) return this.scheduler;
    const scheduler = createScheduler();
    for (let i = 0; i < this.workers; i++) {
      const worker = await createWorker("eng", OEM.LSTM_ONLY, {
        langPath,
        gzip: true,
        cachePath: path.join(os.tmpdir(), "coursebook-tesseract"),
      });
      scheduler.addWorker(worker);
    }
    this.scheduler = scheduler;
    return scheduler;
  }

  async recognize(png: Buffer): Promise<OcrResult> {
    const scheduler = await this.ensure();
    const { data } = await scheduler.addJob("recognize", png);
    return { text: data.text, confidence: data.confidence };
  }

  async close() {
    await this.scheduler?.terminate();
    this.scheduler = null;
  }
}

/** Tidy OCR output: join hyphenated line breaks, keep blank lines as paragraph breaks. */
export function cleanOcrText(text: string): string {
  return text
    .replace(/([A-Za-z])-\n([a-z])/g, "$1$2")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}
