import { describe, expect, it } from "vitest";
import { cleanInline, cleanQuestionText, stripChoiceLetter } from "@/lib/bank/clean-text";

describe("cleaning College Board text", () => {
  it("drops Question Bank page clutter but keeps the question", () => {
    const raw = [
      "Question ID 5ef6f9c3",
      "Assessment Test Domain Skill Difficulty",
      "Assessment",
      "SAT",
      "Skill",
      "Boundaries",
      "The ﬁrst bridge was built in 1911 and it is still in use ______",
      "",
      "",
      "",
      "Which choice completes the text?",
      "ID: 5ef6f9c3 Answer",
      "Correct Answer: B",
      "Page 3 of 12",
      "© 2025 College Board",
    ].join("\n");
    expect(cleanQuestionText(raw)).toBe("Boundaries\nThe first bridge was built in 1911 and it is still in use ______\n\nWhich choice completes the text?");
  });

  it("fixes PDF leftovers: soft hyphens, zero-width and replacement characters, odd spaces, split words", () => {
    expect(cleanQuestionText("photo-\nsynthesis­ is​ key� here")).toBe("photosynthesis is key here");
    expect(cleanQuestionText("a  b\t c")).toBe("a b c");
  });

  it("keeps real dashes, blanks and math", () => {
    const s = "The boto—a dolphin—hunts. If $3x - 2 = 7$, then ______\n\n• note one\n• note two";
    expect(cleanQuestionText(s)).toBe(s);
  });

  it("cleans one-line fields and drops choice letters", () => {
    expect(cleanInline(" hall,\n visitors ")).toBe("hall, visitors");
    expect(stripChoiceLetter("A) 12")).toBe("12");
    expect(stripChoiceLetter("(B) its")).toBe("its");
    expect(stripChoiceLetter("C. it's")).toBe("it's");
    expect(stripChoiceLetter("A lighter frame")).toBe("A lighter frame");
  });
});
