/**
 * Import the SAT course packets into the Course Studio, as drafts only the owner sees.
 * Import the Question Bank first (npm run import:bank): the practice sets are built from it.
 *
 *   npm run import:courses -- --dry-run            check both files, change nothing
 *   npm run import:courses                         import (safe to run again)
 *   npm run import:courses -- path/to/course.json  one file
 */
import { readFile } from "node:fs/promises";
import { importCoursePacket } from "@/server/packet-import";
import { db } from "@/server/db";

const DEFAULT = ["data/course-packets/coursebook_sat_math_course.json", "data/course-packets/coursebook_sat_rw_course.json"];

async function main() {
  const args = process.argv.slice(2);
  const commit = !args.includes("--dry-run");
  const files = args.filter((a) => !a.startsWith("--"));
  const owner = process.env.OWNER_EMAIL ? await db.user.findUnique({ where: { email: process.env.OWNER_EMAIL.trim().toLowerCase() }, select: { id: true } }) : null;
  let bad = false;
  for (const file of files.length ? files : DEFAULT) {
    const r = await importCoursePacket({ json: await readFile(file, "utf8"), commit, ownerId: owner?.id ?? null });
    const q = r.questionIds;
    console.info(`\n${r.title} (${r.slug}): ${commit ? `course ${r.course}, as a draft` : "dry run, nothing changed"}`);
    console.info(`  ${r.units} units, ${r.lessons} lessons (unit review sets are a last lesson in each unit), ${r.sets} sets`);
    console.info(`  blocks: ${Object.entries(r.blocksByType).map(([k, v]) => `${v} ${k}`).join(", ")}`);
    console.info(`  question ids: ${q.referenced} referenced, ${q.found} found in the bank (${q.referenced ? ((q.found / q.referenced) * 100).toFixed(1) : "100"}%)${q.missing.length ? `; missing: ${q.missing.slice(0, 30).join(", ")}` : ""}`);
    for (const w of r.warnings) console.info(`  warning: ${w}`);
    if (q.missing.length) bad = true;
  }
  await db.$disconnect();
  if (bad) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.$disconnect();
  process.exit(1);
});
