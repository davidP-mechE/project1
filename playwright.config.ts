import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: the critical student journey in a real browser, with
 * accessibility (axe) and Content-Security-Policy checks on every page.
 *
 *   npm run test:e2e
 *
 * Builds the app and starts it on port 3100 (a production build: faster and
 * closer to the real site than the dev server), plus a worker, in demo mode
 * (FAKE_CLAUDE=true: free, no API key needed), against the database and Redis
 * in .env. Your own `npm run dev` can keep running.
 */
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
// Test output and uploaded files live outside the project folder: the dev
// server watches the project, and new files there can make it reload pages mid-test.
const OUT = path.join(os.tmpdir(), "coursebook-e2e");
// Phase 3b: an owner account for the Studio checks, and a Desmos key (the browser test answers for desmos.com itself, so nothing is sent there).
const env = { OWNER_EMAIL: process.env.E2E_OWNER_EMAIL ?? "e2e-owner@example.com", DESMOS_API_KEY: "e2e-not-a-real-key", FEATURED_PROGRAM_SLUG: "1600", FAKE_CLAUDE: "true", E2E_TEST: "true", STAFF_TWO_FACTOR: "off", APP_URL: BASE, PORT: String(PORT), LOCAL_STORAGE_DIR: path.join(OUT, "storage") };

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: path.join(OUT, "results"),
  fullyParallel: false,
  workers: 1,
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "off",
    actionTimeout: 30_000,
    navigationTimeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
  webServer: [
    {
      name: "web",
      command: `npm run build && npx next start -p ${PORT}`,
      url: `${BASE}/api/health`,
      env,
      timeout: 600_000, // includes the build
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
    {
      name: "worker",
      command: "npm run worker",
      env,
      wait: { stdout: /\[worker\] ready/ },
      timeout: 120_000,
      reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
  ],
});
