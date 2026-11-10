/** Rate-limit rules and the window math (pure, so it can be unit-tested). */

export type RateRule = { name: string; max: number; windowSeconds: number };

export const RATE_RULES = {
  /** Course downloads (the Anki deck is built on the server). */
  export: { name: "export", max: 30, windowSeconds: 10 * 60 },
  /** Checking practice answers (multiple choice is free, but still a database write). */
  answer: { name: "answer", max: 120, windowSeconds: 60 },
  /** Submitting a unit test or the final exam. */
  testSubmit: { name: "test-submit", max: 20, windowSeconds: 60 * 60 },
  /** Review: asking Claude for more questions on a skill (each request writes 5). */
  skillQuestions: { name: "skill-questions", max: 30, windowSeconds: 60 * 60 },
  /** Trying class join codes (stops guessing codes). */
  classJoin: { name: "class-join", max: 10, windowSeconds: 60 * 60 },
  /** Class invitation emails a teacher can send. */
  classInvite: { name: "class-invite", max: 100, windowSeconds: 24 * 60 * 60 },
  /** Staff invitations and resends (each sends an email). */
  staffInvite: { name: "staff-invite", max: 40, windowSeconds: 24 * 60 * 60 },
  /** Assistant work that calls Claude on request: curriculum imports, drafts, summaries. */
  aiDraft: { name: "ai-draft", max: 30, windowSeconds: 24 * 60 * 60 },
  /** Questions to the class-data assistant. */
  aiAsk: { name: "ai-ask", max: 40, windowSeconds: 24 * 60 * 60 },
  /** Worksheet uploads (each is read by Claude). */
  worksheetUpload: { name: "worksheet-upload", max: 20, windowSeconds: 60 * 60 },
} satisfies Record<string, RateRule>;

/** Which window `now` falls in, and how long until it ends. */
export function fixedWindow(nowMs: number, windowSeconds: number): { bucket: number; resetsInMs: number } {
  const size = windowSeconds * 1000;
  const bucket = Math.floor(nowMs / size);
  return { bucket, resetsInMs: (bucket + 1) * size - nowMs };
}
