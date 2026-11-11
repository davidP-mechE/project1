import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { answerQuestion, assignQuestions, classProgress, createClass } from "@/server/classes";
import { answerDiagnostic, assignDiagnostic, createDiagnostic, diagnosticReport, diagnosticState, getDiagnostic, grantRetake, publishDiagnostic, startDiagnostic, submitModule } from "@/server/diagnostics";
import { answerMistake, myMistakes, practiceFor } from "@/server/mistakes";
import { addScore, myScores } from "@/server/scores";
import { assignExternal, getExternalAssignment, recordExternal } from "@/server/external";
import { planFor } from "@/server/pacing";
import { setProfile } from "@/server/scores";
import { domainsOf } from "@/lib/sat/domains";
import { createUser, resetDb } from "../helpers/db";

vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));
beforeEach(resetDb);

async function outcome(fn: () => Promise<unknown>): Promise<"ok" | "denied" | "hidden" | "invalid"> {
  try {
    await fn();
    return "ok";
  } catch (err) {
    if (err instanceof NotFoundError) return "hidden";
    if (err instanceof ClassError) return err.status === 403 ? "denied" : "invalid";
    throw err;
  }
}

/** A tagged question bank: per section, 4 questions per domain at mixed difficulty. Answer key: choice 0 / "3/4". */
async function bank(ownerId: string) {
  const items = [];
  let order = 0;
  for (const section of ["RW", "MATH"] as const) {
    for (const domain of domainsOf(section)) {
      for (const difficulty of ["EASY", "MEDIUM", "HARD", "MEDIUM"]) {
        const grid = section === "MATH" && order % 4 === 3;
        items.push({ order: order++, label: String(order), type: grid ? ("SHORT_ANSWER" as const) : ("MULTIPLE_CHOICE" as const), prompt: `${domain} q${order}`, choices: grid ? [] : ["right", "wrong", "wrong2", "wrong3"], correctChoice: grid ? null : 0, answer: grid ? "3/4" : "right", explanation: "Because.", topic: domain, section, domain, difficulty, tagsConfirmed: true, desmosSolvable: section === "MATH" });
      }
    }
  }
  return db.worksheet.create({ data: { ownerId, title: "Bank", fileKey: `bank-${ownerId}`, sizeBytes: BigInt(1), status: "READY", items: { create: items } } });
}

async function fixture() {
  const [admin, math, viewer, ana, ben, outsider] = await Promise.all(["Admin", "Math", "Viewer", "Ana", "Ben", "Outsider"].map((n) => createUser(n)));
  const c = await createClass(admin.id, "SAT Fall");
  for (const s of [ana, ben]) await db.classMember.create({ data: { classId: c.id, userId: s.id } });
  await db.classStaff.createMany({ data: [{ classId: c.id, userId: math.id, role: "SPECIALIST", sections: ["MATH"] }, { classId: c.id, userId: viewer.id, role: "VIEWER" }] });
  await bank(admin.id);
  return { c, admin, math, viewer, ana, ben, outsider };
}

const build = { title: "Fall diagnostic", sections: ["RW", "MATH"] as ("RW" | "MATH")[], m1Count: 4, m2Count: 4, m1Minutes: 10, m2Minutes: 10 };

/** Answer every question in the current module: right for the first `right`, wrong after. */
async function answerModule(userId: string, assignmentId: string, right: number, now: Date) {
  const s = await diagnosticState(userId, assignmentId, now);
  if (s.phase !== "taking") throw new Error(`not taking: ${s.phase}`);
  for (const [i, q] of s.questions.entries()) {
    const ok = i < right;
    await answerDiagnostic(userId, assignmentId, q.id, q.type === "MULTIPLE_CHOICE" ? { choice: ok ? 0 : 1, timeMs: 30_000 } : { response: ok ? "0.75" : "9", timeMs: 30_000 }, now);
  }
  return s.module.id;
}

describe("building diagnostics", () => {
  it("picks tagged questions spread across domains, harder and easier second modules, and checks scope", async () => {
    const f = await fixture();
    const d = await createDiagnostic(f.admin.id, f.c.programId, build);
    const view = await getDiagnostic(f.admin.id, d.id);
    expect(view.modules.map((m) => `${m.section}:${m.stage}:${m.items.length}`)).toEqual(["RW:M1:4", "RW:M2_HARD:4", "RW:M2_EASY:4", "MATH:M1:4", "MATH:M2_HARD:4", "MATH:M2_EASY:4"]);
    expect(view.coverageGaps).toEqual([]); // 4 questions, one per domain
    const m1 = view.modules[0].items.map((i) => i.id);
    expect(view.modules[1].items.some((i) => m1.includes(i.id))).toBe(false);
    expect(view.modules[1].items.filter((i) => i.difficulty === "HARD").length).toBeGreaterThan(view.modules[2].items.filter((i) => i.difficulty === "HARD").length);
    // A Math specialist builds Math only; viewers and outsiders can't build.
    expect(await outcome(() => createDiagnostic(f.math.id, f.c.programId, { ...build, sections: ["MATH"] }))).toBe("ok");
    expect(await outcome(() => createDiagnostic(f.math.id, f.c.programId, build))).toBe("denied");
    expect(await outcome(() => createDiagnostic(f.viewer.id, f.c.programId, build))).toBe("hidden");
    expect(await outcome(() => createDiagnostic(f.outsider.id, f.c.programId, build))).toBe("hidden");
    expect(await outcome(() => getDiagnostic(f.math.id, d.id))).toBe("hidden"); // it has R&W modules
    // Not enough questions.
    await expect(createDiagnostic(f.admin.id, f.c.programId, { ...build, m1Count: 30 })).rejects.toThrow("Not enough");
  });

  it("only published diagnostics can be assigned, inside the assigner's scope", async () => {
    const f = await fixture();
    const d = await createDiagnostic(f.admin.id, f.c.programId, build);
    expect(await outcome(() => assignDiagnostic(f.admin.id, f.c.id, { diagnosticId: d.id }))).toBe("invalid");
    await publishDiagnostic(f.admin.id, d.id);
    expect(await outcome(() => assignDiagnostic(f.math.id, f.c.id, { diagnosticId: d.id }))).toBe("denied"); // covers R&W too
    expect(await outcome(() => assignDiagnostic(f.viewer.id, f.c.id, { diagnosticId: d.id }))).toBe("denied");
    expect(await outcome(() => assignDiagnostic(f.admin.id, f.c.id, { diagnosticId: d.id }))).toBe("ok");
  });
});

describe("taking a diagnostic", () => {
  async function assigned(opts: { closesAt?: Date } = {}) {
    const f = await fixture();
    const d = await createDiagnostic(f.admin.id, f.c.programId, build);
    await publishDiagnostic(f.admin.id, d.id);
    const a = await assignDiagnostic(f.admin.id, f.c.id, { diagnosticId: d.id, closesAt: opts.closesAt?.toISOString() ?? null });
    return { ...f, d, a };
  }

  it("routes module 2 on module 1, hides answers until it closes, and saves an estimated score and mistakes", async () => {
    const t0 = new Date("2026-11-10T15:00:00Z");
    const f = await assigned({ closesAt: new Date("2026-11-20T00:00:00Z") });
    expect((await diagnosticState(f.ana.id, f.a.id, t0)).phase).toBe("before");
    await startDiagnostic(f.ana.id, f.a.id, t0);
    const s1 = await diagnosticState(f.ana.id, f.a.id, t0);
    expect(s1.phase).toBe("taking");
    if (s1.phase !== "taking") return;
    expect(s1.module.section).toBe("RW");
    expect(JSON.stringify(s1.questions)).not.toMatch(/correctChoice|"answer"|explanation/); // no answer key while taking
    // RW: all right in module 1 → harder module 2; Math: 1 of 4 → easier.
    let m = await answerModule(f.ana.id, f.a.id, 4, t0);
    await submitModule(f.ana.id, f.a.id, m, t0);
    m = await answerModule(f.ana.id, f.a.id, 4, t0);
    await submitModule(f.ana.id, f.a.id, m, t0);
    m = await answerModule(f.ana.id, f.a.id, 1, t0);
    await submitModule(f.ana.id, f.a.id, m, t0);
    m = await answerModule(f.ana.id, f.a.id, 2, t0);
    await submitModule(f.ana.id, f.a.id, m, t0);
    const done = await diagnosticState(f.ana.id, f.a.id, t0);
    expect(done.phase).toBe("done");
    if (done.phase !== "done") return;
    expect(done.results!.sections).toEqual([
      { section: "RW", route: "M2_HARD", correct: 8, total: 8, estimate: 800 },
      { section: "MATH", route: "M2_EASY", correct: 3, total: 8, estimate: 370 },
    ]);
    expect(done.results!.total).toBe(1170);
    expect(done.review).toBeNull(); // closes on the 20th
    const later = await diagnosticState(f.ana.id, f.a.id, new Date("2026-11-21T00:00:00Z"));
    expect(later.phase === "done" && later.review?.length).toBe(16);
    // The estimate is now her baseline score, and her 5 misses are in the mistake log.
    const scores = await myScores(f.ana.id, t0);
    expect(scores.baseline).toMatchObject({ total: 1170 });
    expect(scores.scores[0]).toMatchObject({ source: "DIAGNOSTIC", rw: 800, math: 370 });
    expect((await myMistakes(f.ana.id, new Date("2026-11-12T00:00:00Z"))).due).toHaveLength(5);
    // Progress grid.
    expect((await classProgress(f.admin.id, f.c.id, t0)).cells[`${f.ana.id}:${f.a.id}`]).toMatchObject({ status: "done", score: 11 / 16 });
  });

  it("keeps time on the server: late answers are refused and expired modules move on", async () => {
    const t0 = new Date("2026-11-10T15:00:00Z");
    const f = await assigned();
    await startDiagnostic(f.ana.id, f.a.id, t0);
    const s = await diagnosticState(f.ana.id, f.a.id, t0);
    if (s.phase !== "taking") throw new Error("not taking");
    await answerDiagnostic(f.ana.id, f.a.id, s.questions[0].id, { choice: 0 }, t0);
    // 11 minutes later (10-minute module): the next answer to module 1 is refused, and module 2 has started.
    const late = new Date(t0.getTime() + 11 * 60_000);
    await expect(answerDiagnostic(f.ana.id, f.a.id, s.questions[1].id, { choice: 0 }, late)).rejects.toThrow(/Time's up|Question not found/);
    const s2 = await diagnosticState(f.ana.id, f.a.id, late);
    expect(s2.phase === "taking" && s2.module.number).toBe(2);
    // A reload doesn't reset the clock: module 2 ends 10 minutes after module 1's time ran out.
    expect(s2.phase === "taking" && new Date(s2.module.endsAt).getTime()).toBe(t0.getTime() + 20 * 60_000);
    // Walking away for an hour finishes everything.
    const gone = await diagnosticState(f.ana.id, f.a.id, new Date(t0.getTime() + 60 * 60_000));
    expect(gone.phase).toBe("done");
  });

  it("one attempt unless a teacher allows a retake; only members can take it", async () => {
    const t0 = new Date("2026-11-10T15:00:00Z");
    const f = await assigned();
    await startDiagnostic(f.ana.id, f.a.id, t0);
    await diagnosticState(f.ana.id, f.a.id, new Date(t0.getTime() + 2 * 3600_000)); // runs out
    await expect(startDiagnostic(f.ana.id, f.a.id, new Date(t0.getTime() + 3 * 3600_000))).rejects.toThrow("already taken");
    expect(await outcome(() => grantRetake(f.viewer.id, f.a.id, f.ana.id))).toBe("denied");
    expect(await outcome(() => grantRetake(f.math.id, f.a.id, f.ana.id))).toBe("hidden"); // the diagnostic covers R&W
    await grantRetake(f.admin.id, f.a.id, f.ana.id);
    await startDiagnostic(f.ana.id, f.a.id, new Date(t0.getTime() + 3 * 3600_000));
    expect(await db.diagnosticAttempt.count({ where: { userId: f.ana.id } })).toBe(2);
    expect(await outcome(() => startDiagnostic(f.outsider.id, f.a.id))).toBe("hidden");
    expect(await outcome(() => diagnosticState(f.outsider.id, f.a.id))).toBe("hidden");
    expect(await db.auditLog.count({ where: { action: "diagnostic.retake" } })).toBe(1);
  });

  it("refuses to start before it opens or after it closes", async () => {
    const f = await fixture();
    const d = await createDiagnostic(f.admin.id, f.c.programId, build);
    await publishDiagnostic(f.admin.id, d.id);
    const a = await assignDiagnostic(f.admin.id, f.c.id, { diagnosticId: d.id, opensAt: "2026-12-01T00:00:00Z", closesAt: "2026-12-02T00:00:00Z" });
    await expect(startDiagnostic(f.ana.id, a.id, new Date("2026-11-30T00:00:00Z"))).rejects.toThrow("isn't open yet");
    await expect(startDiagnostic(f.ana.id, a.id, new Date("2026-12-03T00:00:00Z"))).rejects.toThrow("closed");
  });

  it("reports results to staff in scope, with Desmos use", async () => {
    const t0 = new Date("2026-11-10T15:00:00Z");
    const f = await assigned();
    await startDiagnostic(f.ana.id, f.a.id, t0);
    for (let i = 0; i < 4; i++) {
      const s = await diagnosticState(f.ana.id, f.a.id, t0);
      if (s.phase !== "taking") break;
      for (const q of s.questions) await answerDiagnostic(f.ana.id, f.a.id, q.id, q.type === "MULTIPLE_CHOICE" ? { choice: 0, usedDesmos: true } : { response: "3/4", usedDesmos: true }, t0);
      await submitModule(f.ana.id, f.a.id, s.module.id, t0);
    }
    const r = await diagnosticReport(f.admin.id, f.a.id);
    expect(r.students.find((s) => s.student.id === f.ana.id)).toMatchObject({ status: "done", results: { total: 1600 } });
    expect(r.desmos.with.accuracy).toBe(1);
    expect(r.domains.every((d) => d.accuracy === 1)).toBe(true);
    expect(await outcome(() => diagnosticReport(f.math.id, f.a.id))).toBe("hidden");
    expect(await outcome(() => diagnosticReport(f.viewer.id, f.a.id))).toBe("ok");
    expect(await outcome(() => diagnosticReport(f.outsider.id, f.a.id))).toBe("hidden");
  });
});

describe("mistake log", () => {
  it("collects misses from assignments, College Board links and outside tests, and retires after two right", async () => {
    const f = await fixture();
    const ws = await db.worksheet.findFirstOrThrow({ where: { ownerId: f.admin.id }, include: { items: { where: { section: "MATH", type: "MULTIPLE_CHOICE" }, take: 1 } } });
    const item = ws.items[0];
    const [a] = await assignQuestions(f.admin.id, { classIds: [f.c.id], worksheetId: ws.id, itemIds: [item.id], title: "Set" });
    await answerQuestion(f.ana.id, a.id, item.id, { choice: 2 }, { grader: null });
    const ext = await assignExternal(f.admin.id, f.c.id, { title: "Bank", items: [{ questionId: "abcd1234", url: "https://satsuitequestionbank.collegeboard.org/x", domain: "algebra" }] });
    const key = (await getExternalAssignment(f.ana.id, ext.id)).items[0].key;
    await recordExternal(f.ana.id, ext.id, key, { result: "INCORRECT", reason: "CARELESS" });
    await addScore(f.ana.id, f.ana.id, { source: "PRACTICE_BLUEBOOK", takenOn: "2026-11-01", total: 1000, missed: [{ section: "RW", module: 1, number: 4, domain: "conventions", skill: "Boundaries" }] });
    const now = new Date(Date.now() + 2 * 86_400_000);
    const log = await myMistakes(f.ana.id, now);
    expect(log.due.map((m) => m.sourceType).sort()).toEqual(["ASSIGNMENT", "EXTERNAL", "SCORE"]);
    // The outside-test miss comes back as a similar tagged question on the same domain.
    const score = log.due.find((m) => m.sourceType === "SCORE")!;
    const p = await practiceFor(f.ana.id, score.id);
    expect(p.kind).toBe("question");
    expect(p.question!.similar).toBe(true);
    // The College Board miss is retried there and self-reported.
    const extMistake = log.due.find((m) => m.sourceType === "EXTERNAL")!;
    expect((await practiceFor(f.ana.id, extMistake.id)).kind).toBe("external");
    await expect(answerMistake(f.ana.id, extMistake.id, {}, now)).rejects.toThrow("Say how it went");
    // Right twice in a row retires it; wrong resets the streak.
    const own = log.due.find((m) => m.sourceType === "ASSIGNMENT")!;
    expect(await answerMistake(f.ana.id, own.id, { practiceItemId: item.id, choice: 1 }, now)).toMatchObject({ correct: false, retired: false });
    expect(await answerMistake(f.ana.id, own.id, { practiceItemId: item.id, choice: 0 }, now)).toMatchObject({ correct: true, retired: false });
    expect(await answerMistake(f.ana.id, own.id, { practiceItemId: item.id, choice: 0 }, now)).toMatchObject({ correct: true, retired: true });
    expect((await myMistakes(f.ana.id, now)).retired).toBe(1);
    // No one else can see or answer her mistakes.
    expect(await outcome(() => practiceFor(f.ben.id, own.id))).toBe("hidden");
    expect(await outcome(() => answerMistake(f.ben.id, score.id, { selfReport: "CORRECT" }))).toBe("hidden");
  });
});

describe("pacing plan", () => {
  it("builds a plan back from the student's test date, weakest topics first", async () => {
    const f = await fixture();
    expect(await planFor(f.ana.id)).toBeNull();
    const date = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await setProfile(f.ana.id, { testDate: date });
    const plan = await planFor(f.ana.id);
    expect(plan!.weeks.length).toBeGreaterThanOrEqual(4);
    expect(plan!.weeks.at(-1)!.finalReview).toBe(true);
    await expect(setProfile(f.ana.id, { testDate: "2020-01-01" })).rejects.toThrow("future");
  });
});
