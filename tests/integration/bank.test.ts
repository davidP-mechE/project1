import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import * as bank from "@/server/bank";
import { syncOwnerRole } from "@/server/roles";
import { ensureReferenceData } from "@/server/seed/reference";
import { seedQuestionFile, WEEK_SETS } from "@/server/seed/questions";
import { createUser, resetDb } from "../helpers/db";

const root = path.resolve(import.meta.dirname, "../..");
const savedOwner = process.env.OWNER_EMAIL;

async function people() {
  const owner = await createUser("Owner");
  const tutor = await createUser("Tutor");
  const student = await createUser("Student");
  process.env.OWNER_EMAIL = owner.email;
  await syncOwnerRole();
  await db.user.update({ where: { id: tutor.id }, data: { role: "TUTOR" } });
  return { owner, tutor, student };
}

const mcq = {
  external_id: "T-1",
  section: "math",
  skill: "Linear equations in one variable",
  difficulty: 1,
  type: "mcq",
  stem: "If $2(x - 4) = -2$, what is $x$?",
  choice_a: "1",
  choice_b: "-1",
  choice_c: "-5",
  choice_d: "3",
  answer: "D",
  explanation: "Divide by 2, then add 4.",
  distractor_notes: { A: "Didn't distribute.", B: "Stopped early.", C: "Wrong sign." },
};
const grid = { ...mcq, external_id: "T-2", type: "grid-in", stem: "What is 3 divided by 4?", answer: "3/4", distractor_notes: { "4/3": "Flipped it." }, choice_a: "", choice_b: "", choice_c: "", choice_d: "" };

describe("question bank", () => {
  beforeAll(async () => {
    await ensureReferenceData();
  });
  beforeEach(resetDb);
  afterAll(() => {
    process.env.OWNER_EMAIL = savedOwner;
  });

  it("imports all 240 questions from the 1600 Project file as drafts, with the four week sets", async () => {
    const { owner } = await people();
    const { report, sets } = await seedQuestionFile(root);
    expect(report.failed).toBe(0);
    expect(report.imported).toBe(240);
    expect(await db.bankQuestion.count({ where: { status: "draft", source: "original", authorId: owner.id } })).toBe(240);
    const q = await db.bankQuestion.findUniqueOrThrow({ where: { externalId: "W3-01" }, include: { skill: true } });
    expect(q).toMatchObject({ week: 3, lesson: "1.1", blueprint: "L1", answer: "D", answerText: "3", type: "mcq" });
    expect(q.skill?.name).toBe("Linear equations in one variable");
    expect(q.distractorNotes).toMatchObject({ A: expect.any(String), B: expect.any(String), C: expect.any(String) });
    const g = await db.bankQuestion.findUniqueOrThrow({ where: { externalId: "W3-25" } });
    expect(g.type).toBe("grid_in");
    expect(g.distractorNotes).toHaveProperty("−5");
    expect(sets.map((s) => [s.title, s.count])).toEqual(WEEK_SETS.map((w) => [w.title, 60]));
    expect(await db.questionSet.count({ where: { status: "draft" } })).toBe(4);
    // Running it again adds nothing.
    const again = await seedQuestionFile(root);
    expect(again.report.imported).toBe(0);
    expect(again.report.skipped).toHaveLength(240);
    expect(await db.questionSet.count()).toBe(4);
  });

  it("previews row-level errors, imports the good rows, and ignores unknown fields", async () => {
    const { tutor } = await people();
    const rows = [{ ...mcq, mystery_field: "ignored" }, { ...mcq, external_id: "T-bad", answer: "E" }, { ...mcq, external_id: "T-cb", source: "college board" }, { ...grid }];
    const preview = await bank.importQuestions(tutor.id, JSON.stringify(rows), "json", { commit: false });
    expect(preview.failed).toBe(2);
    expect(preview.imported).toBe(2);
    expect(preview.rows[1].errors.join(" ")).toMatch(/letter A–D/);
    expect(preview.rows[2].errors.join(" ")).toMatch(/Only original/);
    expect(await db.bankQuestion.count()).toBe(0);
    const done = await bank.importQuestions(tutor.id, JSON.stringify(rows), "json", { commit: true });
    expect(done.imported).toBe(2);
    expect(await db.bankQuestion.count({ where: { status: "draft" } })).toBe(2);
  });

  it("imports CSV with JSON distractor notes", async () => {
    const { tutor } = await people();
    const csv = 'external_id,section,skill,difficulty,type,stem,choice_a,choice_b,choice_c,choice_d,answer,explanation,distractor_notes,whatever\nC-1,math,Percentages,2,mcq,What is 10% of 50?,5,10,50,500,A,Move the point.,"{""B"":""Used 20%.""}",x\n';
    const r = await bank.importQuestions(tutor.id, csv, "csv", { commit: true });
    expect(r.failed).toBe(0);
    expect(r.rows[0].row).toBe(2);
    expect((await db.bankQuestion.findUniqueOrThrow({ where: { externalId: "C-1" } })).distractorNotes).toEqual({ B: "Used 20%." });
  });

  it("only the owner and approved tutors can use the bank; students get 'not found'", async () => {
    const { owner, tutor, student } = await people();
    const q = await bank.createQuestion(owner.id, mcq);
    await expect(bank.listBank(student.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bank.getBankQuestion(student.id, q.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bank.createQuestion(student.id, { ...mcq, external_id: "S-1" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bank.importQuestions(student.id, "[]", "json", { commit: true })).rejects.toBeInstanceOf(NotFoundError);
    expect((await bank.listBank(tutor.id)).total).toBe(1);
    await expect(bank.updateQuestion(tutor.id, q.id, { ...mcq, stem: "Changed" })).rejects.toThrow(/author/);
  });

  it("students see published questions in published, public sets only", async () => {
    const { owner, student } = await people();
    const a = await bank.createQuestion(owner.id, mcq, { publish: true });
    const b = await bank.createQuestion(owner.id, grid); // a draft
    const set = await bank.createSet(owner.id, { title: "Mixed", questionIds: [a.id, b.id], visibility: "public" });
    await expect(bank.startPractice(student.id, set.id)).rejects.toBeInstanceOf(NotFoundError); // draft set
    await bank.setSetStatus(owner.id, set.id, "published");
    const { sessionId } = await bank.startPractice(student.id, set.id);
    const state = await bank.practiceState(student.id, sessionId);
    expect(state.questions.map((q) => q.id)).toEqual([a.id]);
    expect(JSON.stringify(state.questions)).not.toMatch(/Didn't distribute|Divide by 2/); // no answers or notes before answering
    await expect(bank.answerPractice(student.id, sessionId, b.id, "3/4", 5)).rejects.toBeInstanceOf(NotFoundError);
    expect(await bank.practiceCatalog(student.id)).toEqual([expect.objectContaining({ id: set.id, count: 1 })]);
    const priv = await bank.createSet(owner.id, { title: "Private", questionIds: [a.id] });
    await bank.setSetStatus(owner.id, priv.id, "published");
    await expect(bank.startPractice(student.id, priv.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a wrong choice shows its likely mistake; a grid-in of 0.75 is accepted for 3/4", async () => {
    const { owner, student } = await people();
    const a = await bank.createQuestion(owner.id, mcq, { publish: true });
    const b = await bank.createQuestion(owner.id, grid, { publish: true });
    const set = await bank.createSet(owner.id, { title: "S", questionIds: [a.id, b.id], visibility: "public" });
    await bank.setSetStatus(owner.id, set.id, "published");
    const { sessionId } = await bank.startPractice(student.id, set.id);
    const wrong = await bank.answerPractice(student.id, sessionId, a.id, "A", 12);
    expect(wrong).toMatchObject({ correct: false, likelyMistake: "Didn't distribute.", explanation: "Divide by 2, then add 4." });
    await expect(bank.answerPractice(student.id, sessionId, a.id, "D", 3)).rejects.toThrow(/already answered/);
    expect(await bank.answerPractice(student.id, sessionId, b.id, "0.75", 9)).toMatchObject({ correct: true });
    const s2 = (await bank.startPractice(student.id, set.id)).sessionId;
    expect(await bank.answerPractice(student.id, s2, b.id, "4/3", 9)).toMatchObject({ correct: false, likelyMistake: "Flipped it." });
    expect(await bank.finishPractice(student.id, sessionId)).toEqual({ correct: 1, answered: 2 });
  });

  it("editing a published question makes a new version; old attempts keep the old one", async () => {
    const { owner, student } = await people();
    const q = await bank.createQuestion(owner.id, mcq, { publish: true });
    const set = await bank.createSet(owner.id, { title: "S", questionIds: [q.id], visibility: "public" });
    await bank.setSetStatus(owner.id, set.id, "published");
    const { sessionId } = await bank.startPractice(student.id, set.id);
    await bank.answerPractice(student.id, sessionId, q.id, "D", 5);

    const edited = await bank.updateQuestion(owner.id, q.id, { ...mcq, stem: "If $3(x - 4) = -3$, what is $x$?", answer: "D", explanation: "New explanation." });
    expect(edited.version).toBe(2);
    expect(edited.status).toBe("published");
    const v1 = await db.bankQuestionVersion.findUniqueOrThrow({ where: { questionId_version: { questionId: q.id, version: 1 } } });
    expect(v1.stem).toBe(mcq.stem);
    const attempt = await db.bankAttempt.findFirstOrThrow({ where: { questionId: q.id } });
    expect(attempt.questionVersion).toBe(1);
    // The old sitting still shows what was answered then.
    const state = await bank.practiceState(student.id, sessionId);
    expect(state.answers[q.id].explanation).toBe("Divide by 2, then add 4.");
    // A new attempt records version 2.
    const s2 = (await bank.startPractice(student.id, set.id)).sessionId;
    await bank.answerPractice(student.id, s2, q.id, "D", 5);
    expect((await db.bankAttempt.findFirstOrThrow({ where: { sessionId: s2 } })).questionVersion).toBe(2);
    // Saving with no content change doesn't make a version.
    expect((await bank.updateQuestion(owner.id, q.id, { ...mcq, stem: "If $3(x - 4) = -3$, what is $x$?", explanation: "New explanation.", week: 9 })).version).toBe(2);
    // Drafts nobody answered are edited in place.
    const d = await bank.createQuestion(owner.id, { ...mcq, external_id: "T-9" });
    expect((await bank.updateQuestion(owner.id, d.id, { ...mcq, external_id: "T-9", stem: "Other" })).version).toBe(1);
  });

  it("refuses answers after a timed sitting runs out", async () => {
    const { owner, student } = await people();
    const q = await bank.createQuestion(owner.id, mcq, { publish: true });
    const set = await bank.createSet(owner.id, { title: "S", questionIds: [q.id], visibility: "public", timeLimitMin: 1 });
    await bank.setSetStatus(owner.id, set.id, "published");
    const { sessionId } = await bank.startPractice(student.id, set.id, { timed: true });
    const later = new Date(Date.now() + 2 * 60_000);
    await expect(bank.answerPractice(student.id, sessionId, q.id, "D", 5, later)).rejects.toThrow(/Time's up/);
  });

  it("auto-generates a set from matching questions", async () => {
    const { owner } = await people();
    for (let i = 0; i < 6; i++) await bank.createQuestion(owner.id, { ...mcq, external_id: `A-${i}`, difficulty: i < 4 ? 2 : 1 });
    const skill = await db.skill.findFirstOrThrow({ where: { name: "Linear equations in one variable" } });
    const r = await bank.autoGenerateSet(owner.id, { count: 10, skillId: skill.id, difficultyMin: 2, difficultyMax: 3 });
    expect(r.found).toBe(4);
    expect(r.set.questionIds).toHaveLength(4);
  });
});
