import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { BATCH_DISCOUNT, costUsd, isKnownModel, MODEL_PRICES } from "@/lib/ai/models";
import {
  BlueprintFileSchema,
  decide,
  difficultySplit,
  GENERATE_SYSTEM,
  generateUserText,
  GENERATED_FORMAT,
  GenerationSchema,
  planRequests,
  similarity,
  SLOTS_PER_REQUEST,
  StyleSpecSchema,
  toImportRecord,
  VERIFY_SYSTEM,
  verifyUserText,
  VerdictSchema,
  type Blueprint,
  type GeneratedItem,
  type GenRequest,
  type Slot,
  type StyleSpec,
  type Verdict,
} from "@/lib/bank/generate";

/**
 * Running the question writer (npm run generate:bank): write questions from
 * the blueprints, solve each one cold in a separate request, keep the ones
 * that pass. Working files live in data/generated/ (not committed); the kept
 * questions go to data/questions/1600-generated-questions.json as drafts.
 */

export const WORK_DIR = "data/generated";
export const RESULTS_FILE = "qgen_results.json";
export const STATE_FILE = "qgen_state.json";
export const REPORT_FILE = "qgen_report.json";
export const OUTPUT_FILE = "data/questions/1600-generated-questions.json";
const BATCH_BYTES = 150 * 1024 * 1024;

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/** effort: easy and medium questions; hardEffort: requests for hard questions (they need more reasoning to be genuinely hard). */
export type GenConfig = { model: string; effort: Effort; hardEffort: Effort; verifyEffort: Effort };
type Cost = { costUsd: number; error: string | null };
export type GenResult = Cost & { items: GeneratedItem[] | null };
export type VerifyResult = Cost & { verdict: Verdict | null };
export type ResultsFile = { format: typeof GENERATED_FORMAT; version: 1; model: string; generated: Record<string, GenResult>; verdicts: Record<string, VerifyResult> };

export async function readBlueprints(file = "data/blueprints/sat-blueprints.json"): Promise<Blueprint[]> {
  return BlueprintFileSchema.parse(JSON.parse(await fs.readFile(file, "utf8"))).blueprints;
}

let spec: StyleSpec | null | undefined;
/** The measured style targets (data/blueprints/rw-style-spec.json), if the file is there. */
export async function readSpec(file = "data/blueprints/rw-style-spec.json"): Promise<StyleSpec | null> {
  if (spec !== undefined) return spec;
  try {
    spec = StyleSpecSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    spec = null;
  }
  return spec;
}

export async function readResults(): Promise<ResultsFile> {
  try {
    return JSON.parse(await fs.readFile(path.join(WORK_DIR, RESULTS_FILE), "utf8")) as ResultsFile;
  } catch {
    return { format: GENERATED_FORMAT, version: 1, model: "", generated: {}, verdicts: {} };
  }
}

export async function writeResults(r: ResultsFile) {
  await fs.mkdir(WORK_DIR, { recursive: true });
  await fs.writeFile(path.join(WORK_DIR, RESULTS_FILE), `${JSON.stringify(r, null, 1)}\n`);
}

/** Every generated question, keyed by its slot. */
export function itemsBySlot(r: ResultsFile): Map<string, GeneratedItem> {
  const m = new Map<string, GeneratedItem>();
  for (const g of Object.values(r.generated)) for (const it of g.items ?? []) m.set(it.slot, it);
  return m;
}

/** The planned slots that don't have a question yet, regrouped into requests. */
export function requestsToDo(blueprints: Blueprint[], r: ResultsFile, only?: string[]): GenRequest[] {
  const have = itemsBySlot(r);
  const out: GenRequest[] = [];
  for (const req of planRequests(blueprints)) {
    if (only && !only.includes(req.blueprint)) continue;
    const slots = req.slots.filter((s) => !have.has(s.slot));
    if (slots.length) out.push({ ...req, id: `gen-${slots[0].slot}`, slots });
  }
  return out;
}

export function allSlots(blueprints: Blueprint[]): Map<string, Slot> {
  return new Map(planRequests(blueprints).flatMap((q) => q.slots.map((s) => [s.slot, s] as const)));
}

// ─── Requests ─────────────────────────────────────────────────────────────

export function genParams(bp: Blueprint, req: GenRequest, cfg: GenConfig, style: StyleSpec | null = spec ?? null): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: cfg.model,
    max_tokens: 32_000,
    system: [{ type: "text", text: GENERATE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: generateUserText(bp, req.slots, style) }],
    output_config: { format: zodOutputFormat(GenerationSchema), effort: req.slots.some((x) => x.difficulty === 3) ? cfg.hardEffort : cfg.effort },
  };
}

export function verifyParams(bp: Blueprint, item: GeneratedItem, cfg: GenConfig): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: cfg.model,
    max_tokens: 16_000,
    system: [{ type: "text", text: VERIFY_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: verifyUserText(item.skill, bp.section, item) }],
    output_config: { format: zodOutputFormat(VerdictSchema), effort: cfg.verifyEffort },
  };
}

function textOf(m: Anthropic.Message) {
  return m.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function costOf(m: Anthropic.Message, batch: boolean) {
  const u = m.usage;
  return costUsd(m.model, u.input_tokens, u.output_tokens, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0, batch);
}

function parse<T>(m: Anthropic.Message, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }): { data: T | null; error: string | null } {
  if (m.stop_reason === "refusal") return { data: null, error: "Claude declined." };
  if (m.stop_reason === "max_tokens") return { data: null, error: "The reply was cut off." };
  let raw: unknown = null;
  try {
    raw = JSON.parse(textOf(m));
  } catch {
    return { data: null, error: "The reply couldn't be read." };
  }
  const p = schema.safeParse(raw);
  return p.success ? { data: p.data, error: null } : { data: null, error: "The reply didn't match the format." };
}

export function readGen(m: Anthropic.Message, req: GenRequest | undefined, batch: boolean): GenResult {
  const { data, error } = parse(m, GenerationSchema);
  // Keep only items for slots this request asked for, one each.
  const wanted = new Set(req?.slots.map((s) => s.slot) ?? []);
  // A one-question request whose answer carries the wrong slot id is still that slot's question.
  if (data && req?.slots.length === 1 && data.items.length === 1) data.items[0].slot = req.slots[0].slot;
  const items = data ? data.items.filter((it, i, all) => wanted.has(it.slot) && all.findIndex((x) => x.slot === it.slot) === i) : null;
  return { items, error, costUsd: costOf(m, batch) };
}

export function readVerify(m: Anthropic.Message, batch: boolean): VerifyResult {
  const { data, error } = parse(m, VerdictSchema);
  return { verdict: data, error, costUsd: costOf(m, batch) };
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(fn));
}

const failed = (err: unknown): Cost => ({ costUsd: 0, error: err instanceof Error ? err.message.slice(0, 200) : "Request failed." });

/** Right away (not batched): for a quality sample. */
export async function generateNow(client: Anthropic, bps: Map<string, Blueprint>, reqs: GenRequest[], cfg: GenConfig, out: Record<string, GenResult>) {
  await pool(reqs, 4, async (req) => {
    try {
      out[req.id] = readGen(await client.messages.stream(genParams(bps.get(req.blueprint)!, req, cfg)).finalMessage(), req, false);
    } catch (err) {
      out[req.id] = { items: null, ...failed(err) };
    }
  });
}

export async function verifyNow(client: Anthropic, bps: Map<string, Blueprint>, items: GeneratedItem[], slots: Map<string, Slot>, cfg: GenConfig, out: Record<string, VerifyResult>) {
  await pool(items, 4, async (it) => {
    try {
      out[it.slot] = readVerify(await client.messages.stream(verifyParams(bps.get(slots.get(it.slot)!.blueprint)!, it, cfg)).finalMessage(), false);
    } catch (err) {
      out[it.slot] = { verdict: null, ...failed(err) };
    }
  });
}

export async function submit(client: Anthropic, requests: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming }[], log: (m: string) => void): Promise<string[]> {
  const ids: string[] = [];
  let chunk: typeof requests = [];
  let bytes = 0;
  const flush = async () => {
    if (!chunk.length) return;
    const b = await client.messages.batches.create({ requests: chunk });
    ids.push(b.id);
    log(`submitted batch ${b.id} (${chunk.length} requests)`);
    chunk = [];
    bytes = 0;
  };
  for (const r of requests) {
    const size = JSON.stringify(r).length;
    if (bytes + size > BATCH_BYTES || chunk.length >= 10_000) await flush();
    chunk.push(r);
    bytes += size;
  }
  await flush();
  return ids;
}

export async function waitFor(client: Anthropic, ids: string[], log: (m: string) => void) {
  for (;;) {
    const all = await Promise.all(ids.map((id) => client.messages.batches.retrieve(id)));
    const c = all.reduce((a, b) => ({ p: a.p + b.request_counts.processing, s: a.s + b.request_counts.succeeded, e: a.e + b.request_counts.errored }), { p: 0, s: 0, e: 0 });
    log(`${new Date().toISOString().slice(11, 19)} processing ${c.p}, done ${c.s}, errored ${c.e}`);
    if (all.every((b) => b.processing_status === "ended")) return;
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

export async function results(client: Anthropic, ids: string[], read: (id: string, m: Anthropic.Message) => void, fail: (id: string, why: string) => void) {
  for (const id of ids) {
    for await (const r of await client.messages.batches.results(id)) {
      if (r.result.type === "succeeded") read(r.custom_id, r.result.message);
      else fail(r.custom_id, `Batch request ${r.result.type}.`);
    }
  }
}

// ─── Cost estimate ────────────────────────────────────────────────────────

/** A range: output (with thinking) is the uncertain part. System prompts are cached. */
export function estimate(genRequests: number, genItems: number, verifyItems: number, cfg: GenConfig) {
  const p = isKnownModel(cfg.model) ? MODEL_PRICES[cfg.model] : MODEL_PRICES["claude-opus-5-5"];
  const input = genRequests * 900 + verifyItems * 700;
  const out = { low: genItems * 1_500 + verifyItems * 1_000, high: genItems * 4_000 + verifyItems * 3_000 };
  const usd = (o: number) => ((input * p.input + o * p.output) / 1_000_000) * BATCH_DISCOUNT;
  return { input, out, usd: { low: usd(out.low), high: usd(out.high) } };
}

// ─── Picking the questions to keep ────────────────────────────────────────

export type Assembly = { kept: number; byBlueprint: Record<string, { want: number; kept: number; rejected: number }>; rejected: { slot: string; reasons: string[] }[]; records: Record<string, unknown>[] };

export function assemble(blueprints: Blueprint[], r: ResultsFile): Assembly {
  const items = itemsBySlot(r);
  const slots = allSlots(blueprints);
  const out: Assembly = { kept: 0, byBlueprint: {}, rejected: [], records: [] };
  for (const bp of blueprints) {
    const split = difficultySplit(bp.count);
    const stat = { want: bp.count, kept: 0, rejected: 0 };
    const keptStems: string[] = [];
    let n = 0;
    for (const d of [1, 2, 3] as const) {
      let taken = 0;
      const mine = [...slots.values()].filter((s) => s.blueprint === bp.id && s.difficulty === d);
      for (const s of mine) {
        const it = items.get(s.slot);
        if (!it) continue;
        const dec = decide(it, bp, s, r.verdicts[s.slot]?.verdict ?? null);
        if (dec.keep && keptStems.some((k) => similarity(k, it.stem) > 0.5)) {
          dec.reasons.push("Too close to another kept question.");
          dec.keep = false;
        }
        if (!dec.keep) {
          stat.rejected++;
          out.rejected.push({ slot: s.slot, reasons: dec.reasons });
          continue;
        }
        if (taken >= split[d]) continue; // spare
        taken++;
        keptStems.push(it.stem);
        out.records.push(toImportRecord(`GEN-${bp.id}-${String(++n).padStart(3, "0")}`, it, bp, s, r.verdicts[s.slot]?.verdict ?? null));
      }
      stat.kept += taken;
    }
    out.kept += stat.kept;
    out.byBlueprint[bp.id] = stat;
  }
  return out;
}

export { SLOTS_PER_REQUEST };
