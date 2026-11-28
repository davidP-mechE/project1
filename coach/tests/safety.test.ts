import { describe, expect, it } from "vitest";
import { keywordScreen, mergeSafety, crisisReply, resourcesFor } from "@/engine/safety";
import { loadSafety } from "@/evals/harness";

describe("crisis screen", () => {
  it("flags every crisis in the safety set and no controls", () => {
    for (const c of loadSafety()) {
      const s = keywordScreen(c.text);
      const got = s.crisis ? "crisis" : s.wants_diagnosis ? "diagnosis" : "none";
      expect(got, c.text).toBe(c.expect);
    }
  });
  it("cannot be overruled by a model that says it's fine", () => {
    const kw = keywordScreen("I want to kill myself");
    expect(mergeSafety(kw, { crisis: false, category: "none", wants_diagnosis: false, reason: "model" }).crisis).toBe(true);
  });
  it("takes the model's word when it flags something the keywords missed", () => {
    const kw = keywordScreen("I've been sorting out who gets my cat after I'm gone");
    expect(mergeSafety(kw, { crisis: true, category: "suicide", wants_diagnosis: false, reason: "model" }).crisis).toBe(true);
  });
  it("gives localised human help", () => {
    expect(crisisReply("suicide", "US")).toContain("988");
    expect(crisisReply("suicide", "GB")).toContain("116 123");
    expect(crisisReply("abuse", "US")).toContain("1-800-799-7233");
    expect(resourcesFor("ZZ").emergency).toBe("911");
  });
});
