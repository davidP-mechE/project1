import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { importCollegeBoardRecords, readCollegeBoardUpload, toRecord } from "@/server/college-board";
import { ensureReferenceData } from "@/server/seed/reference";
import { resetDb } from "../helpers/db";

beforeEach(async () => {
  await resetDb();
  await ensureReferenceData({ onlyIfEmpty: false });
});

const read = {
  cbQuestionId: "5EF6-F9C3",
  section: "rw" as const,
  skill: "Boundaries",
  difficulty: "medium" as const,
  type: "mcq" as const,
  stem: "Question ID 5ef6f9c3\nThe ﬁrst tunnel opened in ______ second followed later.\n\nWhich choice completes the text so that it conforms to the conventions of Standard English?",
  choices: ["A) 1911, the", "B) 1911; the", "C) 1911 the", "D) 1911, however, the"],
  answer: "(B)",
  explanation: "Rationale\nChoice B is the best answer.",
  hasFigure: false,
  figureNote: "",
};

describe("College Board questions", () => {
  it("turns a transcribed question into a clean import record", () => {
    expect(toRecord(read)).toEqual({
      external_id: "CB-5ef6f9c3",
      source: "college_board",
      section: "rw",
      skill: "Boundaries",
      difficulty: 2,
      type: "mcq",
      stem: "The first tunnel opened in ______ second followed later.\n\nWhich choice completes the text so that it conforms to the conventions of Standard English?",
      choice_a: "1911, the",
      choice_b: "1911; the",
      choice_c: "1911 the",
      choice_d: "1911, however, the",
      answer: "B",
      explanation: "Choice B is the best answer.",
    });
  });

  it("adds checked questions as College Board drafts, once", async () => {
    const tutor = await db.user.create({ data: { id: "t1", name: "Tutor", email: "t@example.com", emailVerified: true, role: "TUTOR" } });
    const rec = toRecord(read);
    const r = await importCollegeBoardRecords(tutor.id, [{ ...rec, source: "original" }]);
    expect(r.imported).toBe(1);
    const q = await db.bankQuestion.findUniqueOrThrow({ where: { externalId: "CB-5ef6f9c3" }, include: { skill: true } });
    expect(q).toMatchObject({ source: "college_board", status: "draft", answer: "B", authorId: tutor.id });
    expect(q.skill?.name).toBe("Boundaries");
    expect((await importCollegeBoardRecords(tutor.id, [rec])).imported).toBe(0); // already there
  });

  it("is for question authors only", async () => {
    const student = await db.user.create({ data: { id: "s1", name: "Student", email: "s@example.com", emailVerified: true } });
    await expect(importCollegeBoardRecords(student.id, [toRecord(read)])).rejects.toThrow();
    await expect(readCollegeBoardUpload(student.id, { kind: "text", text: "anything" })).rejects.toThrow();
    expect(await db.bankQuestion.count()).toBe(0);
  });
});
