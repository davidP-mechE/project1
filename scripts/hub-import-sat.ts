/**
 * Add The 1600 Project's SAT courses ("SAT Math" and "SAT EBRW", built from the
 * lesson slide decks in content/hub/) to the Hub. They belong to a site admin and
 * are published straight away. Running it again skips a course that's already there.
 *
 *   npm run hub:sat                          (owner: the first site admin)
 *   npm run hub:sat -- --owner you@example.com
 *
 * No Claude calls. Uses DATABASE_URL and storage settings from .env.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { hubOwner, importSlideCourse } from "../src/server/hub-import";

const COURSES = ["sat-math", "sat-ebrw"];

async function main() {
  const i = process.argv.indexOf("--owner");
  const owner = await hubOwner(i > 0 ? process.argv[i + 1] : undefined);
  const dir = path.join(process.cwd(), "content/hub");
  for (const key of COURSES) {
    const data = JSON.parse(readFileSync(path.join(dir, `${key}.json`), "utf8"));
    const pdf = readFileSync(path.join(dir, `${key}.pdf`));
    const r = await importSlideCourse(owner.id, data, pdf);
    console.log(
      r.status === "exists"
        ? `"${data.title}" is already on the Hub. Skipped.`
        : `Added "${data.title}" to the Hub (${r.lessons} lessons, ${r.slides} slides), owned by ${owner.email}.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
