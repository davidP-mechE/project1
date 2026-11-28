import "server-only";

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://coach:coach@localhost:5432/coach",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  COACH_MODEL_MAIN: process.env.COACH_MODEL_MAIN ?? "claude-opus-5-5",
  COACH_MODEL_FAST: process.env.COACH_MODEL_FAST ?? "claude-haiku-5-5",
  COACH_COOKIE_SECRET: process.env.COACH_COOKIE_SECRET ?? "",
  COACH_DATA_KEY: process.env.COACH_DATA_KEY ?? "",
  production: process.env.NODE_ENV === "production",
};

/** Checked on first use (not at import, so `next build` works without secrets). */
export function assertSecrets() {
  if (env.production && (!env.COACH_COOKIE_SECRET || !env.COACH_DATA_KEY) && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("COACH_COOKIE_SECRET and COACH_DATA_KEY are required in production");
  }
}
