import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import * as bank from "@/server/bank";
import { assignQuestions, createClass } from "@/server/classes";
import { syncOwnerRole } from "@/server/roles";
import { ensureReferenceData } from "@/server/seed/reference";
import { openReportCount, reportQueue, reportQuestion, resolveReports, unpublishReported } from "@/server/question-reports";
import { questionStats } from "@/server/question-stats";
import { createUser, resetDb } from "../helpers/db";

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));
const savedOwner = process.env.OWNER_EMAIL;
afterAll(() => {
  process.env.OWNER_EMAIL = savedOwner;
});

beforeEach(async () => {
  await resetDb();
  await ensureReferenceData({ onlyIfEmpty: false });
});

async function outcome(fn: () => Promise<unknown>): Promise<"ok" | "denied" | "hidden" | "invalid"> {
  try {
    await fn();
    return "ok";
  } catch (err) {
    if (err instanceof NotFoundError) return "hidden";
    if (err instanceof ClassError || err instanceof bank.BankError) return (err as ClassError).status === 403 ? "denied" : "invalid";
    throw err;
  }
}

const mcq = { section: "math", skill: "Linear equations in one variable", difficulty: 1, type: "mcq", stem: "If $2x = 6$, what is $x$?", choice_a: "2", choice_b: "3", choice_c: "4", choice_d: "6", answer: "B", explanation: "Divide by 2." };

async function fixture() {
  const [owner, tutor, other, ana, ben] = await Promise.all(["Owner", "Tutor", "Other tutor", "Ana", "Ben"].map((n) => createUser(n)));
  process.env.OWNER_EMAIL = owner.email;
  await syncOwnerRole();
  await db.user.updateMany({ where: { id: { in: [tutor.id, other.id] } }, data: { role: "TUTOR" } });
  const q = await bank.createQuestion(tutor.id, { ...mcq, external_id: "T-1" }, { publish: true });
  const set = await bank.createSet(tutor.id, { title: "Set", questionIds: [q.id], visibility: "public" });
  await bank.setSetStatus(tutor.id, set.id, "published");
  return { owner, tutor, other, ana, ben, q, set };
}

describe("reporting a question", () => {
  it("from your own practice sitting; keeps the version and your answer; one open report each; the author is told", async () => {
    const f = await fixture();
    const s = await bank.startPractice(f.ana.id, f.set.id);
    await bank.answerPractice(f.ana.id, s.sessionId, f.q.id, "C", 30);
    expect(await outcome(() => reportQuestion(f.ben.id, { kind: "bank", sessionId: s.sessionId, questionId: f.q.id }, { reason: "TYPO" }))).toBe("hidden");
    expect(await outcome(() => reportQuestion(f.ana.id, { kind: "bank", sessionId: s.sessionId, questionId: f.q.id }, { reason: "NOPE" }))).toBe("invalid");
    const r = await reportQuestion(f.ana.id, { kind: "bank", sessionId: s.sessionId, questionId: f.q.id }, { reason: "WRONG_KEY", note: "I think C is right" });
    expect(r).toMatchObject({ questionVersion: 1, answerGiven: "C", status: "OPEN" });
    await reportQuestion(f.ana.id, { kind: "bank", sessionId: s.sessionId, questionId: f.q.id }, { reason: "CONFUSING" });
    expect(await db.questionReport.findMany({ select: { reason: true } })).toEqual([{ reason: "CONFUSING" }]);
    expect(await db.notification.count({ where: { userId: f.tutor.id, kind: "REVIEW" } })).toBe(1);
    // Up to 20 a day.
    await db.questionReport.createMany({ data: Array.from({ length: 20 }, () => ({ reporterId: f.ben.id, bankQuestionId: f.q.id, reason: "OTHER", status: "RESOLVED" })) });
    const sb = await bank.startPractice(f.ben.id, f.set.id);
    expect(await outcome(() => reportQuestion(f.ben.id, { kind: "bank", sessionId: sb.sessionId, questionId: f.q.id }, { reason: "TYPO" }))).toBe("invalid");
  });

  it("worksheet questions in an assignment: only students it's assigned to; the worksheet's owner reviews", async () => {
    const f = await fixture();
    const c = await createClass(f.tutor.id, "Class");
    await db.classMember.create({ data: { classId: c.id, userId: f.ana.id } });
    const ws = await db.worksheet.create({ data: { ownerId: f.tutor.id, title: "Quiz 1", fileKey: "k", sizeBytes: BigInt(1), status: "READY", items: { create: [{ order: 0, label: "4", type: "MULTIPLE_CHOICE", prompt: "Q?", choices: ["a", "b"], correctChoice: 0, answer: "a", explanation: "", topic: "t" }] } }, include: { items: true } });
    const [a] = await assignQuestions(f.tutor.id, { classIds: [c.id], worksheetId: ws.id, itemIds: [], title: "Quiz" });
    const target = { kind: "item" as const, assignmentId: a.id, itemId: ws.items[0].id };
    expect(await outcome(() => reportQuestion(f.ben.id, target, { reason: "TYPO" }))).toBe("hidden");
    await reportQuestion(f.ana.id, target, { reason: "FIGURE_MISSING" });
    const q = await reportQueue(f.tutor.id);
    expect(q.map((g) => [g.kind, g.title, g.reports.length])).toEqual([["item", "Quiz 1, question 4", 1], ["bank", "T-1 · by Tutor", 0]].filter((x) => x[2] !== 0));
    expect((await reportQueue(f.other.id)).length).toBe(0);
    expect(await openReportCount(f.tutor.id)).toBe(1);
    expect(await outcome(() => resolveReports(f.other.id, `item:${ws.items[0].id}`, "FIXED"))).toBe("hidden");
    expect(await resolveReports(f.tutor.id, `item:${ws.items[0].id}`, "FIXED")).toEqual({ resolved: 1 });
  });
});

describe("the review queue", () => {
  it("authors see bank reports grouped by question, anonymously; students don't; unpublishing needs the author or owner", async () => {
    const f = await fixture();
    for (const s of [f.ana, f.ben]) {
      const p = await bank.startPractice(s.id, f.set.id);
      await bank.answerPractice(s.id, p.sessionId, f.q.id, "A", 10);
      await reportQuestion(s.id, { kind: "bank", sessionId: p.sessionId, questionId: f.q.id }, { reason: "WRONG_KEY" });
    }
    const [g] = await reportQueue(f.other.id);
    expect(g).toMatchObject({ kind: "bank", version: 1, published: true, canUnpublish: false });
    expect(g.reports.map((r) => r.answerGiven)).toEqual(["A", "A"]);
    expect(JSON.stringify(g)).not.toContain("Ana");
    expect(await reportQueue(f.ana.id)).toEqual([]);
    expect(await outcome(() => resolveReports(f.ana.id, `bank:${f.q.id}`, "FIXED"))).toBe("hidden");
    expect(await outcome(() => unpublishReported(f.other.id, `bank:${f.q.id}`))).toBe("denied");
    expect(await unpublishReported(f.owner.id, `bank:${f.q.id}`)).toEqual({ resolved: 2 });
    expect((await db.bankQuestion.findUniqueOrThrow({ where: { id: f.q.id } })).status).toBe("draft");
    expect((await reportQueue(f.tutor.id, { resolved: true }))[0].reports.map((r) => r.resolution)).toEqual(["UNPUBLISHED", "UNPUBLISHED"]);
  });
});

describe("question stats", () => {
  it("counts the current version on its own, flags likely bad questions, and sorts the bank by them", async () => {
    const f = await fixture();
    const attempts = (version: number, list: [string, boolean, number][]) => db.bankAttempt.createMany({ data: list.map(([answer, correct, t], i) => ({ userId: i % 2 ? f.ana.id : f.ben.id, questionId: f.q.id, questionVersion: version, answerGiven: answer, correct, timeSeconds: t })) });
    await attempts(1, [["B", true, 20], ["B", true, 40]]);
    // Edit it: answers so far belong to version 1.
    await bank.updateQuestion(f.tutor.id, f.q.id, { ...mcq, external_id: "T-1", stem: "If $2x = 6$, what is the value of $x$?" });
    await attempts(2, [...Array.from({ length: 7 }, () => ["C", false, 50] as [string, boolean, number]), ["B", true, 30], ["B", true, 30], ["A", false, 10]]);
    const s = (await questionStats(f.owner.id, f.q.id))!;
    expect(s).toMatchObject({ version: 2, olderVersions: [1], current: { attempts: 10, correct: 2, pct: 0.2, avgSeconds: 42 }, older: { attempts: 2, pct: 1 } });
    expect(s.current.answers.map((a) => [a.answer, a.n, a.correct])).toEqual([["C", 7, false], ["B", 2, true], ["A", 1, false]]);
    expect(s.flags.map((x) => x.code)).toEqual(["TOO_HARD", "WRONG_CHOICE_WINS"]);
    expect(await outcome(() => questionStats(f.ana.id, f.q.id))).toBe("hidden");
    // A second, healthy question; the bank sorts and filters by the numbers.
    const q2 = await bank.createQuestion(f.tutor.id, { ...mcq, external_id: "T-2" }, { publish: true });
    await db.bankAttempt.createMany({ data: Array.from({ length: 10 }, () => ({ userId: f.ana.id, questionId: q2.id, questionVersion: 1, answerGiven: "B", correct: true, timeSeconds: 15 })) });
    expect((await bank.listBank(f.owner.id, { sort: "pct", dir: "asc" })).rows.map((r) => r.externalId)).toEqual(["T-1", "T-2"]);
    expect((await bank.listBank(f.owner.id, { sort: "pct", dir: "desc" })).rows.map((r) => r.externalId)).toEqual(["T-2", "T-1"]);
    expect((await bank.listBank(f.owner.id, { flagged: true })).rows.map((r) => r.externalId)).toEqual(["T-1"]);
    expect((await bank.listBank(f.owner.id, {})).rows.find((r) => r.externalId === "T-2")!.stats.current.avgSeconds).toBe(15);
  });
});
