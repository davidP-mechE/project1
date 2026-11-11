import { describe, expect, it } from "vitest";
import { looksLikeSat, SAT_CURRICULUM } from "@/lib/tutor/sat-curriculum";

describe("SAT curriculum for the tutor", () => {
  it("recognises SAT courses by title, Hub course or class program", () => {
    expect(looksLikeSat({ title: "SAT Math" })).toBe(true);
    expect(looksLikeSat({ title: "My copy", catalogTitle: "SAT EBRW" })).toBe(true);
    expect(looksLikeSat({ title: "Algebra review", programSubject: "SAT" })).toBe(true);
    expect(looksLikeSat({ title: "PSAT prep" })).toBe(true);
  });

  it("leaves other courses alone", () => {
    expect(looksLikeSat({ title: "Biology 2e" })).toBe(false);
    expect(looksLikeSat({ title: "Saturn and the outer planets" })).toBe(false);
    expect(looksLikeSat({ title: "Chemistry", programSubject: null })).toBe(false);
  });

  it("covers all eight scored domains and keeps the book as the only source of facts", () => {
    for (const d of ["Information and Ideas", "Craft and Structure", "Expression of Ideas", "Standard English Conventions", "Algebra", "Advanced Math", "Problem-Solving and Data Analysis", "Geometry and Trigonometry"]) {
      expect(SAT_CURRICULUM).toContain(d);
    }
    expect(SAT_CURRICULUM).toMatch(/not a source of facts/);
  });
});
