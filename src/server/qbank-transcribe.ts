import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { BATCH_DISCOUNT, costUsd, MODEL_PRICES, isKnownModel } from "@/lib/ai/models";
import { QbankFileSchema, QbankItemSchema, type QbankItem } from "@/lib/bank/qbank";
import { TRANSCRIBE_FORMAT, TRANSCRIBE_SYSTEM, TranscriptSchema, transcribeUserText, type Transcript } from "@/lib/bank/transcribe";

/**
 * Transcribing the Question Bank's image-only items into text
 * (npm run transcribe:bank). Results go to a file next to the bank
 * (qbank_transcriptions.json, never committed); npm run import:bank then uses
 * them. Whole runs go through the Message Batches API (half price).
 */

export const RESULTS_FILE = "qbank_transcriptions.json";
export const STATE_FILE = "qbank_transcribe_state.json";
const MAX_TOKENS = 16_000;
/** Keep each batch well under the API's request-size limit. */
const BATCH_BYTES = 150 * 1024 * 1024;

export type TranscribeConfig = { model: string; effort: "low" | "medium" | "high" | "xhigh" | "max" };
export type ItemResult = { transcript: Transcript | null; error: string | null; model: string; costUsd: number };
export type ResultsFile = { format: typeof TRANSCRIBE_FORMAT; version: 1; model: string; items: Record<string, ItemResult> };

/** The items that are images only: every math item, and reading items printed as an image. */
export function needsTranscription(item: QbankItem) {
  return Boolean(item.question_image);
}

export async function readBank(dir: string): Promise<QbankItem[]> {
  const file = QbankFileSchema.parse(JSON.parse(await fs.readFile(path.join(dir, "coursebook_sat_question_bank.json"), "utf8")));
  return file.items.flatMap((raw) => {
    const r = QbankItemSchema.safeParse(raw);
    return r.success ? [r.data] : [];
  });
}

export async function readResults(dir: string): Promise<ResultsFile | null> {
  try {
    const f = JSON.parse(await fs.readFile(path.join(dir, RESULTS_FILE), "utf8")) as ResultsFile;
    return f.format === TRANSCRIBE_FORMAT ? f : null;
  } catch {
    return null;
  }
}

export async function writeResults(dir: string, f: ResultsFile) {
  await fs.writeFile(path.join(dir, RESULTS_FILE), JSON.stringify(f));
}

/** One item's request: its image(s) and instructions; the reply follows TranscriptSchema. */
export async function requestFor(item: QbankItem, imageDir: string, cfg: TranscribeConfig): Promise<Anthropic.MessageCreateParamsNonStreaming> {
  const img = async (name: string): Promise<Anthropic.ImageBlockParam> => ({
    type: "image",
    source: { type: "base64", media_type: "image/webp", data: (await fs.readFile(path.join(imageDir, name))).toString("base64") },
  });
  const rationale = item.section === "math" && item.rationale_image ? item.rationale_image : null;
  const content: Anthropic.ContentBlockParam[] = [await img(item.question_image!), ...(rationale ? [await img(rationale)] : []), { type: "text", text: transcribeUserText(item, Boolean(rationale)) }];
  return {
    model: cfg.model,
    max_tokens: MAX_TOKENS,
    // The instructions never change, so they're cached across every request.
    system: [{ type: "text", text: TRANSCRIBE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(TranscriptSchema), effort: cfg.effort },
  };
}

function readMessage(m: Anthropic.Message, batch: boolean): ItemResult {
  const u = m.usage;
  const cost = costUsd(m.model, u.input_tokens, u.output_tokens, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0, batch);
  if (m.stop_reason === "refusal") return { transcript: null, error: "Claude declined to transcribe this item.", model: m.model, costUsd: cost };
  if (m.stop_reason === "max_tokens") return { transcript: null, error: "The reply was cut off (too long).", model: m.model, costUsd: cost };
  const text = m.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = TranscriptSchema.safeParse((() => { try { return JSON.parse(text); } catch { return null; } })());
  return parsed.success ? { transcript: parsed.data, error: null, model: m.model, costUsd: cost } : { transcript: null, error: "The reply couldn't be read.", model: m.model, costUsd: cost };
}

/** Transcribe a few items right away (not batched): to check quality before a full run. */
export async function transcribeNow(client: Anthropic, items: QbankItem[], imageDir: string, cfg: TranscribeConfig, concurrency = 4): Promise<Record<string, ItemResult>> {
  const out: Record<string, ItemResult> = {};
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(
      items.slice(i, i + concurrency).map(async (it) => {
        try {
          const m = await client.messages.stream(await requestFor(it, imageDir, cfg)).finalMessage();
          out[it.question_id] = readMessage(m, false);
        } catch (err) {
          out[it.question_id] = { transcript: null, error: err instanceof Error ? err.message.slice(0, 200) : "Request failed.", model: cfg.model, costUsd: 0 };
        }
      }),
    );
  }
  return out;
}

/** Send items as one or more batches (split by size). Returns the batch ids. */
export async function submitBatches(client: Anthropic, items: QbankItem[], imageDir: string, cfg: TranscribeConfig, log: (m: string) => void): Promise<string[]> {
  const ids: string[] = [];
  let chunk: Anthropic.Messages.Batches.BatchCreateParams.Request[] = [];
  let bytes = 0;
  const flush = async () => {
    if (!chunk.length) return;
    const b = await client.messages.batches.create({ requests: chunk });
    ids.push(b.id);
    log(`submitted batch ${b.id} (${chunk.length} items)`);
    chunk = [];
    bytes = 0;
  };
  for (const it of items) {
    const params = await requestFor(it, imageDir, cfg);
    const size = JSON.stringify(params).length;
    if (bytes + size > BATCH_BYTES) await flush();
    chunk.push({ custom_id: it.question_id, params });
    bytes += size;
  }
  await flush();
  return ids;
}

export async function batchesDone(client: Anthropic, ids: string[]) {
  const all = await Promise.all(ids.map((id) => client.messages.batches.retrieve(id)));
  return { done: all.every((b) => b.processing_status === "ended"), counts: all.map((b) => b.request_counts) };
}

export async function collectBatches(client: Anthropic, ids: string[]): Promise<Record<string, ItemResult>> {
  const out: Record<string, ItemResult> = {};
  for (const id of ids) {
    for await (const r of await client.messages.batches.results(id)) {
      if (r.result.type === "succeeded") out[r.custom_id] = readMessage(r.result.message, true);
      else out[r.custom_id] = { transcript: null, error: `Batch request ${r.result.type}.`, model: "", costUsd: 0 };
    }
  }
  return out;
}

// ─── Cost estimate ────────────────────────────────────────────────────────

/** Width and height of a WebP file (VP8, VP8L or VP8X), or null. */
export function webpSize(b: Buffer): { w: number; h: number } | null {
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (kind === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** Image tokens as the API counts them (about width × height / 750, after shrinking big images). */
export function imageTokens(w: number, h: number) {
  const scale = Math.min(1, 1568 / Math.max(w, h), Math.sqrt(1_150_000 / (w * h)));
  return Math.ceil((w * scale * (h * scale)) / 750);
}

/** A cost range for transcribing these items in a batch: output (with thinking) is the uncertain part. */
export async function estimate(items: QbankItem[], imageDir: string, cfg: TranscribeConfig) {
  let input = 0;
  for (const it of items) {
    for (const name of [it.question_image, it.section === "math" ? it.rationale_image : null]) {
      if (!name) continue;
      const s = webpSize(await fs.readFile(path.join(imageDir, name)));
      input += s ? imageTokens(s.w, s.h) : 800;
    }
    input += 400; // the question text and instructions (the system prompt is cached)
  }
  const math = items.filter((i) => i.section === "math").length;
  const reading = items.length - math;
  const low = math * 900 + reading * 500;
  const high = math * 3_000 + reading * 1_500;
  const p = isKnownModel(cfg.model) ? MODEL_PRICES[cfg.model] : MODEL_PRICES["claude-opus-5-5"];
  const usd = (out: number) => ((input * p.input + out * p.output) / 1_000_000) * BATCH_DISCOUNT;
  return { items: items.length, math, reading, inputTokens: input, outputTokens: { low, high }, usd: { low: usd(low), high: usd(high) } };
}
