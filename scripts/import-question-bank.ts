/**
 * Import the in-house College Board Question Bank.
 *
 *   npm run import:bank -- --dry-run          check the file and images, change nothing
 *   npm run import:bank                       import (safe to run again)
 *   npm run import:bank -- --dir <folder>     folder with coursebook_sat_question_bank.json and qbank_images/
 *
 * Default folder: data/course-packets. These files are never committed (see .gitignore).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { importQuestionBank } from "@/server/qbank-import";
import { readResults } from "@/server/qbank-transcribe";
import { db } from "@/server/db";

async function main() {
  const args = process.argv.slice(2);
  const dir = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : "data/course-packets";
  const commit = !args.includes("--dry-run");
  const json = await readFile(path.join(dir, "coursebook_sat_question_bank.json"), "utf8");
  const transcriptions = await readResults(dir);
  const r = await importQuestionBank({ json, imageDir: path.join(dir, "qbank_images"), commit, transcriptions, onProgress: (m) => console.info(`  ${m}`) });
  console.info(`\n${commit ? "Imported" : "Dry run (nothing changed)"}: ${r.items} items, ${r.created} new, ${r.updated} already in the bank (${commit ? "updated" : "would be updated"}), ${r.failed.length} failed.`);
  console.info("By section:", r.bySection);
  console.info("By difficulty:", r.byDifficulty);
  console.info("By skill:");
  for (const [k, v] of Object.entries(r.bySkill).sort()) console.info(`  ${String(v).padStart(4)}  ${k}`);
  console.info(`Images: ${r.images.referenced} referenced${commit ? `, ${r.images.uploaded} uploaded, ${r.images.alreadyStored} already stored` : ""}, ${r.images.missing.length} missing${r.images.missing.length ? `: ${r.images.missing.slice(0, 20).join(", ")}` : ""}`);
  if (r.failed.length) {
    console.info("Failed rows:");
    for (const f of r.failed.slice(0, 100)) console.info(`  ${f.questionId}: ${f.errors.join(" ")}`);
  }
  console.info(
    transcriptions
      ? `Text versions: ${r.text.asText} shown as text, ${r.text.review} waiting for your review (Course Studio → Transcriptions), ${r.text.keptImage} kept as images; ${r.text.figures} figures cut out.`
      : "No transcriptions yet (npm run transcribe:bank): image-only items are shown as images.",
  );
  if (r.notes.length) console.info(`${r.notes.length} answer keys were read from the rationale image (spot-check them): ${r.notes.map((n) => n.questionId).join(", ")}`);
  await db.$disconnect();
  if (r.failed.length) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.$disconnect();
  process.exit(1);
});
