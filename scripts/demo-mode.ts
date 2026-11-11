/**
 * Demo mode: fill the app with invented data to try the class features, or
 * remove it again. Every demo record is flagged isDemo and is deleted in one step.
 *   npm run demo:load    (clears any earlier demo data first)
 *   npm run demo:clear
 * Also available to the site admin under Admin → Demo data.
 */
import { clearDemoData, loadDemoData, DEMO_CLASS_NAME } from "../src/server/demo-data";

async function main() {
  const cmd = process.argv[2];
  if (cmd === "clear") {
    const r = await clearDemoData();
    console.log(r.removedUsers ? `Demo data cleared (${r.removedUsers} demo accounts and everything they owned).` : "No demo data to clear.");
    return;
  }
  if (cmd === "load") {
    await clearDemoData();
    const r = await loadDemoData();
    console.log(`Loaded "${DEMO_CLASS_NAME}" with ${r.students} students. Join code ${r.joinCode}.`);
    console.log(`Sign in as the tutor: ${r.tutorEmail} / ${r.password}`);
    console.log(`Students: student1@… to student${r.students}@ the same domain, same password.`);
    return;
  }
  console.error("Usage: demo-mode.ts load|clear");
  process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
