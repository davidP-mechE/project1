import { z } from "zod";
import { ACTIVITY_LEVELS, ESSAY_CRITERIA, MAX_ACTIVITIES, MAX_HONORS, MAX_SUPPLEMENTS, RIGOR_SELF_RATINGS } from "./config";

/**
 * The Academic Index inputs (spec section 4), entered by hand or filled from
 * the student's PDFs. Saved as JSON on AcademicIndexInputs, so every field is
 * optional/nullable here: a draft can be half filled. validateInputs (score.ts)
 * says what's still needed before scoring.
 */

const levelKeys = ACTIVITY_LEVELS.map((l) => l.key) as [string, ...string[]];
const ratingKeys = RIGOR_SELF_RATINGS.map((r) => r.key) as [string, ...string[]];

const count = z.number().int().min(0).max(100).nullable().default(null);
const text = (max: number) => z.string().max(max).default("");

export const SatSittingSchema = z.object({
  date: text(20),
  erw: z.number().int().nullable().default(null),
  math: z.number().int().nullable().default(null),
});

export const CourseGradeSchema = z.object({
  name: text(120),
  /** A percent ("91") or a letter ("A-"). */
  grade: text(8),
});

export const ExamSchema = z.object({
  name: text(120),
  kind: z.enum(["AP", "IB"]).default("AP"),
  score: z.number().int().min(1).max(7).nullable().default(null),
});

export const ActivitySchema = z.object({
  kind: z.enum(["ACTIVITY", "HONOR"]).default("ACTIVITY"),
  name: text(200),
  /** Common App activity type ("Athletics: JV/Varsity", "Academic"...), or "" for honors. */
  type: text(100),
  level: z.enum(levelKeys).nullable().default(null),
  leadership: z.boolean().default(false),
});

export const SupplementSchema = z.object({
  prompt: text(2_000),
  wordLimit: z.number().int().min(1).max(5_000).nullable().default(null),
  text: text(30_000),
});

export const InputsSchema = z.object({
  testing: z
    .object({
      type: z.enum(["SAT", "ACT", "BOTH", "NONE"]).nullable().default(null),
      satSittings: z.array(SatSittingSchema).max(10).default([]),
      actComposite: z.number().int().nullable().default(null),
    })
    .default({ type: null, satSittings: [], actComposite: null }),
  grades: z
    .object({
      mode: z.enum(["GPA", "COURSES"]).default("GPA"),
      unweightedGpa: z.number().nullable().default(null),
      courses: z.array(CourseGradeSchema).max(80).default([]),
      /** Seniors' GPAs are mostly set, so the "raise your GPA" tip is skipped. */
      senior: z.boolean().default(false),
    })
    .default({ mode: "GPA", unweightedGpa: null, courses: [], senior: false }),
  rigor: z
    .object({
      offeredAdvanced: count,
      offeredHonors: count,
      takenAdvanced: count,
      takenHonors: count,
      selfRating: z.enum(ratingKeys).nullable().default(null),
      exams: z.array(ExamSchema).max(40).default([]),
    })
    .default({ offeredAdvanced: null, offeredHonors: null, takenAdvanced: null, takenHonors: null, selfRating: null, exams: [] }),
  activities: z
    .array(ActivitySchema)
    .max(MAX_ACTIVITIES + MAX_HONORS)
    .default([]),
  essays: z
    .object({
      personalStatement: text(30_000),
      supplements: z.array(SupplementSchema).max(MAX_SUPPLEMENTS).default([]),
    })
    .default({ personalStatement: "", supplements: [] }),
});

export type AcademicInputs = z.infer<typeof InputsSchema>;
export type SatSitting = z.infer<typeof SatSittingSchema>;
export type ActivityInput = z.infer<typeof ActivitySchema>;
export type ExamInput = z.infer<typeof ExamSchema>;
export type SupplementInput = z.infer<typeof SupplementSchema>;

export const emptyInputs = (): AcademicInputs => InputsSchema.parse({});

/** Saved JSON → inputs (anything unreadable falls back to empty). */
export function parseInputs(json: unknown): AcademicInputs {
  const r = InputsSchema.safeParse(json ?? {});
  return r.success ? r.data : emptyInputs();
}

/** One essay's five criterion scores, 0–5 each. */
export const CriteriaSchema = z.object(Object.fromEntries(ESSAY_CRITERIA.map((c) => [c.key, z.number().min(0).max(5)])) as Record<(typeof ESSAY_CRITERIA)[number]["key"], z.ZodNumber>);
export type CriteriaScores = z.infer<typeof CriteriaSchema>;

/**
 * Where a filled-in field came from (spec 3.3): saved per field path
 * ("testing.actComposite", "activities.2.level"...). Fields typed by the
 * student have no source. `confirmed` turns true when the student confirms
 * the review screen; low-confidence fields must each be ticked first.
 */
export const FieldSourceSchema = z.object({
  file: z.string().max(40),
  fileLabel: z.string().max(80),
  page: z.number().int().nullable(),
  confidence: z.enum(["high", "low"]),
  confirmed: z.boolean().default(false),
  /** Set when two files disagreed: the other file's value (shown on the review screen). */
  alternative: z.object({ fileLabel: z.string().max(80), page: z.number().int().nullable(), value: z.string().max(200) }).nullable().default(null),
});
export type FieldSource = z.infer<typeof FieldSourceSchema>;
export const FieldSourcesSchema = z.record(z.string().max(80), FieldSourceSchema);
export type FieldSources = z.infer<typeof FieldSourcesSchema>;

export function parseSources(json: unknown): FieldSources {
  const r = FieldSourcesSchema.safeParse(json ?? {});
  return r.success ? r.data : {};
}
