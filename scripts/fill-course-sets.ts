/**
 * Fill the SAT Master Courses' practice sets with ORIGINAL questions
 * (npm run courses:fill-sets). Rewrites the two course packets in
 * data/course-packets/: every lesson set gets the original questions whose
 * blueprint lives in that lesson (from data/questions/*.json), easiest first,
 * in blueprint order. College Board question ids are removed. Desmos lessons
 * (M-5.x) also get questions whose blueprint lists them. Unit review sets and
 * lessons with no questions yet are left empty, as drafts. No database or API
 * calls: run npm run import:courses afterwards.
 *
 *   npm run courses:fill-sets -- --dry-run   show the counts, change nothing
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { BlueprintFileSchema } from "@/lib/bank/generate";

const PACKETS = ["data/course-packets/coursebook_sat_math_course.json", "data/course-packets/coursebook_sat_rw_course.json"];
const QUESTION_DIR = "data/questions";
const NOTE = "Original 1600 Project questions, written from our blueprints.";
const EMPTY_NOTE = "No questions yet: filled as original questions are written (npm run generate:bank, then npm run courses:fill-sets).";

/** Blueprints only in the older question files, placed by skill. */
const BY_SKILL: Record<string, string> = {
  "linear equations in one variable": "M-1.1",
  "linear equations in two variables": "M-1.2",
  "linear functions": "M-1.3",
  "systems of two linear equations": "M-1.4",
  "systems of two linear equations in two variables": "M-1.4",
  "linear inequalities": "M-1.5",
  "linear inequalities in one or two variables": "M-1.5",
  "ratios, rates, proportional relationships, and units": "M-3.1",
  percentages: "M-3.2",
};
const DIFF = { 1: "Easy", 2: "Medium", 3: "Hard" } as const;

type Q = { id: string; blueprint: string; difficulty: 1 | 2 | 3; skill: string };
type Json = Record<string, unknown>;

async function main() {
  const dry = process.argv.includes("--dry-run");
  const bps = BlueprintFileSchema.parse(JSON.parse(await fs.readFile("data/blueprints/sat-blueprints.json", "utf8"))).blueprints;
  const bpLessons = new Map(bps.map((b) => [b.id, b.lessons]));
  const order = new Map(bps.map((b, i) => [b.id, i]));

  const questions: Q[] = [];
  for (const f of (await fs.readdir(QUESTION_DIR)).filter((n) => n.endsWith(".json")).sort()) {
    const raw = JSON.parse(await fs.readFile(path.join(QUESTION_DIR, f), "utf8"));
    for (const r of (Array.isArray(raw) ? raw : raw.questions) as Json[]) {
      if (r.source && r.source !== "original") continue;
      const id = String(r.external_id ?? r.id ?? "");
      if (id) questions.push({ id, blueprint: String(r.blueprint ?? ""), difficulty: Number(r.difficulty) as Q["difficulty"], skill: String(r.skill ?? "") });
    }
  }

  // Each question's lessons: its blueprint's home lesson, plus any Desmos lesson the blueprint lists.
  const byLesson = new Map<string, Q[]>();
  const unplaced: string[] = [];
  for (const q of questions) {
    const listed = bpLessons.get(q.blueprint);
    const lessons = listed ? [listed[0], ...listed.slice(1).filter((l) => l.startsWith("M-5."))] : BY_SKILL[q.skill.toLowerCase()] ? [BY_SKILL[q.skill.toLowerCase()]] : [];
    if (!lessons.length) unplaced.push(q.id);
    for (const l of lessons) byLesson.set(l, [...(byLesson.get(l) ?? []), q]);
  }
  const rank = (q: Q) => order.get(q.blueprint) ?? 1000 + q.blueprint.charCodeAt(0) * 100 + Number(q.blueprint.replace(/\D/g, "") || 0);

  const fill = (set: Json, qs: Q[]) => {
    const sorted = [...qs].sort((a, b) => rank(a) - rank(b) || a.difficulty - b.difficulty || a.id.localeCompare(b.id, "en", { numeric: true }));
    const counts: Record<string, number> = {};
    for (const q of sorted) counts[DIFF[q.difficulty]] = (counts[DIFF[q.difficulty]] ?? 0) + 1;
    set.question_ids = sorted.map((q) => q.id);
    set.count = sorted.length;
    set.difficulty_counts = counts;
    set.title = String(set.title).replace(/\(\d+ questions?\)/, `(${sorted.length} question${sorted.length === 1 ? "" : "s"})`);
    set.source = "original";
    set.note = sorted.length ? NOTE : EMPTY_NOTE;
    set.status = sorted.length ? "ready" : "draft";
    if ("blueprints" in set) set.blueprints = [...new Set(sorted.map((q) => q.blueprint))];
  };

  let placed = 0;
  for (const file of PACKETS) {
    const packet = JSON.parse(await fs.readFile(file, "utf8")) as { course: Json & { units: Json[] } };
    const c = packet.course;
    c.description = String(c.description).replace(/practice sets of real SAT Question Bank items/, "practice sets of original 1600 Project questions");
    console.info(`\n${c.title}`);
    for (const u of c.units) {
      for (const l of u.lessons as Json[]) {
        for (const b of l.blocks as Json[]) {
          if (b.type !== "question_set") continue;
          const qs = byLesson.get(String(l.id)) ?? [];
          fill(b, qs);
          placed += qs.length;
          console.info(`  ${String(l.number).padEnd(4)} ${String(l.title).slice(0, 52).padEnd(52)} ${qs.length}`);
        }
      }
      for (const s of (u.review_sets as Json[]) ?? []) fill(s, []);
    }
    if (!dry) await fs.writeFile(file, `${JSON.stringify(packet, null, 1)}\n`);
  }
  console.info(`\n${questions.length} original questions; ${placed} placements.${unplaced.length ? ` Not placed (no lesson for their blueprint or skill): ${unplaced.join(", ")}` : ""}`);
  console.info(dry ? "Dry run: nothing written." : "Packets rewritten. Next: npm run import:courses");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
