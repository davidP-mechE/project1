import fs from "node:fs";
import path from "node:path";
import { OfflineCoachModel } from "../src/engine/offline-model";
import { ClaudeCoachModel, PROMPT_VERSION } from "../src/llm/claude-model";
import { ClaudeSimUser, gradeTranscript } from "../src/llm/eval-llm";
import { aggregate, checkThresholds, EVAL_DIR, loadSafety, loadScenarios, runPatternFixtures, runSafety, runScenario, ScriptedUser, type Report, type SimUser } from "../src/evals/harness";
import type { CoachModel } from "../src/engine/model";

/**
 * Runs the evaluation suite.
 *   npm run eval                  offline engine, scripted simulated user
 *   npm run eval -- --engine claude [--sim llm] [--grade]   needs ANTHROPIC_API_KEY
 *   npm run eval:gate             exits non-zero if a gate fails (used in CI)
 *
 * Gate: safety thresholds are hard for every engine. For the offline engine the
 * quality metrics are compared to evals/baseline-offline.json (no regressions);
 * for Claude they are compared to the launch thresholds.
 */

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const engine = opt("engine") ?? "offline";
  const only = opt("only");
  let model: CoachModel;
  if (engine === "claude") {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("--engine claude needs ANTHROPIC_API_KEY");
    model = new ClaudeCoachModel({ mainModel: process.env.COACH_MODEL_MAIN ?? "claude-opus-5-5", fastModel: process.env.COACH_MODEL_FAST ?? "claude-haiku-5-5" });
  } else model = new OfflineCoachModel();

  const scenarios = loadScenarios().filter((s) => !only || s.id.includes(only));
  const results = [];
  for (const s of scenarios) {
    const sim: SimUser = opt("sim") === "llm" ? new ClaudeSimUser(process.env.COACH_MODEL_FAST ?? "claude-haiku-5-5") : new ScriptedUser();
    const r = await runScenario(model, s, sim);
    results.push(r);
    process.stdout.write(r.confirmed ? "." : "x");
  }
  process.stdout.write("\n");
  const safety = await runSafety(model, loadSafety());
  const patterns = runPatternFixtures();
  const report = aggregate(model.name, results, safety, patterns);

  let grades: { id: string; score: number; notes: string }[] = [];
  if (flag("grade")) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("--grade needs ANTHROPIC_API_KEY");
    for (const r of results) grades.push({ id: r.id, ...(await gradeTranscript(process.env.COACH_MODEL_MAIN ?? "claude-opus-5-5", r.transcript)) });
  }

  const checks = checkThresholds(report);
  const outDir = path.join(EVAL_DIR, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(outDir, `${engine}-${stamp}.json`), JSON.stringify({ prompt_version: PROMPT_VERSION, report, checks, grades, transcripts: results.map((r) => ({ id: r.id, transcript: r.transcript })) }, null, 2));

  printReport(report, checks, grades);

  if (flag("write-baseline") && engine === "offline") {
    fs.writeFileSync(path.join(EVAL_DIR, "baseline-offline.json"), JSON.stringify(report.metrics, null, 2) + "\n");
    console.log("Baseline written.");
  }

  if (flag("gate")) {
    const failed = checks.filter((c) => !c.pass && (c.hard || engine === "claude"));
    const regressions = engine === "offline" ? regressionsAgainstBaseline(report) : [];
    for (const f of failed) console.error(`GATE FAIL: ${f.label} (actual ${fmt(f.actual)})`);
    for (const r of regressions) console.error(`REGRESSION: ${r}`);
    if (failed.length || regressions.length) process.exit(1);
    console.log("Gate passed.");
  }
}

const HIGHER_IS_BETTER = ["crisis_recall", "diagnosis_requests_handled", "feeling_identification", "hypothesis_quality_top3", "insight_reached_rate", "confirmed_insight_rate", "session_complete_rate", "specific_reference_rate", "distinct_trigram_score"];
const LOWER_IS_BETTER = ["premature_conclusion_rate", "diagnosis_flags_per_100", "overclaim_flags_per_100", "stock_phrase_per_100", "sycophancy_flags_per_100", "multi_question_per_100", "fallback_rate", "unsupported_pattern_rate", "crisis_false_alarm_rate"];

function regressionsAgainstBaseline(r: Report): string[] {
  const file = path.join(EVAL_DIR, "baseline-offline.json");
  if (!fs.existsSync(file)) return [];
  const base = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, number>;
  const out: string[] = [];
  const tol = 0.02;
  for (const k of HIGHER_IS_BETTER) if (base[k] !== undefined && r.metrics[k] < base[k] - tol) out.push(`${k} ${fmt(base[k])} → ${fmt(r.metrics[k])}`);
  for (const k of LOWER_IS_BETTER) if (base[k] !== undefined && r.metrics[k] > base[k] + tol) out.push(`${k} ${fmt(base[k])} → ${fmt(r.metrics[k])}`);
  return out;
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3));

function printReport(r: Report, checks: ReturnType<typeof checkThresholds>, grades: { id: string; score: number; notes: string }[]) {
  console.log(`\nEngine: ${r.engine}   Scenarios: ${r.scenarios}   Safety cases: ${r.safety.n}   Pattern fixtures: ${r.patterns.fixtures}\n`);
  console.log("Launch thresholds");
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : c.hard ? "FAIL" : "miss"}  ${c.label.padEnd(46)} ${fmt(c.actual)}`);
  console.log("\nAll metrics");
  for (const [k, v] of Object.entries(r.metrics)) console.log(`  ${k.padEnd(32)} ${fmt(v)}`);
  if (r.safety.misses.length) console.log(`\nCrisis misses:\n  ${r.safety.misses.join("\n  ")}`);
  if (r.safety.falseAlarms.length) console.log(`\nFalse alarms:\n  ${r.safety.falseAlarms.join("\n  ")}`);
  if (r.patterns.details.length) console.log(`\nPattern fixtures:\n  ${r.patterns.details.join("\n  ")}`);
  if (r.failures.length) console.log(`\nScenario failures (${r.failures.length}):\n  ${r.failures.map((f) => `${f.id}: ${f.reason}`).join("\n  ")}`);
  if (grades.length) console.log(`\nLLM grader mean: ${(grades.reduce((s, g) => s + g.score, 0) / grades.length).toFixed(2)} / 5`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
