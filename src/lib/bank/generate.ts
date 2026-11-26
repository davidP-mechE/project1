import { z } from "zod";
import { acceptedAnswers, parseEntry } from "./answers";
import { latexProblems } from "./transcribe";

/**
 * Writing ORIGINAL SAT-style questions from the 1600 Project blueprints
 * (npm run generate:bank). Claude writes each question from a blueprint only,
 * never from a College Board item; a second, separate request solves it cold
 * and grades it. Only questions that pass both, plus the local checks here,
 * are kept, as drafts.
 */

export const BLUEPRINT_FORMAT = "coursebook-sat-blueprints";
export const GENERATED_FORMAT = "coursebook-generated-questions";

export const BlueprintSchema = z.object({
  id: z.string(),
  section: z.enum(["math", "rw"]),
  skills: z.array(z.string()).min(1),
  lessons: z.array(z.string()),
  count: z.number().int().positive(),
  grid_in: z.boolean().optional(),
  desmos: z.string().nullable().optional(),
  title: z.string(),
  technique: z.string(),
  build: z.string(),
  wrong: z.array(z.string()).min(1),
  harder: z.string(),
});
export type Blueprint = z.infer<typeof BlueprintSchema>;
export const BlueprintFileSchema = z.object({ format: z.literal(BLUEPRINT_FORMAT), version: z.literal(1), blueprints: z.array(BlueprintSchema) });

// ─── What Claude returns ──────────────────────────────────────────────────

export const GeneratedItemSchema = z.object({
  slot: z.string().describe("The slot id this question fills, copied from the request."),
  skill: z.string().describe("One of the blueprint's skill names, exactly as listed."),
  type: z.enum(["mcq", "grid-in"]),
  stem: z.string().describe("The full question in Markdown: passage (or setup) then the question line. Math in LaTeX between $...$; dollar amounts as \\$; tables as Markdown tables; underlined words as <u>...</u>. No answer choices."),
  choices: z.array(z.string()).describe("Exactly four choices for mcq (text only, no 'A)' labels); empty for grid-in."),
  answer: z.string().describe("mcq: the letter A–D. grid-in: every accepted form separated by |, e.g. 3/4|.75|0.75."),
  explanation: z.string().describe("Why the answer is right and, for each wrong choice, the mistake that produces it. Markdown, math in $...$."),
  distractor_notes: z.array(z.object({ choice: z.string(), mistake: z.string() })).describe("mcq: one note per wrong letter. grid-in: likely wrong values and their mistakes."),
  desmos_check: z.string().describe("Math: one line on checking it in Desmos when the blueprint has a Desmos method; otherwise empty."),
  topic: z.string().describe("A few words naming the context or subject used (for variety tracking)."),
});
export type GeneratedItem = z.infer<typeof GeneratedItemSchema>;
export const GenerationSchema = z.object({ items: z.array(GeneratedItemSchema) });

export const ISSUE_KINDS = [
  "answer_key_wrong",
  "more_than_one_defensible",
  "no_defensible_answer",
  "math_error",
  "factual_doubt",
  "ambiguous_wording",
  "giveaway",
  "not_sat_style",
  "wrong_skill",
  "formatting",
] as const;

export const VerdictSchema = z.object({
  answer: z.string().describe("Your own answer after solving cold: a letter A–D, or the number for a grid-in."),
  work: z.string().describe("Your solution in a few lines."),
  issues: z.array(z.object({ kind: z.enum(ISSUE_KINDS), detail: z.string() })).describe("Every real problem you found. Empty if none."),
  sat_quality: z.number().int().describe("1–5: how closely this matches a real, published SAT question in rigor, wording and polish (5 = indistinguishable)."),
  difficulty: z.number().int().describe("1 easy, 2 medium, 3 hard, as it would play on the real test."),
});
export type Verdict = z.infer<typeof VerdictSchema>;

// ─── The plan: which questions to ask for ─────────────────────────────────

export type Slot = { slot: string; blueprint: string; difficulty: 1 | 2 | 3; type: "mcq" | "grid-in"; letter: "A" | "B" | "C" | "D"; topic: string };
export type GenRequest = { id: string; blueprint: string; slots: Slot[] };

/** Ask for a few more than needed: some won't pass the checks. */
export const OVERGENERATE = 1.25;
export const SLOTS_PER_REQUEST = 4;

/** A small seeded random generator, so the plan is the same every run. */
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function difficultySplit(count: number): Record<1 | 2 | 3, number> {
  const easy = Math.round(count * 0.3);
  const hard = Math.round(count * 0.3);
  return { 1: easy, 2: count - easy - hard, 3: hard };
}

export function planRequests(blueprints: Blueprint[]): GenRequest[] {
  const out: GenRequest[] = [];
  for (const bp of blueprints) {
    const rand = rng(bp.id);
    const pool = bp.section === "math" ? MATH_CONTEXTS : RW_TOPICS;
    const pick = () => pool[Math.floor(rand() * pool.length)];
    const split = difficultySplit(bp.count);
    let n = 0;
    for (const d of [1, 2, 3] as const) {
      const want = Math.ceil(split[d] * OVERGENERATE);
      const slots: Slot[] = [];
      for (let i = 0; i < want; i++) {
        const gridIn = bp.section === "math" && bp.grid_in && rand() < 0.3;
        slots.push({ slot: `${bp.id}-${d}-${String(++n).padStart(3, "0")}`, blueprint: bp.id, difficulty: d, type: gridIn ? "grid-in" : "mcq", letter: "ABCD"[Math.floor(rand() * 4)] as Slot["letter"], topic: pick() });
      }
      for (let i = 0; i < slots.length; i += SLOTS_PER_REQUEST) out.push({ id: `gen-${slots[i].slot}`, blueprint: bp.id, slots: slots.slice(i, i + SLOTS_PER_REQUEST) });
    }
  }
  return out;
}

// ─── Prompts ──────────────────────────────────────────────────────────────

export const GENERATE_SYSTEM = `You write ORIGINAL practice questions for The 1600 Project, an SAT tutoring program. Your questions must be indistinguishable in rigor, wording and polish from questions on the real digital SAT, while being entirely your own work.

Hard rules
- Never reproduce, closely paraphrase or "reskin" any real College Board or SAT question, passage or answer choice you may remember. Invent every passage, context, number and choice from scratch. Do not quote published literature: literary excerpts must be original, attributed to an invented author and work.
- Each question tests exactly ONE technique: the blueprint you are given.
- Exactly one correct answer, defensible from the text or the math alone. Every wrong choice must come from a specific mistake named in the blueprint (or an equally real student mistake), and must be clearly wrong to someone who reasons correctly.
- Facts: real-world claims must be true and uncontroversial. Studies, researchers, towns and organizations are invented unless you are certain of the facts; give invented people plausible full names from many cultures.

What real SAT questions look like
- Reading and Writing: one short passage (25–150 words; most 50–110) and one question. Subjects rotate among literature, history/social studies, humanities (arts, music, architecture, philosophy) and science. Academic, precise, neutral prose. Use the official question wording for the type, e.g. "Which choice best states the main idea of the text?", "Which choice most logically completes the text?", "Which choice completes the text with the most logical and precise word or phrase?", "Which choice completes the text so that it conforms to the conventions of Standard English?", "Which choice completes the text with the most logical transition?", "Which finding, if true, would most directly support the researcher's hypothesis?". Blanks are written ______ (six underscores).
- Grammar (Boundaries; Form, structure, and sense): the blank sits inside a natural academic passage; choices are short and differ only in the tested feature.
- Answer choices: four, parallel in form and similar in length; the correct one must not stand out by length, specificity or tone. No "all of the above", no jokes, no absolute giveaways.
- Math: concise stems in SAT style ("What is the value of $x$?", "Which equation represents…?", "Which of the following…?"). Real contexts are plausible and brief. Numeric choices are listed in ascending order. Use exact values (fractions, radicals, $\\pi$) where the SAT would. No figures or images: describe geometry in words; give data as Markdown tables.
- Grid-ins (math "student-produced response"): the answer is a single number; list every accepted form (e.g. 7/2|3.5). Negative answers are allowed.

Difficulty (it must genuinely play at this level on the real test)
- 1 Easy: one step or a direct application; the trap is mild.
- 2 Medium: two steps, or a trap a careful student still sees.
- 3 Hard: several steps, abstract or unusual framing, a subtle trap, denser passage or sophisticated vocabulary. Hard must be hard because of reasoning, not because of messy arithmetic or confusing wording.

Format
- Markdown. Math in LaTeX between $...$ (e.g. $\\frac{3}{4}$, $x^2$, $\\sqrt{5}$). Write dollar amounts as \\$12.50 so they aren't read as math. Tables as Markdown tables. Underlined words as <u>...</u>. Paired texts labeled **Text 1** and **Text 2**.
- Explanations: start "Choice X is correct." (or "The correct answer is N." for grid-ins), explain briefly and plainly, then one line per wrong choice naming its mistake ("Choice A is incorrect. This is the slope, not the y-intercept."). Short, plain sentences. Use these tutor phrases only where they truly fit: "flip it and switch the sign", "circle what the question asks for", "cross out the middle", "trust the Split Test, not your ear", "think in sums", "find r first".

Before you answer, solve every question yourself from scratch by a second route (plug the answer back in, or use the Desmos method), and check that no wrong choice is also right and no two choices are equal. If anything fails, rewrite the question.`;

export function generateUserText(bp: Blueprint, slots: Slot[]): string {
  const lines = slots.map(
    (s) =>
      `- slot ${s.slot}: difficulty ${s.difficulty}, ${s.type === "grid-in" ? "grid-in (no choices)" : `multiple choice, correct answer at ${s.letter} (if the choices are numbers, order them ascending and let the letter fall where it falls)`}, subject or context: ${s.topic}`,
  );
  return `Blueprint ${bp.id} · ${bp.title}
Section: ${bp.section === "math" ? "Math" : "Reading and Writing"}
Skill names (use one, exactly): ${bp.skills.join(" | ")}
Technique: ${bp.technique}
How to build it: ${bp.build}
Wrong answers come from: ${bp.wrong.join("; ")}
Harder versions: ${bp.harder}
${bp.desmos ? `Desmos method for the explanation's check: ${bp.desmos}` : "No Desmos check needed (desmos_check empty)."}

Write ${slots.length} question${slots.length === 1 ? "" : "s"}, one per slot below. Make them clearly different from one another: different contexts, numbers, sentence structures and question forms within the blueprint. Use the subject or context given as a starting point, not a script.
${lines.join("\n")}`;
}

export const VERIFY_SYSTEM = `You are a senior SAT item reviewer. You get one practice question, without its answer key. Solve it cold, carefully, as a top student would, then review it as strictly as the College Board's own reviewers.

Report as issues anything real:
- more_than_one_defensible: a second choice could be defended by a careful reader or solver.
- no_defensible_answer: no choice is fully right.
- math_error: an error in the setup, numbers or wording that changes the math.
- factual_doubt: a real-world claim that is false, doubtful or controversial, or a passage that quotes or closely copies a published work or a known SAT question.
- ambiguous_wording: the question or a choice can be read two ways.
- giveaway: the right choice stands out by length, specificity or tone, or wrong choices are obviously silly.
- not_sat_style: wording, length, subject or format unlike the real digital SAT.
- wrong_skill: it doesn't test the skill it's labeled with.
- formatting: broken Markdown, LaTeX or table, a blank not written as ______, labels inside choices.
Don't report nitpicks that wouldn't change how a student experiences the question.

sat_quality: 5 = could appear on the real test unchanged; 4 = minor polish only; 3 = clearly practice-book; 1–2 = flawed.
difficulty: how it would actually play on the real test (1 easy, 2 medium, 3 hard).`;

export function verifyUserText(skill: string, section: "math" | "rw", item: Pick<GeneratedItem, "type" | "stem" | "choices">): string {
  const body = item.type === "grid-in" ? `${item.stem}\n\n(Student-produced response: enter a number.)` : `${item.stem}\n\n${item.choices.map((c, i) => `${"ABCD"[i]}. ${c}`).join("\n")}`;
  return `Section: ${section === "math" ? "Math" : "Reading and Writing"}. Labeled skill: ${skill}.\n\n<question>\n${body}\n</question>`;
}

// ─── Local checks ─────────────────────────────────────────────────────────

const words = (s: string) => s.replace(/\$[^$]*\$/g, " x ").split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Problems a person or a parser would see without solving anything. */
export function localProblems(item: GeneratedItem, bp: Blueprint): string[] {
  const p: string[] = [];
  if (!bp.skills.includes(item.skill)) p.push(`Skill "${item.skill}" isn't one of the blueprint's.`);
  if (item.type === "mcq") {
    if (item.choices.length !== 4) p.push(`Has ${item.choices.length} choices, not 4.`);
    if (new Set(item.choices.map(norm)).size !== item.choices.length) p.push("Two choices are the same.");
    if (!/^[ABCD]$/.test(item.answer.trim().toUpperCase())) p.push(`Answer "${item.answer}" isn't a letter A–D.`);
    if (item.choices.some((c) => /^\s*\(?[A-D][).:]\s/.test(c))) p.push("A choice starts with its own letter label.");
  } else {
    if (item.choices.length) p.push("A grid-in has choices.");
    const forms = acceptedAnswers(item.answer);
    if (!forms.length || forms.some((a) => !parseEntry(a))) p.push(`Grid-in answer "${item.answer}" isn't a number.`);
  }
  const bad = [item.stem, item.explanation, ...item.choices].flatMap(latexProblems);
  if (bad.length) p.push(`Math that doesn't render: ${bad.slice(0, 2).join("; ")}`);
  if (bp.section === "rw") {
    const passage = item.stem.split(/\n\s*\n/).slice(0, -1).join(" ") || item.stem;
    const n = words(passage);
    if (n < 20 || n > 190) p.push(`Passage is ${n} words (SAT passages are 25–150).`);
  }
  if (/\[(image|figure)/i.test(item.stem)) p.push("Refers to a figure that doesn't exist.");
  return p;
}

/** The verifier's answer matches the key. */
export function answersMatch(item: GeneratedItem, verdict: Verdict): boolean {
  const got = verdict.answer.trim();
  if (item.type === "mcq") return got.toUpperCase().replace(/[^A-D]/g, "").slice(0, 1) === item.answer.trim().toUpperCase();
  const g = parseEntry(got.replace(/^.*?(-?[\d.]+(?:\/[\d.]+)?)\s*$/, "$1"));
  return Boolean(g) && acceptedAnswers(item.answer).some((a) => {
    const v = parseEntry(a);
    return v ? Math.abs(v.value - g!.value) < 1e-6 : false;
  });
}

const BLOCKING: readonly string[] = ["answer_key_wrong", "more_than_one_defensible", "no_defensible_answer", "math_error", "factual_doubt", "ambiguous_wording", "wrong_skill"];

export type Decision = { keep: boolean; reasons: string[] };

/** Keep a question only if it passes the local checks, the cold solve agrees, nothing serious was found, and it reads like the real test. */
export function decide(item: GeneratedItem, bp: Blueprint, slot: Slot, verdict: Verdict | null): Decision {
  const reasons = localProblems(item, bp);
  if (!verdict) reasons.push("Not verified.");
  else {
    if (!answersMatch(item, verdict)) reasons.push(`The cold solve got ${verdict.answer.trim()}, the key says ${item.answer}.`);
    for (const i of verdict.issues) if (BLOCKING.includes(i.kind)) reasons.push(`${i.kind.replace(/_/g, " ")}: ${i.detail}`);
    if (verdict.sat_quality < 4) reasons.push(`SAT quality ${verdict.sat_quality}/5.`);
    if (Math.abs(verdict.difficulty - slot.difficulty) > 1) reasons.push(`Plays as difficulty ${verdict.difficulty}, asked for ${slot.difficulty}.`);
  }
  return { keep: reasons.length === 0, reasons };
}

/** Word-trigram overlap, to drop near-duplicates within a blueprint. */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const w = norm(s).replace(/[^a-z0-9 ]/g, " ").split(" ").filter(Boolean);
    const g = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) g.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    return g;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const g of A) if (B.has(g)) both++;
  return both / Math.min(A.size, B.size);
}

/** A question in the bank's import format (status draft, source original). */
export function toImportRecord(id: string, item: GeneratedItem, bp: Blueprint, slot: Slot, verdict: Verdict | null) {
  const letters = ["a", "b", "c", "d"] as const;
  const rec: Record<string, unknown> = {
    external_id: id,
    section: bp.section,
    skill: item.skill,
    difficulty: slot.difficulty,
    type: item.type,
    stem: item.stem,
    answer: item.type === "mcq" ? item.answer.trim().toUpperCase() : item.answer.trim(),
    explanation: item.desmos_check ? `${item.explanation}\n\n**Desmos check:** ${item.desmos_check}` : item.explanation,
    distractor_notes: Object.fromEntries(item.distractor_notes.map((d) => [d.choice.trim(), d.mistake])),
    lesson: bp.lessons[0] ?? null,
    blueprint: bp.id,
    desmos_technique: bp.desmos ?? "",
    source: "original",
    status: "draft",
    sat_quality: verdict?.sat_quality ?? null,
    topic: item.topic,
  };
  letters.forEach((l, i) => (rec[`choice_${l}`] = item.choices[i] ?? ""));
  return rec;
}

// ─── Variety: subjects and contexts handed out to each slot ───────────────

export const RW_TOPICS = [
  "deep-sea hydrothermal vents", "migratory songbird navigation", "coral reef bleaching and recovery", "soil fungi and tree communication", "volcanic island formation",
  "exoplanet atmospheres", "the chemistry of glass", "honeybee waggle dances", "tidal energy engineering", "glacier meltwater and sea level",
  "plant responses to drought", "octopus problem-solving", "dinosaur feather pigments (invented study)", "the physics of bird flight", "microbes in hot springs",
  "seed dispersal by ants", "urban heat islands", "bioluminescent fungi", "desert tortoise burrows", "sleep and memory consolidation",
  "the history of the printing press", "ancient Roman concrete", "the Silk Road trade networks", "medieval West African empires (Mali, Songhai)", "the transcontinental railroad",
  "women in early aviation", "the Harlem Renaissance", "Andean terrace farming", "the history of public libraries", "early photography techniques",
  "Indigenous fire management practices", "the economics of tea trade", "nineteenth-century labor movements", "Polynesian wayfinding", "the history of mapmaking",
  "a jazz pianist's improvisation methods (invented)", "abstract expressionist painting", "traditional Japanese woodblock prints", "modernist architecture", "documentary filmmaking",
  "the craft of translation", "folk music collection", "a choreographer's process (invented)", "ceramic glazes in Song dynasty China", "mural painting in Mexico",
  "a novel about a lighthouse keeper (invented excerpt)", "a poem about city rain (invented)", "a short story set in a mountain village (invented)", "a play about two rival bakers (invented)", "a memoir of learning a second language (invented)",
  "behavioral economics and defaults", "how language shapes color perception", "community gardens and neighborhood ties", "the psychology of habit", "voter turnout research",
  "remote work and productivity", "children's language acquisition", "small-town newspapers", "cooperative housing", "museum visitor behavior",
  "archaeology of ancient bread", "linguistics of whistled languages", "the science of fermentation", "elephants' long-distance rumbles", "monarch butterfly migration",
  "solar-powered desalination", "spider silk proteins", "the history of vaccines", "Antarctic ice cores", "river delta formation",
];

export const MATH_CONTEXTS = [
  "a bakery's daily orders", "a phone plan with a data limit", "a school fundraiser", "a bike-share program", "a garden's fencing",
  "a water tank draining", "a bacteria culture", "a road trip's fuel use", "a concert venue's ticket sales", "a recipe scaled up",
  "a science lab's solution mixing", "a car rental fee", "a library's book circulation", "a city's population over time", "a savings account",
  "a delivery company's routes", "a farmer's crop yields", "a sports team's season stats", "a print shop's poster orders", "a museum's visitors",
  "a hiking trail's elevation", "a factory's production line", "an online store's shipping fees", "a swimming pool's volume", "a map's scale",
  "a theater's seating chart", "a coffee shop's sales", "a solar panel's output", "a marathon's pace", "a cell phone battery's charge",
  "a pure math setting with no context", "a pure math setting with no context", "a pure math setting with no context", "a pure math setting with no context", "a pure math setting with no context",
  "a survey of students", "a wildlife population study", "a medical trial (invented)", "a quality-control sample", "a poll of town residents",
  "a ramp's slope", "a ladder against a wall", "a circular park", "a rectangular box", "a scale model of a building",
];
