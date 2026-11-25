/**
 * Academic Index, formula v1: every number the score uses, in one place so it
 * can be tuned later without touching the formulas (see score.ts).
 * Spec: "Coursebook Academic Index — Feature Spec", Nov 25 2026.
 */

export const FORMULA_VERSION = "v1";

export const MAX_POINTS = { test: 70, gpa: 70, rigor: 35, activities: 30, essays: 25 } as const;
export type ComponentKey = keyof typeof MAX_POINTS;
export const COMPONENT_KEYS = Object.keys(MAX_POINTS) as ComponentKey[];
export const MAX_TOTAL = 230;

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  test: "Test score",
  gpa: "GPA",
  rigor: "Course rigor",
  activities: "Activities & awards",
  essays: "Essays",
};

/** Score bands. Cutoffs are inclusive lower bounds; keep them here so they can be tuned. */
export const TIERS = [
  { min: 220, name: "Distinguished", message: "A near-perfect application." },
  { min: 205, name: "Exceptional", message: "Near the top of the applicant pool." },
  { min: 185, name: "Excellent", message: "In range for highly selective colleges." },
  { min: 165, name: "Strong", message: "Competitive at selective colleges." },
  { min: 140, name: "Competitive", message: "A solid application that fits most four-year universities." },
  { min: 100, name: "Developing", message: "You're on track and competitive at many state universities." },
  { min: 0, name: "Foundational", message: "You're building the basics. Focus on grades and core courses." },
] as const;
export type TierName = (typeof TIERS)[number]["name"];

/** Shown directly under every score. */
export const DISCLAIMER =
  "This is an application strength score, not a prediction of admission. Colleges also weigh recommendations, your school's context and much more.";

export const ESTIMATE_LABELS = {
  test_optional: "Test-optional estimate",
  partial: "Partial estimate — essays pending",
} as const;

/**
 * ACT composite → SAT total: the official 2018 ACT/SAT concordance (ACT and
 * College Board), single-point values. Composites 1–8 have no official match
 * and map to 400. Check act.org for a newer official table before launch
 * (the ACT changed format in 2025).
 */
export const ACT_TO_SAT: Record<number, number> = {
  36: 1590, 35: 1540, 34: 1500, 33: 1460, 32: 1430, 31: 1400, 30: 1370, 29: 1340, 28: 1310, 27: 1280, 26: 1240, 25: 1210, 24: 1180, 23: 1140,
  22: 1110, 21: 1080, 20: 1040, 19: 1010, 18: 970, 17: 930, 16: 890, 15: 850, 14: 800, 13: 760, 12: 710, 11: 670, 10: 630, 9: 590,
};
export const actToSat = (composite: number) => ACT_TO_SAT[composite] ?? 400;

/** 100-point grades → letter → 4.0 value. Schools set their own cutoffs. */
export const GRADE_SCALE = [
  { min: 93, letter: "A", value: 4.0 },
  { min: 90, letter: "A-", value: 3.7 },
  { min: 87, letter: "B+", value: 3.3 },
  { min: 83, letter: "B", value: 3.0 },
  { min: 80, letter: "B-", value: 2.7 },
  { min: 77, letter: "C+", value: 2.3 },
  { min: 73, letter: "C", value: 2.0 },
  { min: 70, letter: "C-", value: 1.7 },
  { min: 65, letter: "D", value: 1.0 },
  { min: 0, letter: "F", value: 0.0 },
] as const;
export const GRADE_SCALE_NOTE = "Schools set their own cutoffs, so use your school's if they differ.";

export const RIGOR_SELF_RATINGS = [
  { key: "MOST", label: "Most demanding available", points: 30 },
  { key: "VERY", label: "Very demanding", points: 24 },
  { key: "DEMANDING", label: "Demanding", points: 18 },
  { key: "AVERAGE", label: "Average", points: 12 },
  { key: "BELOW", label: "Below average", points: 6 },
] as const;
export type RigorSelfRating = (typeof RIGOR_SELF_RATINGS)[number]["key"];

export const RIGOR_BASE_MAX = 30;
export const RIGOR_EXAM_BONUS_MAX = 5;
export const HONORS_WEIGHT = 0.5;

/** Highest level an activity or honor reached, lowest first. */
export const ACTIVITY_LEVELS = [
  { key: "PARTICIPATION", label: "Participation only", points: 1 },
  { key: "SCHOOL", label: "School", points: 3 },
  { key: "REGIONAL", label: "Regional", points: 5 },
  { key: "STATE", label: "State", points: 7 },
  { key: "NATIONAL", label: "International or national", points: 10 },
] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number]["key"];
export const ACTIVITY_ITEM_MAX = 10;
export const ACTIVITIES_COUNTED = 3;
export const MAX_ACTIVITIES = 10;
export const MAX_HONORS = 5;

/** Common App honors recognition levels → activity levels. */
export const HONOR_LEVEL_MAP: Record<string, ActivityLevel> = {
  school: "SCHOOL",
  "state/regional": "STATE",
  state: "STATE",
  regional: "REGIONAL",
  national: "NATIONAL",
  international: "NATIONAL",
};

export const ESSAY_CRITERIA = [
  { key: "voice", label: "Voice & authenticity", five: "Sounds like a specific person; the reader learns who the writer is" },
  { key: "insight", label: "Insight & reflection", five: "Shows growth, self-awareness or a real idea, not just events" },
  { key: "detail", label: "Specific detail", five: "Concrete moments and details instead of general claims" },
  { key: "structure", label: "Structure & flow", five: "Clear arc; each paragraph earns its place; strong opening and ending" },
  { key: "clarity", label: "Clarity & mechanics", five: "Clean, readable sentences; no errors that distract" },
] as const;
export type EssayCriterion = (typeof ESSAY_CRITERIA)[number]["key"];

export const PERSONAL_STATEMENT_WORD_LIMIT = 650;
export const MAX_SUPPLEMENTS = 5;
export const PS_WEIGHT = 0.7;
export const SUPPLEMENT_WEIGHT = 0.3;
/** A supplement that doesn't answer its prompt has its Insight score capped here. */
export const OFF_PROMPT_INSIGHT_CAP = 2;
/** Grading runs per essay; the median of each criterion is kept. */
export const GRADING_RUNS = 3;
/** Essay scoring requests a student may make per day (controls API cost). */
export const ESSAY_SCORES_PER_DAY = 5;

/** Biggest-lever steps. */
export const LEVER = { satPoints: 100, rigorCourses: 2, gpaStep: 0.1 } as const;

/** Words the results must never use (we don't predict admission). */
export const BANNED_WORDS = [/\bchances?\b/i, /\bodds\b/i, /likely to get in/i];
