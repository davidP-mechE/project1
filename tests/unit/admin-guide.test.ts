import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("admin guide", () => {
  it("only mentions npm scripts that exist", () => {
    const guide = readFileSync("ADMIN_GUIDE.md", "utf8");
    const scripts = Object.keys(JSON.parse(readFileSync("package.json", "utf8")).scripts);
    const used = [...guide.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(3);
    for (const s of used) expect(scripts, `npm run ${s}`).toContain(s);
  });
});
