/** Rate-limit rules and the window math (pure, so it can be unit-tested). */

export type RateRule = { name: string; max: number; windowSeconds: number };

export const RATE_RULES = {
  /** Course downloads (the Anki deck is built on the server). */
  export: { name: "export", max: 30, windowSeconds: 10 * 60 },
  /** Checking practice answers (multiple choice is free, but still a database write). */
  answer: { name: "answer", max: 120, windowSeconds: 60 },
  /** Submitting a unit test or the final exam. */
  testSubmit: { name: "test-submit", max: 20, windowSeconds: 60 * 60 },
} satisfies Record<string, RateRule>;

/** Which window `now` falls in, and how long until it ends. */
export function fixedWindow(nowMs: number, windowSeconds: number): { bucket: number; resetsInMs: number } {
  const size = windowSeconds * 1000;
  const bucket = Math.floor(nowMs / size);
  return { bucket, resetsInMs: (bucket + 1) * size - nowMs };
}
