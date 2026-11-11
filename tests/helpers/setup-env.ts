import os from "node:os";
import path from "node:path";
import { config } from "dotenv";

// Load .env, then point everything at the TEST database and a temp storage folder.
config({ quiet: true });
const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error("TEST_DATABASE_URL must be set to run tests (see .env.example).");
process.env.DATABASE_URL = testDb;
process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `coursebook-test-storage-${process.pid}`);
process.env.STORAGE_DRIVER = "local";
process.env.SMTP_HOST = "";
process.env.BETTER_AUTH_SECRET ||= "test-secret-test-secret-test-secret";
(process.env as Record<string, string>).NODE_ENV = "test";
// A dummy key so "is generation set up?" checks pass. Tests never call the real API:
// they inject a fake writer (tests/helpers/fake-claude.ts).
process.env.ANTHROPIC_API_KEY = "test-key-not-real";
process.env.STAFF_TWO_FACTOR = "off"; // the permission tests turn it on where they check it
process.env.CLAUDE_BATCH_GENERATION = "false"; // the direct path; batch tests drive the batch path themselves
