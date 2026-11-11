/**
 * Reference data and The 1600 Project's question file.
 *
 *   npm run db:seed
 *
 * Safe to run again: anything already there is skipped. Loads skills, error
 * types, the practice-test catalog (names and module sizes only), the two draft
 * studio courses, and (from step 2) the weeks 3–6 question file as drafts.
 * Nothing seeded is College Board content.
 */
import { ensureReferenceData } from "../src/server/seed/reference";
import { syncOwnerRole } from "../src/server/roles";
import { db } from "../src/server/db";

async function main() {
  const ref = await ensureReferenceData({ onlyIfEmpty: false });
  console.log(`Reference data: +${ref.skills} skills, +${ref.errorTypes} error types, +${ref.tests} practice tests, +${ref.courses} studio courses.`);
  const roles = await syncOwnerRole();
  console.log(process.env.OWNER_EMAIL ? `Owner role: ${roles.promoted ? "given to OWNER_EMAIL" : "already set (or that account doesn't exist yet)"}.` : "OWNER_EMAIL isn't set: no owner.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
