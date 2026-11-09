import { z } from "zod";

/**
 * Per-course generation settings. Stored as JSON on the Course row and
 * always read through `parseSettings`, so old or partial data gets defaults.
 */

export const LEVELS = {
  middle_school: "Middle school",
  high_school: "High school",
  college: "College",
} as const;

export const STYLES = {
  concise: { label: "Concise", description: "Short explanations that get to the point. Good for review." },
  detailed: { label: "Detailed", description: "Step-by-step explanations with more examples. Good for learning something new." },
} as const;

/** Things that can be generated. "Explanation" is always on: it's the heart of a lesson. */
export const CONTENT_TYPES = {
  objectives: { label: "Learning objectives", scope: "lesson" },
  workedExamples: { label: "Worked examples (when the book has them)", scope: "lesson" },
  keyTerms: { label: "Key terms and definitions", scope: "lesson" },
  multipleChoice: { label: "Multiple-choice questions", scope: "lesson" },
  shortAnswer: { label: "Short-answer questions", scope: "lesson" },
  stepProblems: { label: "Step-by-step problems (math/science)", scope: "lesson" },
  flashcards: { label: "Flashcards", scope: "lesson" },
  unitSummaries: { label: "Unit summaries", scope: "unit" },
  unitTests: { label: "Unit tests", scope: "unit" },
  finalExam: { label: "Final exam", scope: "course" },
} as const;
export type ContentType = keyof typeof CONTENT_TYPES;
const contentKeys = Object.keys(CONTENT_TYPES) as [ContentType, ...ContentType[]];

export const courseSettingsSchema = z.object({
  level: z.enum(Object.keys(LEVELS) as [keyof typeof LEVELS, ...(keyof typeof LEVELS)[]]).default("high_school"),
  style: z.enum(["concise", "detailed"]).default("detailed"),
  contentTypes: z
    .array(z.enum(contentKeys))
    .default([...contentKeys])
    .transform((list) => [...new Set(list)]),
  questionsPerLesson: z.number().int().min(2).max(15).default(6),
  flashcardsPerLesson: z.number().int().min(0).max(25).default(8),
  includeFrontBackMatter: z.boolean().default(false),
});
export type CourseSettings = z.infer<typeof courseSettingsSchema>;

export const DEFAULT_SETTINGS: CourseSettings = courseSettingsSchema.parse({});

/** Read stored settings safely: unknown/invalid values fall back to defaults instead of crashing. */
export function parseSettings(raw: unknown): CourseSettings {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(courseSettingsSchema.shape) as (keyof CourseSettings)[]) {
    const field = courseSettingsSchema.shape[key];
    const r = field.safeParse(obj[key]);
    out[key] = r.success ? r.data : field.parse(undefined);
  }
  return out as CourseSettings;
}

export const has = (s: CourseSettings, t: ContentType) => s.contentTypes.includes(t);
export const questionTypesOn = (s: CourseSettings) =>
  (["multipleChoice", "shortAnswer", "stepProblems"] as const).filter((t) => has(s, t));
