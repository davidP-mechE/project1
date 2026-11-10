/**
 * Prints the estimated cost of generating a typical textbook chapter, step by
 * step, under the old setup (everything on Sonnet, one request at a time) and
 * the current one (Haiku for flashcards and page reading, Batch API).
 *
 *   npm run cost:estimate
 *   npm run cost:estimate -- --lessons 6 --pages 30 --math-pages 12
 */
import { DEFAULT_SETTINGS } from "@/lib/course/settings";
import {
  DEFAULT_PLAN,
  estimateGeneration,
  LEGACY_PLAN,
  STEP_LABELS,
  type GenerationPlan,
} from "@/lib/usage/estimate";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const lessonCount = arg("lessons", 6);
const pages = arg("pages", 30);
const mathPages = arg("math-pages", 12);
const CHARS_PER_PAGE = 2_800; // a dense textbook page

const lessons = Array.from({ length: lessonCount }, (_, i) => ({
  unitKey: "chapter",
  pages: Math.round(pages / lessonCount),
  chars: Math.round(pages / lessonCount) * CHARS_PER_PAGE,
  mathHeavyPages:
    Math.floor(mathPages / lessonCount) + (i < mathPages % lessonCount ? 1 : 0),
}));

const usd = (n: number) => `$${n.toFixed(3)}`;
function show(name: string, plan: GenerationPlan) {
  const e = estimateGeneration(lessons, DEFAULT_SETTINGS, plan);
  console.log(
    `\n${name}: about $${e.costUsd.toFixed(2)} for ${lessonCount} lessons / ${pages} pages (${mathPages} equation-heavy)`,
  );
  for (const s of e.steps) {
    const share = Math.round((s.costUsd / Math.max(e.costUsd, 1e-9)) * 100);
    console.log(
      `  ${STEP_LABELS[s.step].padEnd(30)} ${s.model.padEnd(18)} ${s.batch ? "batch" : "     "}  in ${String(s.inputTokens).padStart(6)}  out ${String(s.outputTokens).padStart(6)}  ${usd(s.costUsd).padStart(7)}  ${String(share).padStart(3)}%`,
    );
  }
  return e.costUsd;
}

const before = show("Before (all Sonnet, one request at a time)", LEGACY_PLAN);
const after = show("Now (Haiku for simple steps, Batch API)", DEFAULT_PLAN);
console.log(
  `\nSaving: about ${Math.round((1 - after / before) * 100)}% per chapter.`,
);
console.log(
  "These are estimates from average token counts. For a real course's numbers: npm run cost:breakdown -- <courseId>",
);
