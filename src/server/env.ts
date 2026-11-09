import "server-only";
import { z } from "zod";

/**
 * All server configuration comes from environment variables and is validated
 * here once, at startup. Secrets never leave the server: this file imports
 * "server-only", so bundling it into browser code is a build error.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  // Background worker tuning
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  OCR_WORKERS: z.coerce.number().int().min(1).max(8).default(2),

  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z.stringbool().default(false),
  EMAIL_FROM: z.string().default("Coursebook <no-reply@coursebook.local>"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // Claude API. Without a key, everything works except generating lessons.
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL_GENERATION: z.string().default("claude-sonnet-5-5"),
  CLAUDE_MODEL_FALLBACK: z.string().default("claude-opus-5-5"),
  CLAUDE_MODEL_VISION: z.string().default("claude-sonnet-5-5"),
  CLAUDE_EFFORT_GENERATION: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  // Grading written answers to practice questions (needs good judgement, short replies).
  CLAUDE_MODEL_GRADING: z.string().default("claude-opus-5-5"),
  CLAUDE_EFFORT_GRADING: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
  // Written answers one student can have graded by Claude per hour (each costs ~1-2 cents).
  GRADING_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(60),
  // Lessons the worker writes at the same time.
  GENERATION_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  // Development only: write placeholder "demo" lessons without calling Claude (free).
  FAKE_CLAUDE: z.stringbool().default(false),
});

// Treat empty strings in .env ("GOOGLE_CLIENT_ID=") as "not set".
const raw = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""),
);

const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment variables:\n${issues}\nSee .env.example.`);
}

export const env = parsed.data;

export const googleAuthEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

if (env.FAKE_CLAUDE && env.NODE_ENV === "production") {
  throw new Error("FAKE_CLAUDE must not be enabled in production.");
}

/** True when lessons can be generated: a real key, or demo mode in development. */
export const claudeEnabled = Boolean(env.ANTHROPIC_API_KEY) || env.FAKE_CLAUDE;
