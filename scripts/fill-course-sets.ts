/**
 * Fill the SAT Master Courses' practice sets with ORIGINAL questions
 * (npm run courses:fill-sets). Rewrites the two course packets in
 * data/course-packets/: every lesson set gets the original questions whose
 * blueprint lives in that lesson (from data/questions/*.json), easiest first,
 * in blueprint order. College Board question ids are removed. Desmos lessons
 * (M-5.x) also get questions whose blueprint lists them. Strategy lessons
 * (0.x, 6.x, R&W 5.x) get a course-wide mix (0.2: Desmos questions; 6.1:
 * grid-ins), and unit review sets a spread over the unit's lessons, hardest
 * first. Sets with nothing to hold yet are left empty, as drafts. No database
 * or API calls: run npm run import:courses afterwards.
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
/** Lessons that teach strategy, not one skill: a mix from the whole course (with a filter for a few). */
const MIXED: Record<string, ((q: Q) => boolean) | null> = {
  "M-0.1": null,
  "M-0.2": (q) => q.desmos,
  "M-6.1": (q) => q.type === "grid-in" || q.type === "grid_in" || q.type === "spr",
  "M-6.2": null,
  "RW-0.1": null,
  "RW-5.1": null,
  "RW-5.2": null,
};
const MIX_SIZE = 40;
const REVIEW_SIZE = 30;

/** Up to n questions, taking them in turn from each blueprint so the mix is even. */
function spread(qs: Q[], n: number, hardFirst: boolean): Q[] {
  const groups = new Map<string, Q[]>();
  for (const q of qs) groups.set(q.blueprint, [...(groups.get(q.blueprint) ?? []), q]);
  for (const g of groups.values()) g.sort((a, b) => (hardFirst ? b.difficulty - a.difficulty : a.difficulty - b.difficulty) || a.id.localeCompare(b.id, "en", { numeric: true }));
  const out: Q[] = [];
  for (let i = 0; out.length < n && [...groups.values()].some((g) => g.length > i); i++) for (const g of groups.values()) if (g[i] && out.length < n) out.push(g[i]);
  return out;
}

type Q = { id: string; blueprint: string; difficulty: 1 | 2 | 3; skill: string; type: string; desmos: boolean };
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
      const bp = String(r.blueprint ?? "");
      if (id) questions.push({ id, blueprint: bp, difficulty: Number(r.difficulty) as Q["difficulty"], skill: String(r.skill ?? ""), type: String(r.type ?? "mcq").toLowerCase(), desmos: Boolean(r.desmos_technique || bps.find((b) => b.id === bp)?.desmos) });
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
  const unique = (qs: Q[]) => [...new Map(qs.map((q) => [q.id, q])).values()];
  for (const file of PACKETS) {
    const packet = JSON.parse(await fs.readFile(file, "utf8")) as { course: Json & { units: Json[] } };
    const c = packet.course;
    c.description = String(c.description).replace(/practice sets of real SAT Question Bank items/, "practice sets of original 1600 Project questions");
    console.info(`\n${c.title}`);
    const lessonIds = c.units.flatMap((u) => (u.lessons as Json[]).map((l) => String(l.id)));
    const course = unique(lessonIds.flatMap((id) => byLesson.get(id) ?? []));
    for (const u of c.units) {
      const unitQs = unique((u.lessons as Json[]).flatMap((l) => byLesson.get(String(l.id)) ?? []));
      for (const l of u.lessons as Json[]) {
        for (const b of l.blocks as Json[]) {
          if (b.type !== "question_set") continue;
          const id = String(l.id);
          const qs = id in MIXED ? spread(course.filter(MIXED[id] ?? (() => true)), MIX_SIZE, false) : (byLesson.get(id) ?? []);
          fill(b, qs);
          placed += qs.length;
          console.info(`  ${String(l.number).padEnd(4)} ${String(l.title).slice(0, 52).padEnd(52)} ${qs.length}${id in MIXED ? " (mix)" : ""}`);
        }
      }
      // Review sets split the unit's questions between them, hardest first, without repeats across sets.
      const reviews = (u.review_sets as Json[]) ?? [];
      const pool = spread(unitQs, REVIEW_SIZE * reviews.length, true);
      reviews.forEach((s, i) => fill(s, pool.filter((_, j) => j % reviews.length === i)));
      if (reviews.length) console.info(`       ${String(u.title).slice(0, 40)} review sets: ${reviews.map((_, i) => pool.filter((__, j) => j % reviews.length === i).length).join(", ")}`);
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
