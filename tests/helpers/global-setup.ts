import { execSync } from "node:child_process";
import { config } from "dotenv";

/** Before any test runs: bring the test database schema up to date. */
export default function setup() {
  config({ quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL must be set to run tests.");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
