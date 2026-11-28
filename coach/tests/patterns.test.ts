import { describe, expect, it } from "vitest";
import { findPatterns, gate, patternQuestion, profileFrom } from "@/engine/patterns";
import { patternFixtures, runPatternFixtures } from "@/evals/harness";
import { conceptVector, cosine } from "@/engine/embed";

describe("pattern recognition", () => {
  it("passes every fixture and never shows a pattern that breaks the rules", () => {
    const r = runPatternFixtures();
    expect(r.details).toEqual([]);
    expect(r.shownViolatingRules).toBe(0);
  });
  it("doesn't re-suggest a rejected pattern from the same evidence, but does with new evidence", () => {
    const f = patternFixtures()[0];
    const { shown } = findPatterns(f.episodes);
    const rejection = { key: shown[0].key, episode_ids: shown[0].episode_ids };
    expect(findPatterns(f.episodes, [rejection]).shown).toHaveLength(0);
    const more = [...f.episodes, { ...f.episodes[1], episode_id: "d", people: ["sister"] }];
    const again = findPatterns(more, [rejection]).shown;
    expect(again).toHaveLength(1);
    expect(gate(again[0], [rejection]).show).toBe(true);
  });
  it("asks rather than tells, with evidence", () => {
    const f = patternFixtures()[0];
    const q = patternQuestion(findPatterns(f.episodes).shown[0], f.episodes);
    expect(q).toMatch(/Does that ring true/);
    expect(q).toMatch(/Three times/);
  });
  it("puts different wording for the same theme near each other", () => {
    const a = conceptVector("left out of the group chat");
    const b = conceptVector("boss decided without asking me");
    const c = conceptVector("I failed my driving test");
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });
  it("builds the profile only from confirmed episodes", () => {
    const f = patternFixtures()[3];
    const p = profileFrom(f.episodes);
    expect(p.triggers.reduce((s, t) => s + t.count, 0)).toBe(1);
  });
});
