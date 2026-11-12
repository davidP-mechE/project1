import { parseCsv } from "@/lib/csv";
import { acceptedAnswers, LETTERS, parseEntry } from "./answers";

/**
 * Bulk import of bank questions from CSV or JSON (the same format as the
 * 1600 Project lesson files). Each row is checked on its own: good rows are
 * imported, bad ones reported with their row number and what's wrong.
 * Unknown fields are ignored, never an error.
 */

export const DESMOS_TECHNIQUES = ["intersection", "overlap", "shading", "sliders", "regression", "list-plug-in", "table"] as const;
export type DesmosTechniqueName = (typeof DESMOS_TECHNIQUES)[number];
export const techniqueToDb = (t: DesmosTechniqueName) => t.replace(/-/g, "_") as "intersection" | "overlap" | "shading" | "sliders" | "regression" | "list_plug_in" | "table";
export const techniqueFromDb = (t: string) => t.replace(/_/g, "-") as DesmosTechniqueName;

export type ImportedQuestion = {
  externalId: string | null;
  section: "math" | "rw";
  skillId: string;
  type: "mcq" | "grid_in";
  difficulty: number;
  stem: string;
  choices: string[];
  answer: string;
  answerText: string | null;
  explanation: string;
  distractorNotes: Record<string, string>;
  week: number | null;
  lesson: string | null;
  unit: string | null;
  focus: string | null;
  blueprint: string | null;
  desmosTechnique: DesmosTechniqueName | null;
  desmosState: object | null;
  imageUrl: string | null;
};

export type RowResult = { row: number; externalId: string | null; ok: boolean; errors: string[]; warnings: string[]; data?: ImportedQuestion };

/** Finds a skill by id or name (case-insensitive; with aliases for short names). */
export type SkillResolver = (nameOrId: string, section: "math" | "rw") => string | null;

export const MAX_IMPORT_ROWS = 2000;

/** The column order of the CSV template (JSON uses the same names). */
export const TEMPLATE_FIELDS = [
  "external_id",
  "section",
  "skill",
  "difficulty",
  "type",
  "stem",
  "choice_a",
  "choice_b",
  "choice_c",
  "choice_d",
  "answer",
  "answer_text",
  "explanation",
  "distractor_notes",
  "week",
  "lesson",
  "unit",
  "focus",
  "blueprint",
  "desmos_technique",
  "image_url",
] as const;

/** Example rows for the downloadable template. Original, made-up questions. */
export const TEMPLATE_EXAMPLES = [
  {
    external_id: "MY-001",
    section: "math",
    skill: "Linear equations in one variable",
    difficulty: 1,
    type: "mcq",
    stem: "If $3x + 2 = 14$, what is the value of $x$?",
    choice_a: "3",
    choice_b: "4",
    choice_c: "12",
    choice_d: "16",
    answer: "B",
    answer_text: "4",
    explanation: "Subtract 2 from both sides: $3x = 12$, so $x = 4$.",
    distractor_notes: { A: "Subtracted 2 but divided 12 by 4.", C: "Stopped at 3x = 12.", D: "Added 2 instead of subtracting." },
    week: 3,
    lesson: "1.1",
    unit: "Linear Equations & Systems",
    focus: "Linear equations in one variable",
    blueprint: "L1",
    desmos_technique: "",
    image_url: "",
  },
  {
    external_id: "MY-002",
    section: "math",
    skill: "Ratios, rates, proportional relationships, and units",
    difficulty: 2,
    type: "grid-in",
    stem: "A recipe uses 3 cups of flour for every 4 cups of milk. How many cups of flour are used with 1 cup of milk?",
    choice_a: "",
    choice_b: "",
    choice_c: "",
    choice_d: "",
    answer: "3/4",
    answer_text: "",
    explanation: "Divide both parts by 4: 3/4 cup of flour per cup of milk.",
    distractor_notes: { "4/3": "Flipped the ratio.", "12": "Multiplied instead of dividing." },
    week: 5,
    lesson: "3.1",
    unit: "Ratios, Rates & Percentages",
    focus: "Ratios",
    blueprint: "R1",
    desmos_technique: "",
    image_url: "",
  },
];

export function templateJson() {
  return `${JSON.stringify(TEMPLATE_EXAMPLES, null, 2)}\n`;
}

/** Turn an uploaded file's text into plain records. Throws a readable error if the whole file is unreadable. */
export function readRecords(text: string, format: "csv" | "json"): Record<string, unknown>[] {
  if (format === "json") {
    let data: unknown;
    try {
      data = JSON.parse(text.replace(/^﻿/, ""));
    } catch {
      throw new Error("That file isn't valid JSON.");
    }
    const list = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { questions?: unknown }).questions) ? (data as { questions: unknown[] }).questions : null;
    if (!list) throw new Error("The JSON must be a list of questions (or { \"questions\": [...] }).");
    if (list.length > MAX_IMPORT_ROWS) throw new Error(`At most ${MAX_IMPORT_ROWS} questions per import.`);
    return list.map((r) => (r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : {}));
  }
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one question.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error(`At most ${MAX_IMPORT_ROWS} questions per import.`);
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const opt = (v: unknown, max = 200) => {
  const s = str(v);
  return s ? s.slice(0, max) : null;
};

function sectionOf(v: unknown): "math" | "rw" | null {
  const s = str(v).toLowerCase();
  if (!s || s === "math") return s ? "math" : null;
  if (["rw", "r&w", "ebrw", "reading and writing", "reading & writing"].includes(s)) return "rw";
  return null;
}

function typeOf(v: unknown): "mcq" | "grid_in" | null {
  const s = str(v).toLowerCase().replace(/[\s_]/g, "-");
  if (["mcq", "multiple-choice", "mc"].includes(s)) return "mcq";
  if (["grid-in", "gridin", "spr", "student-produced-response"].includes(s)) return "grid_in";
  return null;
}

function difficultyOf(v: unknown): number | null {
  const s = str(v).toLowerCase();
  const word = { easy: 1, medium: 2, hard: 3 }[s];
  if (word) return word;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 3 ? n : null;
}

function notesOf(v: unknown): Record<string, string> | "bad" {
  if (v === undefined || v === null || v === "") return {};
  let obj = v;
  if (typeof v === "string") {
    try {
      obj = JSON.parse(v);
    } catch {
      return "bad";
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "bad";
  const out: Record<string, string> = {};
  for (const [k, n] of Object.entries(obj as Record<string, unknown>)) if (typeof n === "string" && n.trim() && k.trim()) out[k.trim()] = n.trim().slice(0, 500);
  return out;
}

/** Check one record. */
export function validateRecord(rec: Record<string, unknown>, row: number, resolveSkill: SkillResolver): RowResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const externalId = opt(rec.external_id ?? rec.id, 64);
  const source = str(rec.source).toLowerCase();
  if (source && source !== "original") errors.push(`Only original questions can be imported (source is "${str(rec.source)}").`);

  const section = sectionOf(rec.section ?? "math");
  if (!section) errors.push(`Section must be "math" or "rw" (got "${str(rec.section)}").`);
  const type = typeOf(rec.type);
  if (!type) errors.push(`Type must be "mcq" or "grid-in" (got "${str(rec.type)}").`);
  const difficulty = difficultyOf(rec.difficulty);
  if (difficulty === null) errors.push("Difficulty must be 1, 2 or 3.");
  const stem = str(rec.stem);
  if (!stem) errors.push("The question (stem) is empty.");
  else if (stem.length > 6000) errors.push("The question is longer than 6,000 characters.");

  const skillName = str(rec.skill ?? rec.skill_id);
  const skillId = skillName && section ? resolveSkill(skillName, section) : null;
  if (!skillName) errors.push("Skill is missing.");
  else if (!skillId) errors.push(`Unknown skill "${skillName}".`);

  let choices: string[] = [];
  let answer = str(rec.answer);
  const notes = notesOf(rec.distractor_notes);
  if (notes === "bad") errors.push("distractor_notes must be an object like {\"A\": \"…\"} (in a CSV, as JSON text).");
  if (type === "mcq") {
    choices = Array.isArray(rec.choices) ? rec.choices.map(str) : [rec.choice_a, rec.choice_b, rec.choice_c, rec.choice_d].map(str);
    if (choices.length !== 4 || choices.some((c) => !c)) errors.push("A multiple-choice question needs four choices (choice_a to choice_d).");
    answer = answer.toUpperCase();
    if (!LETTERS.includes(answer as (typeof LETTERS)[number])) errors.push(`The answer must be a letter A–D (got "${str(rec.answer)}").`);
    if (notes !== "bad") {
      for (const k of Object.keys(notes)) {
        if (!LETTERS.includes(k.toUpperCase() as (typeof LETTERS)[number])) errors.push(`distractor_notes key "${k}" isn't a choice letter.`);
        else if (k.toUpperCase() === answer) errors.push(`distractor_notes has a note for the correct answer (${answer}).`);
      }
    }
  } else if (type === "grid_in") {
    if (!answer) errors.push("A grid-in needs an answer.");
    else if (acceptedAnswers(answer).some((a) => !parseEntry(a))) errors.push(`The grid-in answer "${answer}" isn't a number or fraction.`);
    if (notes !== "bad") for (const k of Object.keys(notes)) if (!parseEntry(k)) warnings.push(`distractor_notes key "${k}" isn't a number, so it will never match.`);
  }

  const weekRaw = str(rec.week);
  const week = weekRaw ? Number(weekRaw) : null;
  if (week !== null && (!Number.isInteger(week) || week < 0 || week > 99)) errors.push("Week must be a whole number.");

  const techRaw = str(rec.desmos_technique).toLowerCase().replace(/_/g, "-");
  const desmosTechnique = techRaw ? ((DESMOS_TECHNIQUES as readonly string[]).includes(techRaw) ? (techRaw as DesmosTechniqueName) : null) : null;
  if (techRaw && !desmosTechnique) errors.push(`Unknown Desmos technique "${techRaw}" (use one of: ${DESMOS_TECHNIQUES.join(", ")}).`);

  let desmosState: object | null = null;
  if (rec.desmos_state) {
    const ds = typeof rec.desmos_state === "string" ? safeJson(rec.desmos_state) : rec.desmos_state;
    if (ds && typeof ds === "object" && !Array.isArray(ds)) desmosState = ds;
    else errors.push("desmos_state must be a saved Desmos graph (a JSON object).");
  }

  const imageUrl = opt(rec.image_url, 500);
  if (imageUrl && !/^(https:\/\/|\/api\/bank\/images\/)/.test(imageUrl)) errors.push("image_url must start with https:// (or be an uploaded image).");

  const explanation = str(rec.explanation).slice(0, 6000);
  if (!explanation) warnings.push("No explanation.");

  const data: ImportedQuestion | undefined =
    errors.length === 0
      ? {
          externalId,
          section: section!,
          skillId: skillId!,
          type: type!,
          difficulty: difficulty!,
          stem,
          choices: type === "mcq" ? choices : [],
          answer,
          answerText: opt(rec.answer_text, 500),
          explanation,
          distractorNotes: notes === "bad" ? {} : type === "mcq" ? Object.fromEntries(Object.entries(notes).map(([k, v]) => [k.toUpperCase(), v])) : notes,
          week,
          lesson: opt(rec.lesson, 40),
          unit: opt(rec.unit),
          focus: opt(rec.focus),
          blueprint: opt(rec.blueprint, 40),
          desmosTechnique,
          desmosState,
          imageUrl,
        }
      : undefined;
  return { row, externalId, ok: errors.length === 0, errors, warnings, data };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Check every record; also flags an external id used twice in the same file. Row numbers start at 1 (CSV: the header is row 1, so the first question is row 2). */
export function validateRecords(records: Record<string, unknown>[], resolveSkill: SkillResolver, opts: { firstRow?: number } = {}): RowResult[] {
  const seen = new Map<string, number>();
  const first = opts.firstRow ?? 1;
  return records.map((rec, i) => {
    const r = validateRecord(rec, i + first, resolveSkill);
    if (r.externalId) {
      const prev = seen.get(r.externalId);
      if (prev !== undefined) {
        r.errors.push(`Duplicate id "${r.externalId}" (also row ${prev}).`);
        r.ok = false;
        delete r.data;
      } else seen.set(r.externalId, r.row);
    }
    return r;
  });
}

/** Short names some lesson files use for the official skill names. */
export const SKILL_ALIASES: Record<string, string> = {
  "systems of two linear equations": "Systems of two linear equations in two variables",
  "systems of linear equations": "Systems of two linear equations in two variables",
  "linear inequalities": "Linear inequalities in one or two variables",
  "ratios, rates, proportional relationships and units": "Ratios, rates, proportional relationships, and units",
  "nonlinear equations": "Nonlinear equations in one variable and systems of equations in two variables",
};

/** A resolver over a list of skills (id, section, name). Matches ids, names, then aliases. */
export function skillResolver(skills: { id: string; section: string; name: string; parentId: string | null }[]): SkillResolver {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return (nameOrId, section) => {
    const n = norm(nameOrId);
    const pool = skills.filter((s) => s.section === section && s.parentId);
    const byId = skills.find((s) => s.id === nameOrId.trim() && s.parentId);
    if (byId) return byId.id;
    const exact = pool.find((s) => norm(s.name) === n);
    if (exact) return exact.id;
    const alias = SKILL_ALIASES[n];
    return alias ? (pool.find((s) => norm(s.name) === norm(alias))?.id ?? null) : null;
  };
}
