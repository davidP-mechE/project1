import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { roleOf } from "./roles";
import { Prisma } from "@/generated/prisma/client";

/**
 * A tracker for your official SAT practice. Students log a practice test they
 * took elsewhere (e.g. in Bluebook) by name, date, scores and which question
 * NUMBERS they got wrong, skipped or guessed, and tag each miss with a skill
 * and an error type. No question content is ever stored: correctness comes from
 * the student's own score report.
 */

export class TrackerError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type ModuleSpec = { section: "rw" | "math"; number: number; question_count: number };
export type ItemInput = { section: "rw" | "math"; module: number; questionNumber: number; result: "wrong" | "skipped" | "guessed" | "correct"; skillId?: string | null; errorTypeId?: string | null; note?: string | null };

export function parseModules(raw: unknown): ModuleSpec[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) throw new TrackerError("A test needs 1 to 8 modules.");
  const out = raw.map((m) => {
    const x = (m ?? {}) as Record<string, unknown>;
    const section = x.section === "rw" || x.section === "math" ? x.section : null;
    const number = Number(x.number);
    const count = Number(x.question_count);
    if (!section || !Number.isInteger(number) || number < 1 || number > 4 || !Number.isInteger(count) || count < 1 || count > 60) throw new TrackerError("Each module needs a section (rw or math), a number (1–4) and 1–60 questions.");
    return { section, number, question_count: count } as ModuleSpec;
  });
  if (new Set(out.map((m) => `${m.section}-${m.number}`)).size !== out.length) throw new TrackerError("Two modules have the same section and number.");
  return out.sort((a, b) => (a.section === b.section ? a.number - b.number : a.section === "rw" ? -1 : 1));
}

// ─── Catalog ─────────────────────────────────────────────────────────────

/** Shared tests (seeded, or added by the owner or a tutor) plus the student's own private ones. */
export async function listTests(userId: string) {
  return db.practiceTest.findMany({
    where: { OR: [{ shared: true }, { createdById: userId }] },
    orderBy: [{ shared: "desc" }, { name: "asc" }],
    select: { id: true, name: true, source: true, modules: true, shared: true },
  });
}

/** Add a test to the catalog. A student's is private to them; the owner's and tutors' are shared. Metadata only. */
export async function createTest(userId: string, input: { name: string; source?: string; modules: unknown }) {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new TrackerError("Give the test a name (e.g. Bluebook Practice Test 7).");
  const source = input.source === "bluebook" || input.source === "paper" ? input.source : "other";
  const modules = parseModules(input.modules);
  const r = await roleOf(userId);
  return db.practiceTest.create({ data: { name, source, modules: modules as unknown as Prisma.InputJsonValue, createdById: userId, shared: r.isAuthor } });
}

async function testFor(userId: string, testId: string) {
  const t = await db.practiceTest.findUnique({ where: { id: testId } });
  if (!t || (!t.shared && t.createdById !== userId)) throw new NotFoundError("Test not found");
  return t;
}

// ─── Attempts ────────────────────────────────────────────────────────────

function parseDate(v: unknown): Date {
  const d = v instanceof Date ? v : new Date(String(v ?? ""));
  if (Number.isNaN(d.getTime())) throw new TrackerError("That date isn't valid.");
  if (d.getTime() > Date.now() + 2 * 86_400_000) throw new TrackerError("The date can't be in the future.");
  if (d.getFullYear() < 2015) throw new TrackerError("That date is too long ago.");
  return d;
}

export async function startAttempt(userId: string, input: { testId: string; dateTaken: unknown }) {
  await testFor(userId, input.testId);
  return db.testAttempt.create({ data: { userId, testId: input.testId, dateTaken: parseDate(input.dateTaken) } });
}

/** The student's own attempt (staff access goes through tutorAttempt in src/server/tutor-view.ts). */
async function ownAttempt(userId: string, attemptId: string) {
  const a = await db.testAttempt.findUnique({ where: { id: attemptId }, include: { test: true } });
  if (!a || a.userId !== userId) throw new NotFoundError("Attempt not found");
  return a;
}

export async function getAttempt(userId: string, attemptId: string) {
  const a = await ownAttempt(userId, attemptId);
  const items = await db.attemptItem.findMany({ where: { attemptId }, orderBy: [{ section: "desc" }, { module: "asc" }, { questionNumber: "asc" }] });
  const comments = await db.attemptComment.findMany({ where: { attemptId }, orderBy: { createdAt: "asc" }, select: { id: true, body: true, createdAt: true, author: { select: { name: true } } } });
  return { ...a, modules: parseModules(a.test.modules), items, comments };
}

export async function myAttempts(userId: string) {
  return db.testAttempt.findMany({
    where: { userId },
    orderBy: [{ dateTaken: "desc" }, { createdAt: "desc" }],
    select: { id: true, dateTaken: true, status: true, total: true, scoreRw: true, scoreMath: true, test: { select: { name: true } }, _count: { select: { items: true, comments: true } } },
  });
}

const score = (v: unknown, lo: number, hi: number, label: string) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi || n % 10 !== 0) throw new TrackerError(`${label} must be ${lo}–${hi}, in steps of 10.`);
  return n;
};

export type AttemptPatch = { dateTaken?: unknown; scoreRw?: unknown; scoreMath?: unknown; total?: unknown; minutesUsed?: unknown; notes?: unknown; items?: ItemInput[] };

/** Clean the score fields; the total is worked out from the two sections when it isn't given. */
export function cleanScores(p: AttemptPatch) {
  const rw = score(p.scoreRw, 200, 800, "Reading and Writing");
  const math = score(p.scoreMath, 200, 800, "Math");
  let total = score(p.total, 400, 1600, "The total");
  if (rw !== null && math !== null) {
    if (total !== null && total !== rw + math) throw new TrackerError(`The total should be ${rw + math} (R&W ${rw} + Math ${math}).`);
    total = rw + math;
  }
  return { scoreRw: rw, scoreMath: math, total };
}

/**
 * Autosave: scores, notes and the full list of non-correct cells. Cells not in
 * the list are correct (their rows are removed). Redo progress on a cell that
 * stays non-correct is kept.
 */
export async function saveAttempt(userId: string, attemptId: string, patch: AttemptPatch) {
  const a = await ownAttempt(userId, attemptId);
  const modules = parseModules(a.test.modules);
  const data: Prisma.TestAttemptUpdateInput = {};
  if (patch.dateTaken !== undefined) data.dateTaken = parseDate(patch.dateTaken);
  if (patch.scoreRw !== undefined || patch.scoreMath !== undefined || patch.total !== undefined) Object.assign(data, cleanScores({ scoreRw: "scoreRw" in patch ? patch.scoreRw : a.scoreRw, scoreMath: "scoreMath" in patch ? patch.scoreMath : a.scoreMath, total: patch.total }));
  if (patch.minutesUsed !== undefined) {
    const m = patch.minutesUsed === null || patch.minutesUsed === "" ? null : Number(patch.minutesUsed);
    if (m !== null && (!Number.isInteger(m) || m < 0 || m > 600)) throw new TrackerError("Minutes used must be 0–600.");
    data.minutesUsed = m;
  }
  if (patch.notes !== undefined) data.notes = String(patch.notes ?? "").slice(0, 2000) || null;

  let items: Awaited<ReturnType<typeof cleanItems>> | null = null;
  if (patch.items) items = await cleanItems(modules, patch.items);

  await db.$transaction(async (tx) => {
    await tx.testAttempt.update({ where: { id: attemptId }, data });
    if (items) {
      const keep = items.map((i) => `${i.section}-${i.module}-${i.questionNumber}`);
      const existing = await tx.attemptItem.findMany({ where: { attemptId }, select: { id: true, section: true, module: true, questionNumber: true } });
      const gone = existing.filter((e) => !keep.includes(`${e.section}-${e.module}-${e.questionNumber}`)).map((e) => e.id);
      if (gone.length) await tx.attemptItem.deleteMany({ where: { id: { in: gone } } });
      for (const i of items) {
        await tx.attemptItem.upsert({
          where: { attemptId_section_module_questionNumber: { attemptId, section: i.section, module: i.module, questionNumber: i.questionNumber } },
          create: { attemptId, ...i },
          update: { result: i.result, skillId: i.skillId, errorTypeId: i.errorTypeId, note: i.note },
        });
      }
    }
  });
  // A finished log stays in step with its score record; if it's no longer complete (an untagged miss), it goes back to draft.
  if (a.status === "complete") {
    const problems = await completionProblems(attemptId);
    if (problems.length) await reopen(attemptId);
    else await syncScoreRecord(attemptId);
  }
  return getAttempt(userId, attemptId);
}

async function cleanItems(modules: ModuleSpec[], raw: ItemInput[]) {
  if (raw.length > 400) throw new TrackerError("Too many items.");
  const skills = new Map((await db.skill.findMany({ where: { parentId: { not: null } }, select: { id: true, section: true } })).map((s) => [s.id, s.section]));
  const errorTypes = new Set((await db.errorType.findMany({ select: { id: true } })).map((e) => e.id));
  const seen = new Set<string>();
  const out: { section: "rw" | "math"; module: number; questionNumber: number; result: "wrong" | "skipped" | "guessed"; skillId: string | null; errorTypeId: string | null; note: string | null }[] = [];
  for (const i of raw) {
    if (i.result === "correct") continue;
    if (!["wrong", "skipped", "guessed"].includes(i.result)) throw new TrackerError("Unknown result.");
    const mod = modules.find((m) => m.section === i.section && m.number === i.module);
    if (!mod) throw new TrackerError("That module isn't on this test.");
    const n = Number(i.questionNumber);
    if (!Number.isInteger(n) || n < 1 || n > mod.question_count) throw new TrackerError(`Question numbers in that module go from 1 to ${mod.question_count}.`);
    const key = `${i.section}-${i.module}-${n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const skillId = i.skillId || null;
    if (skillId && skills.get(skillId) !== i.section) throw new TrackerError("Choose a skill from the same section as the question.");
    const errorTypeId = i.errorTypeId || null;
    if (errorTypeId && !errorTypes.has(errorTypeId)) throw new TrackerError("Unknown error type.");
    out.push({ section: i.section, module: i.module, questionNumber: n, result: i.result, skillId, errorTypeId, note: i.note?.trim().slice(0, 200) || null });
  }
  return out;
}

/** What's missing before a log counts as complete: scores, and a skill and error type on every miss. */
export async function completionProblems(attemptId: string) {
  const a = await db.testAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const items = await db.attemptItem.findMany({ where: { attemptId, result: { not: "correct" } } });
  const problems: string[] = [];
  if (a.total === null) problems.push("Enter your scores (both sections, or the total).");
  const untagged = items.filter((i) => !i.skillId || !i.errorTypeId);
  if (untagged.length) problems.push(`${untagged.length} question${untagged.length === 1 ? " needs" : "s need"} a skill and an error type: ${untagged.map((i) => `${i.section === "rw" ? "R&W" : "Math"} M${i.module} #${i.questionNumber}`).join(", ")}.`);
  return problems;
}

export async function completeAttempt(userId: string, attemptId: string) {
  await ownAttempt(userId, attemptId);
  const problems = await completionProblems(attemptId);
  if (problems.length) throw new TrackerError(problems.join(" "));
  await db.testAttempt.update({ where: { id: attemptId }, data: { status: "complete", completedAt: new Date() } });
  await syncScoreRecord(attemptId);
  return getAttempt(userId, attemptId);
}

async function reopen(attemptId: string) {
  await db.testAttempt.update({ where: { id: attemptId }, data: { status: "draft", completedAt: null } });
  await db.scoreRecord.deleteMany({ where: { testAttemptId: attemptId } });
}

/**
 * A complete log also appears in the student's SAT scores (the existing score
 * history, projections and reports), as a practice score with its missed
 * question numbers, domains and skills: never question content.
 */
async function syncScoreRecord(attemptId: string) {
  const a = await db.testAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { test: true, items: { include: { skill: true } } } });
  if (a.total === null) return;
  const missed = a.items
    .filter((i) => i.result !== "correct")
    .map((i) => ({ section: i.section === "rw" ? "RW" : "MATH", module: i.module, number: i.questionNumber, domain: i.skill?.parentId?.split(".")[1] ?? null, skill: i.skill?.name ?? null, reason: i.result }));
  const data = {
    source: a.test.source === "bluebook" ? ("PRACTICE_BLUEBOOK" as const) : ("PRACTICE_OTHER" as const),
    takenOn: a.dateTaken,
    testName: a.test.name,
    total: a.total,
    rw: a.scoreRw,
    math: a.scoreMath,
    missed: missed as Prisma.InputJsonValue,
  };
  const existing = await db.scoreRecord.findUnique({ where: { testAttemptId: attemptId }, select: { id: true } });
  if (existing) {
    await db.scoreRecord.update({ where: { id: existing.id }, data });
    return;
  }
  const first = (await db.scoreRecord.count({ where: { studentId: a.userId } })) === 0;
  await db.scoreRecord.create({ data: { ...data, studentId: a.userId, enteredById: a.userId, isBaseline: first, testAttemptId: attemptId } });
  await db.studentProfile.upsert({ where: { userId: a.userId }, create: { userId: a.userId, baselinePending: false }, update: { baselinePending: false } });
}

export async function deleteAttempt(userId: string, attemptId: string) {
  await ownAttempt(userId, attemptId);
  await db.testAttempt.delete({ where: { id: attemptId } }); // its score record goes with it
}

export async function trackerOptions() {
  const [skills, errorTypes] = await Promise.all([
    db.skill.findMany({ where: { parentId: { not: null } }, orderBy: { order: "asc" }, select: { id: true, section: true, domain: true, name: true } }),
    db.errorType.findMany({ orderBy: { order: "asc" }, select: { id: true, label: true } }),
  ]);
  return { skills, errorTypes };
}
