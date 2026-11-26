/**
 * Turn the Question Bank's image-only items into text with Claude (math as LaTeX).
 *
 *   npm run transcribe:bank -- --dry-run      what would be sent, and a cost estimate (no API calls)
 *   npm run transcribe:bank -- --sample 20    transcribe 20 items now (not batched) to check quality
 *   npm run transcribe:bank                   send everything not done yet as a batch (half price), wait, save
 *   npm run transcribe:bank -- --collect      pick up a batch sent earlier (if the command was stopped)
 *   npm run transcribe:bank -- --only id,id   just these question ids (with --sample)
 *
 * Needs COURSEBOOK_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY). Results go to data/course-packets/qbank_transcriptions.json (never committed);
 * then run npm run import:bank to use them. Model: CLAUDE_MODEL_TRANSCRIBE (default claude-opus-5-5),
 * effort: CLAUDE_EFFORT_TRANSCRIBE (default medium).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeAcceptedList } from "@/lib/bank/qbank";
import { checkTranscript, TRANSCRIBE_FORMAT } from "@/lib/bank/transcribe";
import { batchesDone, collectBatches, estimate, needsTranscription, readBank, readResults, STATE_FILE, submitBatches, transcribeNow, writeResults, type ItemResult, type ResultsFile, type TranscribeConfig } from "@/server/qbank-transcribe";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string) => process.argv.includes(name);

async function main() {
  const dir = arg("--dir") ?? "data/course-packets";
  const imageDir = path.join(dir, "qbank_images");
  const cfg: TranscribeConfig = { model: process.env.CLAUDE_MODEL_TRANSCRIBE || "claude-opus-5-5", effort: (process.env.CLAUDE_EFFORT_TRANSCRIBE as TranscribeConfig["effort"]) || "medium" };
  const bank = (await readBank(dir)).filter(needsTranscription);
  const results: ResultsFile = (await readResults(dir)) ?? { format: TRANSCRIBE_FORMAT, version: 1, model: cfg.model, items: {} };
  const done = new Set(Object.entries(results.items).filter(([, r]) => r.transcript).map(([id]) => id));
  const only = arg("--only")?.split(",").map((s) => s.trim());
  const todo = bank.filter((i) => (only ? only.includes(i.question_id) : !done.has(i.question_id)));

  if (has("--dry-run")) {
    const e = await estimate(todo, imageDir, cfg);
    console.info(`${bank.length} image-only items (${bank.filter((i) => i.section === "math").length} math, ${bank.filter((i) => i.section !== "math").length} reading and writing); ${done.size} already transcribed; ${todo.length} to do.`);
    console.info(`Model ${cfg.model}, effort ${cfg.effort}, Message Batches API (half price).`);
    console.info(`Estimate: about ${(e.inputTokens / 1e6).toFixed(1)}M input tokens, ${(e.outputTokens.low / 1e6).toFixed(1)}–${(e.outputTokens.high / 1e6).toFixed(1)}M output tokens: $${e.usd.low.toFixed(0)}–$${e.usd.high.toFixed(0)}.`);
    return;
  }

  // Claude Code cloud sessions don't pass ANTHROPIC_API_KEY through to commands, so the key can also
  // be saved under COURSEBOOK_ANTHROPIC_API_KEY (the environment's settings → environment variables).
  const apiKey = process.env.COURSEBOOK_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No API key: set COURSEBOOK_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY).");
  const client = new Anthropic({ apiKey, maxRetries: 4 });
  const save = async (got: Record<string, ItemResult>) => {
    Object.assign(results.items, got);
    results.model = cfg.model;
    await writeResults(dir, results);
  };

  if (has("--sample")) {
    const n = Number(arg("--sample")) || 20;
    // A spread: math and reading, every difficulty.
    const pick = only ? todo : [...todo].sort((a, b) => (a.question_id < b.question_id ? -1 : 1)).filter((_, i, all) => i % Math.max(1, Math.floor(all.length / n)) === 0).slice(0, n);
    console.info(`Transcribing ${pick.length} items now…`);
    const got = await transcribeNow(client, pick, imageDir, cfg);
    await save(got);
    await report(dir, pick.map((i) => i.question_id), bank);
    return;
  }

  const statePath = path.join(dir, STATE_FILE);
  let state: { batchIds: string[] } | null = null;
  try {
    state = JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch {
    state = null;
  }
  if (!state || !has("--collect")) {
    if (state && !has("--resubmit")) throw new Error(`A batch was already sent (${state.batchIds.join(", ")}). Run with --collect to pick it up, or --resubmit to send again.`);
    if (!todo.length) return console.info("Everything is transcribed already.");
    const e = await estimate(todo, imageDir, cfg);
    console.info(`Sending ${todo.length} items (estimate $${e.usd.low.toFixed(0)}–$${e.usd.high.toFixed(0)})…`);
    state = { batchIds: await submitBatches(client, todo, imageDir, cfg, (m) => console.info(`  ${m}`)) };
    await fs.writeFile(statePath, JSON.stringify(state));
  }
  for (;;) {
    const s = await batchesDone(client, state.batchIds);
    const c = s.counts.reduce((a, x) => ({ processing: a.processing + x.processing, succeeded: a.succeeded + x.succeeded, errored: a.errored + x.errored }), { processing: 0, succeeded: 0, errored: 0 });
    console.info(`  ${new Date().toISOString().slice(11, 19)} processing ${c.processing}, done ${c.succeeded}, errored ${c.errored}`);
    if (s.done) break;
    await new Promise((r) => setTimeout(r, 60_000));
  }
  const got = await collectBatches(client, state.batchIds);
  await save(got);
  await fs.unlink(statePath).catch(() => {});
  await report(dir, Object.keys(got), bank);
}

/** How many would show as text, and why the rest need review. */
function report(dir: string, ids: string[], bank: Awaited<ReturnType<typeof readBank>>) {
  const byId = new Map(bank.map((i) => [i.question_id, i]));
  return readResults(dir).then((r) => {
    let ok = 0;
    let cost = 0;
    const problems: string[] = [];
    for (const id of ids) {
      const res = r?.items[id];
      const item = byId.get(id);
      if (!res || !item) continue;
      cost += res.costUsd;
      if (!res.transcript) {
        problems.push(`${id}: ${res.error}`);
        continue;
      }
      const c = checkTranscript(res.transcript, item, { type: item.type === "mcq" ? "mcq" : "grid_in", answer: item.type === "mcq" ? item.correct_answer : normalizeAcceptedList(item.correct_answer) });
      if (c.ok) ok += 1;
      else problems.push(`${id}: ${c.reasons.join(" ")}`);
    }
    console.info(`\n${ids.length} transcribed: ${ok} pass every check (shown as text), ${ids.length - ok} for review. Cost: $${cost.toFixed(2)}.`);
    for (const p of problems.slice(0, 50)) console.info(`  ${p}`);
    console.info("Next: npm run import:bank");
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
