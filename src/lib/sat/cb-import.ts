import { parseCsv } from "@/lib/csv";
import { DOMAINS, type SectionId } from "./domains";
import type { Missed } from "./scores";

/**
 * Bringing College Board results into the site. Three ways, all numbers and
 * labels only (no question text is ever read or kept):
 *
 *  1. Knowledge and Skills bands from a score report: for each of the 8
 *     content domains, College Board shows performance on a 7-step scale.
 *     They're entered as 1–7 per domain.
 *  2. A question-by-question review pasted from Bluebook or My Practice (copy
 *     the review table and paste it): each row's section, module, question
 *     number, domain, skill and whether it was right.
 *  3. A class spreadsheet (CSV) of score reports: one row per student, matched
 *     by email, with totals, section scores and domain bands.
 *
 * Columns are found by their header names, so College Board exports and our
 * template both work; anything unrecognised is listed, never guessed at.
 */

export type DomainBands = Partial<Record<string, number>>;
export type ReviewQuestion = { section: SectionId; module: 1 | 2; number: number; domain: string; skill: string | null; correct: boolean };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** College Board's domain names (and common short forms) to our ids. */
const DOMAIN_ALIASES: Record<string, string> = Object.fromEntries([
  ...DOMAINS.map((d) => [norm(d.name), d.id]),
  ...DOMAINS.map((d) => [norm(d.id), d.id]),
  ["psda", "psda"],
  ["problem solving and data analysis", "psda"],
  ["geometry", "geo-trig"],
  ["geometry and trig", "geo-trig"],
  ["conventions", "conventions"],
  ["english conventions", "conventions"],
  ["sec", "conventions"],
  ["expression", "expression"],
  ["information and ideas", "info-ideas"],
  ["craft", "craft-structure"],
]);

export function domainFrom(label: string): string | null {
  const n = norm(label);
  if (!n) return null;
  if (DOMAIN_ALIASES[n]) return DOMAIN_ALIASES[n];
  // "Math: Algebra", "Reading and Writing – Craft and Structure"…
  for (const [alias, id] of Object.entries(DOMAIN_ALIASES)) if (alias.length > 3 && n.includes(alias)) return id;
  return null;
}

export function skillFrom(domain: string, label: string): string | null {
  const n = norm(label);
  if (!n) return null;
  const d = DOMAINS.find((x) => x.id === domain);
  return d?.skills.find((s) => norm(s) === n) ?? d?.skills.find((s) => n.includes(norm(s)) || norm(s).includes(n)) ?? null;
}

function sectionFrom(label: string): SectionId | null {
  const n = norm(label);
  if (/^(m|math|mathematics)$/.test(n) || n.startsWith("math")) return "MATH";
  if (/^(rw|r and w|reading and writing|erw|evidence based reading and writing|reading)$/.test(n) || n.startsWith("reading")) return "RW";
  return null;
}

function resultFrom(label: string): boolean | null {
  const t = label.trim();
  if (t === "✓" || t === "✔") return true;
  if (t === "✗" || t === "✘") return false;
  const n = norm(t);
  if (!n) return null;
  if (/^(correct|right|yes|y|true|1)$/.test(n)) return true;
  if (/^(incorrect|wrong|no|n|false|0|omitted|skipped|blank|not answered|unanswered|x)$/.test(n)) return false;
  if (n.startsWith("correct")) return true;
  if (n.startsWith("incorrect") || n.startsWith("omit") || n.startsWith("wrong")) return false;
  return null;
}

/** Split pasted text into rows: tabs (copied from a web table), else CSV. */
function rowsOf(text: string): string[][] {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (!t) return [];
  if (t.includes("\t")) return t.split("\n").map((l) => l.split("\t").map((c) => c.trim()));
  return parseCsv(t).map((r) => r.map((c) => c.trim()));
}

type Col = "section" | "module" | "number" | "domain" | "skill" | "result" | "yourAnswer" | "correctAnswer";
const HEADER_MATCH: [Col, RegExp][] = [
  ["section", /^(section|test section|subject)$/],
  ["module", /^(module|mod)$/],
  ["number", /^(question|question number|question no|q|q no|q number|no|number|item|item number)$/],
  ["domain", /^(domain|content domain|content area|category)$/],
  ["skill", /^(skill|skills|subskill|topic|question type)$/],
  ["result", /^(result|outcome|correct|correctness|status|your result|score|marked)$/],
  ["yourAnswer", /^(your answer|my answer|student answer|response|answer given)$/],
  ["correctAnswer", /^(correct answer|answer key|key|right answer)$/],
];

/**
 * A pasted question review. Recognises a header row; without one, rows are
 * read as: section, module, question number, domain, skill, result.
 */
export function parseQuestionReview(text: string): { questions: ReviewQuestion[]; skipped: { line: number; reason: string }[]; ignoredColumns: string[] } {
  const rows = rowsOf(text).filter((r) => r.some((c) => c));
  const skipped: { line: number; reason: string }[] = [];
  if (!rows.length) return { questions: [], skipped, ignoredColumns: [] };
  let cols: Partial<Record<Col, number>> = {};
  let start = 0;
  const ignoredColumns: string[] = [];
  const header = rows[0].map(norm);
  const found = header.map((h) => HEADER_MATCH.find(([, re]) => re.test(h))?.[0] ?? null);
  if (found.filter(Boolean).length >= 2) {
    found.forEach((c, i) => {
      if (c && cols[c] === undefined) cols[c] = i;
      else if (!c && rows[0][i]) ignoredColumns.push(rows[0][i]);
    });
    start = 1;
  } else {
    cols = { section: 0, module: 1, number: 2, domain: 3, skill: 4, result: 5 };
  }
  const questions: ReviewQuestion[] = [];
  const seen = new Set<string>();
  // Some reviews give the module once, as a row like "Module 2"; carry it down.
  let carrySection: SectionId | null = null;
  let carryModule: 1 | 2 | null = null;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    const cell = (c: Col) => (cols[c] !== undefined ? (r[cols[c]!] ?? "") : "");
    const heading = norm(r.filter(Boolean).join(" "));
    const m = /(reading and writing|math)?\s*module\s*([12])/.exec(heading);
    if (m && r.filter(Boolean).length <= 2) {
      if (m[1]) carrySection = m[1] === "math" ? "MATH" : "RW";
      carryModule = Number(m[2]) as 1 | 2;
      continue;
    }
    const domain = domainFrom(cell("domain"));
    if (!domain) {
      skipped.push({ line, reason: cell("domain") ? `Unknown domain "${cell("domain").slice(0, 40)}"` : "No domain" });
      continue;
    }
    const domainSection = DOMAINS.find((d) => d.id === domain)!.section;
    const section = sectionFrom(cell("section")) ?? carrySection ?? domainSection;
    if (section !== domainSection) {
      skipped.push({ line, reason: "The domain isn't in that section" });
      continue;
    }
    const modRaw = /([12])/.exec(cell("module"))?.[1];
    const mod = (modRaw ? Number(modRaw) : carryModule) as 1 | 2 | null;
    const number = Number(/(\d+)/.exec(cell("number"))?.[1]);
    if (!mod || !Number.isInteger(number) || number < 1 || number > 30) {
      skipped.push({ line, reason: !mod ? "No module (1 or 2)" : "No question number" });
      continue;
    }
    let correct = resultFrom(cell("result"));
    // No result column: compare the answers (a blank answer was omitted, so wrong).
    if (correct === null && cols.yourAnswer !== undefined && cell("correctAnswer")) correct = cell("yourAnswer") !== "" && norm(cell("yourAnswer")) === norm(cell("correctAnswer"));
    if (correct === null) {
      skipped.push({ line, reason: "Can't tell if it was right or wrong" });
      continue;
    }
    const key = `${section}${mod}-${number}`;
    if (seen.has(key)) {
      skipped.push({ line, reason: "The same question twice" });
      continue;
    }
    seen.add(key);
    questions.push({ section, module: mod, number, domain, skill: skillFrom(domain, cell("skill")), correct });
  }
  return { questions, skipped, ignoredColumns };
}

export const missedFrom = (qs: ReviewQuestion[]): Missed[] => qs.filter((q) => !q.correct).map((q) => ({ section: q.section, module: q.module, number: q.number, domain: q.domain, ...(q.skill ? { skill: q.skill } : {}) }));

export function validBands(raw: unknown): DomainBands {
  const out: DomainBands = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = DOMAINS.some((d) => d.id === k) ? k : domainFrom(k);
    const n = typeof v === "number" ? v : Number(v);
    if (id && Number.isInteger(n) && n >= 1 && n <= 7) out[id] = n;
  }
  return out;
}

// ─── Class spreadsheet of score reports ──────────────────────────────────

export type ReportRow = {
  line: number;
  email: string;
  source: "SAT" | "PSAT" | "PRACTICE_BLUEBOOK" | "PRACTICE_OTHER";
  testName: string | null;
  takenOn: string;
  total: number;
  rw: number | null;
  math: number | null;
  bands: DomainBands;
  errors: string[];
};

export const REPORT_TEMPLATE_HEADERS = ["Email", "Test", "Test date", "Total score", "Reading and Writing", "Math", ...DOMAINS.map((d) => d.name)];

function sourceFrom(label: string): { source: ReportRow["source"]; testName: string | null } {
  const n = norm(label);
  if (/bluebook|practice test|^pt\s?\d/.test(n)) return { source: "PRACTICE_BLUEBOOK", testName: label.trim() || null };
  if (/psat|nmsqt/.test(n)) return { source: "PSAT", testName: label.trim() || null };
  if (/^sat|school day sat|sat school day|^sat\b/.test(n)) return { source: "SAT", testName: label.trim() || null };
  return { source: "PRACTICE_OTHER", testName: label.trim() || null };
}

function dateFrom(v: string): string | null {
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const scoreCell = (v: string) => {
  const n = Number(v.replace(/[^\d]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
};

/** Read a class spreadsheet of score reports. One row per student and test. */
export function readScoreReports(text: string): { rows: ReportRow[]; error: string | null; ignoredColumns: string[] } {
  const all = rowsOf(text).filter((r) => r.some((c) => c));
  if (all.length < 2) return { rows: [], error: "Paste or upload a spreadsheet with a header row and at least one student.", ignoredColumns: [] };
  const head = all[0].map(norm);
  const find = (...res: RegExp[]) => head.findIndex((h) => res.some((re) => re.test(h)));
  const c = {
    email: find(/^(student )?e ?mail( address)?$/, /email/),
    test: find(/^(test|assessment|test name|assessment name|test type)$/),
    date: find(/^(test date|date|date taken|administration date|test administration)$/, /date/),
    total: find(/^(total|total score|composite|sat total|psat total)( score)?$/, /total score/),
    rw: find(/^(reading and writing|evidence based reading and writing|erw|rw|reading and writing section score|erw section score|reading and writing score)$/, /reading and writing/, /^erw/),
    math: find(/^(math|math section score|math score|mathematics)$/, /^math/),
  };
  if (c.email < 0) return { rows: [], error: "No Email column. Add one, or start from the template.", ignoredColumns: [] };
  if (c.total < 0) return { rows: [], error: "No Total score column.", ignoredColumns: [] };
  const domainCols = new Map<number, string>();
  all[0].forEach((h, i) => {
    if (Object.values(c).includes(i)) return;
    const d = domainFrom(h);
    if (d) domainCols.set(i, d);
  });
  const used = new Set([...Object.values(c).filter((i) => i >= 0), ...domainCols.keys()]);
  const ignoredColumns = all[0].filter((h, i) => h && !used.has(i));
  const rows: ReportRow[] = [];
  for (let i = 1; i < all.length; i++) {
    const r = all[i];
    const get = (k: number) => (k >= 0 ? (r[k] ?? "").trim() : "");
    const errors: string[] = [];
    const email = get(c.email).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push("No valid email");
    const { source, testName } = sourceFrom(get(c.test) || "SAT");
    const takenOn = dateFrom(get(c.date)) ?? "";
    if (!takenOn) errors.push("No test date");
    const total = scoreCell(get(c.total));
    if (total === null || total < 400 || total > 1600 || total % 10) errors.push("Total must be 400–1600 in steps of 10");
    const rw = scoreCell(get(c.rw));
    const math = scoreCell(get(c.math));
    for (const [v, name] of [[rw, "Reading and Writing"], [math, "Math"]] as const) if (v !== null && (v < 200 || v > 800 || v % 10)) errors.push(`${name} must be 200–800 in steps of 10`);
    if (rw !== null && math !== null && total !== null && rw + math !== total) errors.push("The section scores don't add up to the total");
    const bands: DomainBands = {};
    for (const [k, d] of domainCols) {
      const v = get(k);
      if (!v) continue;
      const n = Number(v);
      if (Number.isInteger(n) && n >= 1 && n <= 7) bands[d] = n;
      else errors.push(`${DOMAINS.find((x) => x.id === d)!.name}: use 1 to 7`);
    }
    rows.push({ line: i + 1, email, source, testName, takenOn, total: total ?? 0, rw, math, bands, errors });
  }
  return { rows, error: null, ignoredColumns };
}

// ─── Pinpointing weaknesses ──────────────────────────────────────────────

export type DomainEvidence = { domain: string; band: number | null; cbRight: number; cbTotal: number; siteAccuracy: number | null; siteAnswers: number; openMistakes: number };

/**
 * A 0–1 strength per domain from whatever evidence there is: the latest
 * College Board band (band/7), right answers in College Board reviews, and
 * accuracy on work in the site. Weakest first. Domains with no evidence come
 * last, marked as unknown.
 */
export function rankDomains(evidence: DomainEvidence[]) {
  return evidence
    .map((e) => {
      const parts: { v: number; w: number }[] = [];
      if (e.band !== null) parts.push({ v: (e.band - 0.5) / 7, w: 2 });
      if (e.cbTotal >= 2) parts.push({ v: e.cbRight / e.cbTotal, w: Math.min(3, e.cbTotal / 3) });
      if (e.siteAccuracy !== null && e.siteAnswers >= 3) parts.push({ v: e.siteAccuracy, w: Math.min(2, e.siteAnswers / 10) });
      const strength = parts.length ? parts.reduce((s, p) => s + p.v * p.w, 0) / parts.reduce((s, p) => s + p.w, 0) : null;
      return { ...e, strength };
    })
    .sort((a, b) => (a.strength ?? 2) - (b.strength ?? 2) || b.openMistakes - a.openMistakes);
}
