import {
  ACTIVITIES_COUNTED,
  ACTIVITY_ITEM_MAX,
  ACTIVITY_LEVELS,
  ESSAY_CRITERIA,
  ESTIMATE_LABELS,
  FORMULA_VERSION,
  GRADE_SCALE,
  HONORS_WEIGHT,
  LEVER,
  MAX_POINTS,
  MAX_TOTAL,
  RIGOR_BASE_MAX,
  RIGOR_EXAM_BONUS_MAX,
  RIGOR_SELF_RATINGS,
  TIERS,
  actToSat,
  type ActivityLevel,
  type ComponentKey,
  type EssayCriterion,
  type TierName,
} from "./config";
import { combineEssays, criterionLabel, essayTotal } from "./essays";
import type { AcademicInputs, ActivityInput, CriteriaScores, ExamInput, SatSitting } from "./inputs";

/**
 * computeAcademicIndex: the whole formula (spec section 5), as a pure function.
 * Component values stay decimals; only the total is rounded (halves up).
 * Essays arrive already graded (criteria per essay, rules applied).
 */

export type EssayScores = { personalStatement: CriteriaScores | null; supplements: CriteriaScores[] };
export type ScoringInput = AcademicInputs & { essayScores: EssayScores };

export type Issue = { path: string; message: string };
export class AcademicIndexInputError extends Error {
  constructor(readonly issues: Issue[]) {
    super(issues.map((i) => i.message).join(" "));
  }
}

export type EstimateType = "full" | "test_optional" | "partial";
export type ComponentResult = { earned: number; max: number; present: boolean };
export type AcademicIndexResult = {
  components: Record<ComponentKey, ComponentResult>;
  /** Rounded, 0–230. */
  total: number;
  /** Before rounding (for the biggest-lever tip). */
  exactTotal: number;
  tier: TierName;
  tierMessage: string;
  estimateType: EstimateType;
  /** "Test-optional estimate", "Partial estimate — essays pending". */
  labels: string[];
  formulaVersion: typeof FORMULA_VERSION;
  /** Details for the breakdown: which SAT total was used, etc. */
  detail: { satUsed: number | null; testSource: "SAT" | "ACT" | null; gpaUsed: number; rigorBase: number; examBonus: number; activityPoints: number[] };
};

// ─── Rounding ─────────────────────────────────────────────────────────────

/** Nearest whole number, halves up (with a small tolerance for float error, e.g. 17.4999999). */
export const roundHalfUp = (x: number) => Math.floor(x + 0.5 + 1e-9);

// ─── Test score ───────────────────────────────────────────────────────────

const validSection = (v: number | null): v is number => v !== null && v >= 200 && v <= 800 && v % 10 === 0;

/** Best ERW + best Math across every sitting, or null if a section is missing. */
export function superscore(sittings: SatSitting[]): number | null {
  const erw = sittings.map((s) => s.erw).filter(validSection);
  const math = sittings.map((s) => s.math).filter(validSection);
  if (erw.length === 0 || math.length === 0) return null;
  return Math.max(...erw) + Math.max(...math);
}

export const satPoints = (satTotal: number) => (satTotal / 1600) * MAX_POINTS.test;

// ─── GPA ──────────────────────────────────────────────────────────────────

/** A course grade (percent or letter) → its 4.0 value, or null if unreadable. */
export function gradeValue(grade: string): number | null {
  const g = grade.trim().toUpperCase().replace("–", "-").replace("−", "-");
  if (!g) return null;
  if (/^\d+(\.\d+)?%?$/.test(g)) {
    const pct = Number(g.replace("%", ""));
    if (pct < 0 || pct > 100) return null;
    return GRADE_SCALE.find((s) => pct >= s.min)!.value;
  }
  const letter = g === "A+" ? "A" : g;
  return GRADE_SCALE.find((s) => s.letter === letter)?.value ?? null;
}

/** The converter: average of the courses' 4.0 values. */
export function convertedGpa(courses: { grade: string }[]): number | null {
  const values = courses.map((c) => gradeValue(c.grade)).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export const gpaPoints = (gpa: number) => gpa * (MAX_POINTS.gpa / 4);

// ─── Rigor ────────────────────────────────────────────────────────────────

const weighted = (adv: number | null, honors: number | null) => (adv ?? 0) + HONORS_WEIGHT * (honors ?? 0);

/** +1 per AP 5 or IB 7, +0.5 per AP 4 or IB 6, at most 5. */
export function examBonus(exams: ExamInput[]): number {
  let bonus = 0;
  for (const e of exams) {
    if (e.score === null) continue;
    const top = e.kind === "AP" ? 5 : 7;
    if (e.score === top) bonus += 1;
    else if (e.score === top - 1) bonus += 0.5;
  }
  return Math.min(bonus, RIGOR_EXAM_BONUS_MAX);
}

function rigorBase(r: AcademicInputs["rigor"]): number | null {
  const offered = weighted(r.offeredAdvanced, r.offeredHonors);
  if (offered > 0) {
    const taken = weighted(r.takenAdvanced, r.takenHonors);
    return RIGOR_BASE_MAX * Math.min(taken / offered, 1);
  }
  const rating = RIGOR_SELF_RATINGS.find((x) => x.key === r.selfRating);
  return rating ? rating.points : null;
}

// ─── Activities ───────────────────────────────────────────────────────────

export const levelPoints = (level: string) => ACTIVITY_LEVELS.find((l) => l.key === level)?.points ?? 0;
export const activityItemPoints = (a: ActivityInput) => (a.level ? Math.min(levelPoints(a.level) + (a.leadership ? 1 : 0), ACTIVITY_ITEM_MAX) : 0);
const scoredActivities = (items: ActivityInput[]) => items.filter((a) => a.name.trim() || a.level);
export function activitiesPoints(items: ActivityInput[]): number[] {
  return scoredActivities(items)
    .map(activityItemPoints)
    .sort((a, b) => b - a)
    .slice(0, ACTIVITIES_COUNTED);
}

// ─── Validation ───────────────────────────────────────────────────────────

/** Everything still needed before the inputs can be scored ("Needed" on the form). Empty when ready. */
export function validateInputs(i: AcademicInputs): Issue[] {
  const issues: Issue[] = [];
  const t = i.testing;
  if (!t.type) issues.push({ path: "testing.type", message: "Choose how you're reporting tests (SAT, ACT, both, or test-optional)." });
  if (t.type === "SAT" || t.type === "BOTH") {
    t.satSittings.forEach((s, n) => {
      for (const k of ["erw", "math"] as const) {
        const v = s[k];
        if (v !== null && !validSection(v)) issues.push({ path: `testing.satSittings.${n}.${k}`, message: `SAT section scores are 200–800 in steps of 10 (test date ${n + 1}).` });
      }
    });
    if (superscore(t.satSittings) === null) issues.push({ path: "testing.satSittings", message: "Enter your SAT Reading and Writing and Math scores." });
  }
  if (t.type === "ACT" || t.type === "BOTH") {
    if (t.actComposite === null) issues.push({ path: "testing.actComposite", message: "Enter your ACT composite." });
    else if (t.actComposite < 1 || t.actComposite > 36) issues.push({ path: "testing.actComposite", message: "An ACT composite is 1–36." });
  }

  const g = i.grades;
  if (g.mode === "GPA") {
    if (g.unweightedGpa === null) issues.push({ path: "grades.unweightedGpa", message: "Enter your unweighted GPA (0.00–4.00)." });
    else if (!(g.unweightedGpa >= 0 && g.unweightedGpa <= 4)) issues.push({ path: "grades.unweightedGpa", message: "Enter your unweighted GPA (0.00–4.00)" });
  } else {
    g.courses.forEach((c, n) => {
      if (c.grade.trim() && gradeValue(c.grade) === null) issues.push({ path: `grades.courses.${n}.grade`, message: `"${c.grade}" isn't a grade the converter knows (use a percent like 91, or a letter like A-).` });
    });
    if (convertedGpa(g.courses) === null) issues.push({ path: "grades.courses", message: "Add your course grades, or enter your unweighted GPA." });
  }

  const r = i.rigor;
  if (rigorBase(r) === null) issues.push({ path: "rigor", message: "Enter how many advanced courses your school offers, or rate your schedule (counselor-style)." });
  r.exams.forEach((e, n) => {
    if (e.score !== null && e.score > (e.kind === "AP" ? 5 : 7)) issues.push({ path: `rigor.exams.${n}.score`, message: `${e.kind} scores go up to ${e.kind === "AP" ? 5 : 7}.` });
  });

  scoredActivities(i.activities).forEach((a) => {
    const n = i.activities.indexOf(a);
    if (!a.level) issues.push({ path: `activities.${n}.level`, message: `Choose the highest level reached for "${a.name.trim() || `item ${n + 1}`}".` });
  });
  return issues;
}

// ─── The index ────────────────────────────────────────────────────────────

export function tierFor(total: number) {
  return TIERS.find((t) => total >= t.min)!;
}

function testComponent(t: AcademicInputs["testing"]): { points: number; sat: number; source: "SAT" | "ACT" } | null {
  if (!t.type || t.type === "NONE") return null;
  const options: { points: number; sat: number; source: "SAT" | "ACT" }[] = [];
  if (t.type === "SAT" || t.type === "BOTH") {
    const sat = superscore(t.satSittings);
    if (sat !== null) options.push({ points: satPoints(sat), sat, source: "SAT" });
  }
  if ((t.type === "ACT" || t.type === "BOTH") && t.actComposite !== null) {
    const sat = actToSat(t.actComposite);
    options.push({ points: satPoints(sat), sat, source: "ACT" });
  }
  // Both: whichever gives more points (never mixing SAT and ACT sections).
  return options.sort((a, b) => b.points - a.points)[0] ?? null;
}

export function computeAcademicIndex(input: ScoringInput): AcademicIndexResult {
  const issues = validateInputs(input);
  if (issues.length) throw new AcademicIndexInputError(issues);

  const test = testComponent(input.testing);
  const gpa = input.grades.mode === "GPA" ? input.grades.unweightedGpa! : convertedGpa(input.grades.courses)!;
  const base = rigorBase(input.rigor)!;
  const bonus = examBonus(input.rigor.exams);
  const acts = activitiesPoints(input.activities);
  const ps = input.essayScores.personalStatement;

  const components: Record<ComponentKey, ComponentResult> = {
    test: { earned: test?.points ?? 0, max: MAX_POINTS.test, present: test !== null },
    gpa: { earned: gpaPoints(gpa), max: MAX_POINTS.gpa, present: true },
    rigor: { earned: Math.min(base + bonus, MAX_POINTS.rigor), max: MAX_POINTS.rigor, present: true },
    activities: { earned: acts.reduce((a, b) => a + b, 0), max: MAX_POINTS.activities, present: true },
    essays: {
      earned: ps ? combineEssays(essayTotal(ps), input.essayScores.supplements.map(essayTotal)) : 0,
      max: MAX_POINTS.essays,
      present: ps !== null,
    },
  };

  const present = Object.values(components).filter((c) => c.present);
  const earned = present.reduce((s, c) => s + c.earned, 0);
  const maxPresent = present.reduce((s, c) => s + c.max, 0);
  // Missing parts: scale what's there up to 230.
  const exactTotal = maxPresent === MAX_TOTAL ? earned : (earned / maxPresent) * MAX_TOTAL;
  const total = Math.min(MAX_TOTAL, roundHalfUp(exactTotal));
  const tier = tierFor(total);

  const labels: string[] = [];
  if (!components.test.present) labels.push(ESTIMATE_LABELS.test_optional);
  if (!components.essays.present) labels.push(ESTIMATE_LABELS.partial);
  const estimateType: EstimateType = !components.essays.present ? "partial" : !components.test.present ? "test_optional" : "full";

  return {
    components,
    total,
    exactTotal,
    tier: tier.name,
    tierMessage: tier.message,
    estimateType,
    labels,
    formulaVersion: FORMULA_VERSION,
    detail: { satUsed: test?.sat ?? null, testSource: test?.source ?? null, gpaUsed: gpa, rigorBase: base, examBonus: bonus, activityPoints: acts },
  };
}

// ─── Biggest lever ────────────────────────────────────────────────────────

export type Lever = { component: ComponentKey; gain: number; step: string };

const nextLevel = (level: string | null): ActivityLevel | null => {
  const i = ACTIVITY_LEVELS.findIndex((l) => l.key === level);
  return i >= 0 && i < ACTIVITY_LEVELS.length - 1 ? ACTIVITY_LEVELS[i + 1].key : null;
};
const clone = <T>(x: T): T => structuredClone(x);

/**
 * One realistic step per component (spec section 8), each re-scored, so the
 * gain includes the scaling of a test-optional or partial estimate. Returns
 * every step that helps, biggest first.
 */
export function leverOptions(input: ScoringInput): Lever[] {
  const before = computeAcademicIndex(input).exactTotal;
  const out: Lever[] = [];
  const tryStep = (component: ComponentKey, step: string, change: (x: ScoringInput) => boolean) => {
    const next = clone(input);
    if (!change(next)) return;
    const gain = computeAcademicIndex(next).exactTotal - before;
    if (gain > 0.0001) out.push({ component, gain, step });
  };

  // Test: +100 SAT points (on the SAT total used; capped at 1600).
  const test = testComponent(input.testing);
  if (test && test.sat < 1600) {
    tryStep("test", `Raise your ${test.source === "ACT" ? "test score by the equivalent of 100 SAT points" : "SAT by 100 points"}`, (x) => {
      const target = Math.min(1600, test.sat + LEVER.satPoints);
      // Any split works: only the total matters.
      const erw = Math.min(800, target - 200);
      x.testing = { type: "SAT", actComposite: null, satSittings: [{ date: "", erw, math: target - erw }] };
      return true;
    });
  }

  // Rigor: 2 more advanced courses (recompute the ratio), or one rating up.
  tryStep("rigor", `Take ${LEVER.rigorCourses} more advanced courses (AP, IB or dual enrollment)`, (x) => {
    const r = x.rigor;
    if (weighted(r.offeredAdvanced, r.offeredHonors) > 0) {
      r.takenAdvanced = (r.takenAdvanced ?? 0) + LEVER.rigorCourses;
      return true;
    }
    const i = RIGOR_SELF_RATINGS.findIndex((s) => s.key === r.selfRating);
    if (i <= 0) return false;
    r.selfRating = RIGOR_SELF_RATINGS[i - 1].key;
    return true;
  });

  // Activities: raise the lowest of the top 3 by one level (or add a third).
  const items = scoredActivities(input.activities);
  const top = items.map((a) => ({ a, p: activityItemPoints(a), n: input.activities.indexOf(a) })).sort((a, b) => b.p - a.p).slice(0, ACTIVITIES_COUNTED);
  if (top.length < ACTIVITIES_COUNTED) {
    tryStep("activities", "Add another activity and take it to school level", (x) => {
      x.activities.push({ kind: "ACTIVITY", name: "New activity", type: "", level: "SCHOOL", leadership: false });
      return true;
    });
  } else {
    const lowest = top.at(-1)!;
    const up = nextLevel(lowest.a.level);
    if (up) {
      tryStep("activities", `Take "${lowest.a.name.trim() || "your third activity"}" to ${ACTIVITY_LEVELS.find((l) => l.key === up)!.label.toLowerCase()} level`, (x) => {
        x.activities[lowest.n].level = up;
        return true;
      });
    }
  }

  // Essays: raise the lowest-scoring criterion by 1 (whichever essay gains most).
  const ps = input.essayScores.personalStatement;
  if (ps) {
    const essays: { label: string; scores: CriteriaScores; set: (x: ScoringInput, c: CriteriaScores) => void }[] = [
      { label: "personal statement", scores: ps, set: (x, c) => void (x.essayScores.personalStatement = c) },
      ...input.essayScores.supplements.map((s, n) => ({ label: `supplement ${n + 1}`, scores: s, set: (x: ScoringInput, c: CriteriaScores) => void (x.essayScores.supplements[n] = c) })),
    ];
    for (const e of essays) {
      const lowest = ESSAY_CRITERIA.map((c) => c.key).reduce<EssayCriterion>((lo, k) => (e.scores[k] < e.scores[lo] ? k : lo), "voice");
      if (e.scores[lowest] >= 5) continue;
      tryStep("essays", `Revise your ${e.label} to raise ${criterionLabel(lowest)} by 1`, (x) => {
        e.set(x, { ...e.scores, [lowest]: Math.min(5, e.scores[lowest] + 1) });
        return true;
      });
    }
  }

  // GPA: +0.1 (not for seniors, whose GPA is mostly set).
  if (!input.grades.senior) {
    tryStep("gpa", "Raise your unweighted GPA by 0.1", (x) => {
      const gpa = x.grades.mode === "GPA" ? x.grades.unweightedGpa! : convertedGpa(x.grades.courses)!;
      if (gpa >= 4) return false;
      x.grades = { ...x.grades, mode: "GPA", unweightedGpa: Math.min(4, gpa + LEVER.gpaStep) };
      return true;
    });
  }

  // Keep only each component's best step, biggest first.
  const best = new Map<ComponentKey, Lever>();
  for (const l of out) if (!best.has(l.component) || best.get(l.component)!.gain < l.gain) best.set(l.component, l);
  return [...best.values()].sort((a, b) => b.gain - a.gain);
}

export const biggestLever = (input: ScoringInput): Lever | null => leverOptions(input)[0] ?? null;
