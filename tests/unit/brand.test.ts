import { describe, expect, it } from "vitest";
import { BRAND, badgeText } from "@/lib/brand";

describe("brand", () => {
  it("is Coursebook site-wide, with no program in it", () => {
    expect(BRAND.name).toBe("Coursebook");
    expect(JSON.stringify(BRAND)).not.toMatch(/1600/);
  });
  it("derives a program's badge text", () => {
    expect(badgeText({ name: "The 1600 Project" })).toBe("1600");
    expect(badgeText({ name: "Riverside Reading Club" })).toBe("RRC");
    expect(badgeText({ name: "Alex's tutoring program" })).toBe("ATP");
    expect(badgeText({ name: "Anything", badge: "sat" })).toBe("SAT");
  });
});
