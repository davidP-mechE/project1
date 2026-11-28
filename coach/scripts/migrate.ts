import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

/** Applies db/migrations/*.sql in order, once each. Usage: npm run db:migrate [-- --test] */
async function main() {
  const url = process.argv.includes("--test") ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const dir = path.join(process.cwd(), "db", "migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const done = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
    if (done.rowCount) continue;
    await client.query("BEGIN");
    await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`applied ${file}`);
  }
  await client.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
