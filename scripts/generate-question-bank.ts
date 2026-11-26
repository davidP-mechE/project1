/**
 * Write ORIGINAL SAT-style questions from the 1600 Project blueprints
 * (data/blueprints/sat-blueprints.json). Each question is written by Claude,
 * then solved cold and graded in a separate request; only questions that pass
 * are kept, as drafts.
 *
 *   npm run generate:bank -- --dry-run       how many requests, and a cost estimate (no API calls)
 *   npm run generate:bank -- --sample 20     20 questions now (one per blueprint, spread out) to check quality
 *   npm run generate:bank                    everything else as batches (half price): write, then verify; waits until done
 *   npm run generate:bank -- --collect       pick up batches sent earlier (if the command was stopped)
 *   npm run generate:bank -- --only A1,E12   just these blueprints
 *   npm run generate:bank -- --limit 180     at most 180 questions this run, spread over every blueprint (to cap the cost)
 *   npm run generate:bank -- --difficulty 3  only hard questions (combine with --only and --limit)
 *   npm run generate:bank -- --assemble      rebuild the output file from saved results (no API calls)
 *
 * Needs COURSEBOOK_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY). Working files: data/generated/ (not committed).
 * Output: data/questions/1600-generated-questions.json. Model: CLAUDE_MODEL_GENERATE (default claude-opus-5-5),
 * effort CLAUDE_EFFORT_GENERATE (default high; hard questions CLAUDE_EFFORT_GENERATE_HARD, default xhigh),
 * verify effort CLAUDE_EFFORT_VERIFY (default high).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
  allSlots,
  assemble,
  estimate,
  genParams,
  generateNow,
  itemsBySlot,
  limitRequests,
  OUTPUT_FILE,
  readBlueprints,
  readGen,
  readResults,
  readSpec,
  readVerify,
  REPORT_FILE,
  requestsToDo,
  results,
  STATE_FILE,
  submit,
  verifyNow,
  verifyParams,
  waitFor,
  WORK_DIR,
  writeResults,
  type GenConfig,
  type ResultsFile,
} from "@/server/qbank-generate";
import { decide, type GenRequest } from "@/lib/bank/generate";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string) => process.argv.includes(name);
/** --limit N: write at most N questions this run, spread over every blueprint and difficulty (to keep a run small). */
/** --difficulty 3: only that difficulty (1 easy, 2 medium, 3 hard). Applied before --limit. */
const levelOnly = (reqs: Parameters<typeof limitRequests>[0]) => {
  const d = Number(arg("--difficulty"));
  return [1, 2, 3].includes(d) ? reqs.filter((q) => q.slots[0].difficulty === d) : reqs;
};
const limit = (reqs: Parameters<typeof limitRequests>[0]) => {
  const r = levelOnly(reqs);
  return arg("--limit") ? limitRequests(r, Math.max(1, Number(arg("--limit")) || 0)) : r;
};
const log = (m: string) => console.info(`  ${m}`);
type Effort = GenConfig["effort"];

async function main() {
  const cfg: GenConfig = {
    model: process.env.CLAUDE_MODEL_GENERATE || "claude-opus-5-5",
    effort: (process.env.CLAUDE_EFFORT_GENERATE as Effort) || "high",
    hardEffort: (process.env.CLAUDE_EFFORT_GENERATE_HARD as Effort) || "xhigh",
    verifyEffort: (process.env.CLAUDE_EFFORT_VERIFY as Effort) || "high",
  };
  const blueprints = await readBlueprints();
  await readSpec();
  const bps = new Map(blueprints.map((b) => [b.id, b]));
  const only = arg("--only")?.split(",").map((s) => s.trim());
  const r = await readResults();
  const slots = allSlots(blueprints);
  const unverified = () => [...itemsBySlot(r).values()].filter((it) => !r.verdicts[it.slot]?.verdict && (!only || only.includes(slots.get(it.slot)!.blueprint)));

  if (has("--assemble")) return finish(r);

  if (has("--dry-run")) {
    const todo = limit(requestsToDo(blueprints, r, only));
    const n = todo.reduce((a, q) => a + q.slots.length, 0);
    const target = blueprints.filter((b) => !only || only.includes(b.id)).reduce((a, b) => a + b.count, 0);
    const e = estimate(todo.length, n, n + unverified().length, cfg);
    console.info(`${blueprints.length} blueprints, ${target} questions wanted (${n} to write: extra, especially for hard ones, so failures can be dropped), ${todo.length} writing requests.`);
    console.info(`Model ${cfg.model}, effort ${cfg.effort} (hard ${cfg.hardEffort}, verify ${cfg.verifyEffort}), Message Batches API (half price).`);
    console.info(`Estimate: about ${(e.input / 1e6).toFixed(1)}M input tokens, ${(e.out.low / 1e6).toFixed(1)}–${(e.out.high / 1e6).toFixed(1)}M output tokens: $${e.usd.low.toFixed(0)}–$${e.usd.high.toFixed(0)}.`);
    return;
  }

  const apiKey = process.env.COURSEBOOK_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No API key: set COURSEBOOK_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY).");
  const client = new Anthropic({ apiKey, maxRetries: 4 });
  r.model = cfg.model;

  if (has("--sample")) {
    const n = Number(arg("--sample")) || 20;
    // One slot from each of n blueprints, alternating math and reading, rotating difficulty.
    const math = blueprints.filter((b) => b.section === "math");
    const rw = blueprints.filter((b) => b.section === "rw");
    const order = math.flatMap((m, i) => [m, rw[i]]).filter(Boolean).filter((b) => !only || only.includes(b.id));
    const spread = [...new Set(Array.from({ length: Math.min(n, order.length) }, (_, i) => order[Math.floor((i * order.length) / Math.min(n, order.length))]))];
    const reqs: GenRequest[] = spread.map((b, i) => {
      const s = [...slots.values()].find((x) => x.blueprint === b.id && x.difficulty === ((i % 3) + 1) && !itemsBySlot(r).has(x.slot)) ?? [...slots.values()].find((x) => x.blueprint === b.id && !itemsBySlot(r).has(x.slot))!;
      return { id: `gen-${s.slot}`, blueprint: b.id, slots: [s] };
    });
    console.info(`Writing ${reqs.length} questions now…`);
    await generateNow(client, bps, reqs, cfg, r.generated);
    await writeResults(r);
    const made = reqs.flatMap((q) => r.generated[q.id]?.items ?? []);
    console.info(`Verifying ${made.length}…`);
    await verifyNow(client, bps, made, slots, cfg, r.verdicts);
    await writeResults(r);
    const cost = reqs.reduce((a, q) => a + (r.generated[q.id]?.costUsd ?? 0), 0) + made.reduce((a, it) => a + (r.verdicts[it.slot]?.costUsd ?? 0), 0);
    let ok = 0;
    for (const q of reqs) {
      const it = r.generated[q.id]?.items?.[0];
      const s = q.slots[0];
      if (!it) {
        console.info(`  ${s.slot}: not written (${r.generated[q.id]?.error ?? "no item"})`);
        continue;
      }
      const d = decide(it, bps.get(s.blueprint)!, s, r.verdicts[s.slot]?.verdict ?? null);
      if (d.keep) ok++;
      console.info(`  ${s.slot} ${d.keep ? "KEEP" : "DROP"}  quality ${r.verdicts[s.slot]?.verdict?.sat_quality ?? "?"}/5${d.keep ? "" : `  ${d.reasons.join(" | ")}`}`);
    }
    console.info(`\n${reqs.length} written: ${ok} pass every check, ${reqs.length - ok} dropped. Cost: $${cost.toFixed(2)}.`);
    return finish(r);
  }

  // Full run: write (batch), then verify (batch). The state file lets --collect resume either phase.
  const statePath = path.join(WORK_DIR, STATE_FILE);
  let state: { phase: "generate" | "verify"; batchIds: string[]; requests?: GenRequest[] } | null = null;
  try {
    state = JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch {
    state = null;
  }
  if (state && !has("--collect")) throw new Error(`Batches were already sent (${state.phase}: ${state.batchIds.join(", ")}). Run with --collect to pick them up.`);

  if (!state) {
    const todo = limit(requestsToDo(blueprints, r, only));
    if (todo.length) {
      const n = todo.reduce((a, q) => a + q.slots.length, 0);
      const e = estimate(todo.length, n, n + unverified().length, cfg);
      console.info(`Writing ${n} questions in ${todo.length} requests (estimate for writing and verifying: $${e.usd.low.toFixed(0)}–$${e.usd.high.toFixed(0)})…`);
      state = { phase: "generate", requests: todo, batchIds: await submit(client, todo.map((q) => ({ custom_id: q.id, params: genParams(bps.get(q.blueprint)!, q, cfg) })), log) };
      await fs.mkdir(WORK_DIR, { recursive: true });
      await fs.writeFile(statePath, JSON.stringify(state));
    }
  }
  if (state?.phase === "generate") {
    await waitFor(client, state.batchIds, log);
    const byId = new Map((state.requests ?? []).map((q) => [q.id, q]));
    await results(client, state.batchIds, (id, m) => (r.generated[id] = readGen(m, byId.get(id), true)), (id, why) => (r.generated[id] = { items: null, costUsd: 0, error: why }));
    await writeResults(r);
    state = null;
    await fs.unlink(statePath).catch(() => {});
  }
  if (!state) {
    const todo = unverified();
    if (todo.length) {
      console.info(`Verifying ${todo.length} questions…`);
      state = { phase: "verify", batchIds: await submit(client, todo.map((it) => ({ custom_id: it.slot, params: verifyParams(bps.get(slots.get(it.slot)!.blueprint)!, it, cfg) })), log) };
      await fs.writeFile(statePath, JSON.stringify(state));
    }
  }
  if (state?.phase === "verify") {
    await waitFor(client, state.batchIds, log);
    await results(client, state.batchIds, (id, m) => (r.verdicts[id] = readVerify(m, true)), (id, why) => (r.verdicts[id] = { verdict: null, costUsd: 0, error: why }));
    await writeResults(r);
    await fs.unlink(statePath).catch(() => {});
  }
  return finish(r);
}

async function finish(r: ResultsFile) {
  const blueprints = await readBlueprints();
  const a = assemble(blueprints, r);
  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(a.records, null, 1)}\n`);
  await fs.writeFile(path.join(WORK_DIR, REPORT_FILE), `${JSON.stringify({ byBlueprint: a.byBlueprint, rejected: a.rejected }, null, 1)}\n`);
  const cost = Object.values(r.generated).reduce((s, g) => s + g.costUsd, 0) + Object.values(r.verdicts).reduce((s, v) => s + v.costUsd, 0);
  const want = blueprints.reduce((s, b) => s + b.count, 0);
  const short = Object.entries(a.byBlueprint).filter(([, s]) => s.kept < s.want);
  console.info(`\nKept ${a.kept} of ${want} wanted; ${a.rejected.length} dropped. Spent so far: $${cost.toFixed(2)}.`);
  console.info(`Wrote ${OUTPUT_FILE} (drafts). Rejection reasons: ${path.join(WORK_DIR, REPORT_FILE)}.`);
  if (short.length && a.kept > 0 && short.length < blueprints.length) console.info(`Short of target: ${short.map(([id, s]) => `${id} ${s.kept}/${s.want}`).join(", ")}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
