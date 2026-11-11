/**
 * Reference data and The 1600 Project's question file.
 *
 *   npm run db:seed
 *
 * Safe to run again: anything already there is skipped. Loads skills, error
 * types, the practice-test catalog (names and module sizes only), the two draft
 * studio courses, and the weeks 3–6 question file as drafts with one draft set per week.
 * Nothing seeded is College Board content.
 */
import { ensureReferenceData } from "../src/server/seed/reference";
import { syncOwnerRole } from "../src/server/roles";
import { db } from "../src/server/db";
import { QUESTION_FILE, seedQuestionFile } from "../src/server/seed/questions";

async function main() {
  const ref = await ensureReferenceData({ onlyIfEmpty: false });
  console.log(`Reference data: +${ref.skills} skills, +${ref.errorTypes} error types, +${ref.tests} practice tests, +${ref.courses} studio courses.`);
  const roles = await syncOwnerRole();
  const q = await seedQuestionFile();
  const { report } = q;
  console.log(`${QUESTION_FILE}: ${report.rows.length} rows, ${report.imported} imported as drafts, ${report.skipped.length} already in the bank, ${report.failed} failed.`);
  for (const r of report.rows.filter((x) => !x.ok)) console.log(`  row ${r.row} (${r.externalId ?? "no id"}): ${r.errors.join(" ")}`);
  for (const s of q.sets) console.log(`  Set "${s.title}": ${s.count} questions${s.created ? " (created, draft)" : " (already there)"}`);
  if (!q.authorFound) console.log("  No owner account yet: the questions have no author until the OWNER_EMAIL account exists and you run this again.");
  console.log(process.env.OWNER_EMAIL ? `Owner role: ${roles.promoted ? "given to OWNER_EMAIL" : "already set (or that account doesn't exist yet)"}.` : "OWNER_EMAIL isn't set: no owner.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
