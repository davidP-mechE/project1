import { describe, expect, it } from "vitest";
import { classifySubject, isSubjectId, subjectOf, SUBJECTS } from "@/lib/subjects";
import { HAMMER_STREAK, isDue, QUESTION_INTERVALS, questionSchedule, skillKey, skillStats, type Attempt } from "@/lib/mastery/review";
import { questionsUserMessage } from "@/lib/ai/prompts";
import { DEFAULT_SETTINGS } from "@/lib/course/settings";

const day = 86_400_000;
const t0 = new Date("2026-11-01T12:00:00Z");
const at = (days: number, correct: boolean, score = correct ? 1 : 0): Attempt => ({ correct, score, at: new Date(t0.getTime() + days * day) });

describe("subjects", () => {
  it.each([
    ["College Algebra 2e", "Functions\nPolynomial and Rational Functions\nExponential and Logarithmic Functions", "math"],
    ["Calculus Volume 1", "Limits\nDerivatives\nApplications of Integration", "math"],
    ["University Physics Volume 2", "Electric Charges and Fields\nCurrent and Resistance\nMagnetic Forces", "physics"],
    ["Chemistry 2e", "Atoms, Molecules, and Ions\nStoichiometry of Chemical Reactions\nAcid-Base Equilibria", "chemistry"],
    ["Biology 2e", "The Cell\nGenetics\nEvolution and the Origin of Species", "biology"],
    ["Anatomy and Physiology 2e", "Tissue\nThe Immune System", "biology"],
    ["Astronomy 2e", "Earth, Moon, and Sky\nThe Solar System\nGalaxies", "earth-space"],
    ["Introduction to Python Programming", "Variables\nLoops\nFunctions", "computer-science"],
    ["Writing Guide with Handbook", "Essay structure\nArgument\nGrammar", "ela"],
    ["U.S. History", "The Revolution\nThe Constitution\nCivil War", "social-studies"],
    ["Introduction to Psychology 2e", "Memory\nLearning", "social-studies"],
    ["Principles of Macroeconomics 3e", "Supply and demand\nInflation\nGDP", "economics"],
    ["Fundamentals of Nursing", "Patient care\nClinical judgment", "health"],
    ["Intro to Circuits", "Electric charge\nOhm's law\nVoltage and current", "physics"],
  ])("%s → %s", (title, outline, expected) => {
    expect(classifySubject(title, outline).subject).toBe(expected);
  });

  it("says Other when there's no clear evidence", () => {
    expect(classifySubject("My notes", "Week 1\nWeek 2").subject).toBe("other");
  });

  it("knows the subject list", () => {
    expect(isSubjectId("math")).toBe(true);
    expect(isSubjectId("astrology")).toBe(false);
    expect(subjectOf("nope").id).toBe("other");
    expect(new Set(SUBJECTS.map((s) => s.id)).size).toBe(SUBJECTS.length);
  });
});

describe("spaced repetition for questions", () => {
  it("brings a miss back the next day", () => {
    const s = questionSchedule([at(0, true), at(2, false)]);
    expect(s.streak).toBe(0);
    expect(s.due!.getTime()).toBe(t0.getTime() + 3 * day);
  });
  it("waits longer after each right answer in a row", () => {
    expect(questionSchedule([at(0, false), at(1, true)]).due!.getTime()).toBe(t0.getTime() + (1 + QUESTION_INTERVALS[0]) * day);
    expect(questionSchedule([at(0, true), at(1, true)]).due!.getTime()).toBe(t0.getTime() + (1 + QUESTION_INTERVALS[1]) * day);
    const many = Array.from({ length: 12 }, (_, i) => at(i, true));
    expect(questionSchedule(many).streak).toBe(12);
    expect(questionSchedule(many).due!.getTime()).toBe(t0.getTime() + (11 + QUESTION_INTERVALS[QUESTION_INTERVALS.length - 1]) * day);
  });
  it("ignores answer order in the input and reports due-ness", () => {
    const s = questionSchedule([at(5, true), at(0, false)]);
    expect(s.lastAt).toEqual(at(5, true).at);
    expect(isDue(s, new Date(t0.getTime() + 5.5 * day))).toBe(false);
    expect(isDue(s, new Date(t0.getTime() + 6 * day))).toBe(true);
    expect(isDue(questionSchedule([]), new Date())).toBe(false);
  });
});

describe("skills", () => {
  it("groups topics written slightly differently", () => {
    expect(skillKey("  Ohm’s   Law ")).toBe(skillKey("ohm's law"));
  });
  it("rates a skill from its answers", () => {
    expect(skillStats([]).status).toBe("new");
    expect(skillStats([at(0, false), at(1, false), at(2, true)]).status).toBe("shaky");
    expect(skillStats([at(0, false), at(1, true), at(2, true)]).status).toBe("improving");
    const run = [at(0, false), ...Array.from({ length: HAMMER_STREAK }, (_, i) => at(i + 1, true))];
    const s = skillStats(run);
    expect(s).toMatchObject({ status: "hammered", recentStreak: HAMMER_STREAK, attempts: HAMMER_STREAK + 1, correct: HAMMER_STREAK });
  });
  it("tells Claude to write every question on one skill", () => {
    const msg = questionsUserMessage({
      courseTitle: "Circuits",
      unitTitle: "Ohm",
      lessonTitle: "Ohm's law",
      pageStart: 7,
      pageEnd: 8,
      pages: [],
      settings: DEFAULT_SETTINGS,
      focus: 'Ohm\'s "law"',
      avoid: ["Old question"],
    });
    expect(msg).toContain(`Every question must test the skill "Ohm's 'law'"`);
    expect(msg).toContain("- Old question");
  });
});
