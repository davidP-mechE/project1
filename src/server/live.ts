import "server-only";
import { randomInt } from "node:crypto";
import { db } from "./db";
import { classIsInHouse, classSetWhere, collegeBoardAllowed } from "./in-house";
import { NotFoundError } from "./courses";
import { can, classAccess, ClassError, studentIdsInScope } from "./access";
import { cleanTargets, isAssignedToStudent, studentsTargeted } from "./targets";
import { bumpActivity } from "./activity";
import { checkBankAnswer, LETTERS } from "@/lib/bank/answers";

/**
 * Live warm-ups and exit tickets. A teacher (or a specialist, for their
 * groups) starts a live run of a short published set during a session.
 * Students in the class (or the run's groups) join from Today or with the
 * six-character code and answer each question once. The staff screen polls
 * for counts: answered, percent correct, and how many picked each choice.
 * Answers and explanations stay hidden from students until staff reveal them.
 * Closing a run files it under a session (the chosen one, or a new one) and
 * marks everyone who answered as present. Every answer is also a question-bank
 * attempt, so it counts toward the student's practice history. No AI.
 */

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const MAX_QUESTIONS = 20;
export const KIND_LABEL = { WARM_UP: "Warm-up", EXIT_TICKET: "Exit ticket" } as const;
export type LiveKind = keyof typeof KIND_LABEL;

const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");

/** Published, class-usable sets short enough to run live. */
export async function liveSetOptions(classInHouse = false) {
  const sets = await db.questionSet.findMany({ where: { AND: [{ status: "published", visibility: { not: "private" }, autoForStudentId: null }, classSetWhere(classInHouse)] }, orderBy: { title: "asc" }, select: { id: true, title: true, questionIds: true } });
  return sets.filter((s) => s.questionIds.length > 0 && s.questionIds.length <= MAX_QUESTIONS).map((s) => ({ id: s.id, title: s.title, count: s.questionIds.length }));
}

export async function startLiveRun(userId: string, classId: string, input: { setId: string; kind?: string; sessionId?: string | null; groupIds?: string[] }) {
  const access = await classAccess(userId, classId, "teach");
  const set = await db.questionSet.findFirst({ where: { AND: [{ id: input.setId }, classSetWhere(await classIsInHouse(classId))] }, select: { id: true, status: true, visibility: true, questionIds: true, autoForStudentId: true } });
  if (!set || set.status !== "published" || set.visibility === "private" || set.autoForStudentId) throw new ClassError("Choose a published set that classes can use.");
  if (!set.questionIds.length || set.questionIds.length > MAX_QUESTIONS) throw new ClassError(`A live run can have 1 to ${MAX_QUESTIONS} questions.`);
  const kind: LiveKind = input.kind === "EXIT_TICKET" ? "EXIT_TICKET" : "WARM_UP";
  const targets = await cleanTargets(access, { groupIds: input.groupIds ?? [], studentIds: [] });
  if (input.sessionId) {
    const s = await db.classSession.findFirst({ where: { id: input.sessionId, classId }, select: { groupId: true } });
    if (!s) throw new NotFoundError("Session not found");
    if (access.groupIds.length && s.groupId && !access.groupIds.includes(s.groupId)) throw new NotFoundError("Session not found");
  }
  for (let tries = 0; tries < 5; tries++) {
    try {
      return await db.liveRun.create({ data: { classId, setId: set.id, kind, sessionId: input.sessionId || null, code: newCode(), startedById: userId, groupIds: targets.groupIds } });
    } catch (err) {
      if (tries === 4) throw err; // a code clash, five times: give up
    }
  }
  throw new ClassError("Couldn't start the run. Please try again.");
}

async function runFor(runId: string) {
  const run = await db.liveRun.findUnique({ where: { id: runId }, include: { set: { select: { title: true, questionIds: true, source: true, audience: true } }, class: { select: { name: true, inHouseAccess: true } }, session: { select: { id: true, title: true, startsAt: true } } } });
  // The in-house rule and the College Board switch still apply to a run already open.
  if (!run || (!collegeBoardAllowed() && run.set.source === "college_board") || (run.set.audience === "in_house" && !run.class.inHouseAccess)) throw new NotFoundError("Not found");
  return run;
}

/** The staff screen: questions with answers, and the live counts, for students in the viewer's scope. */
export async function staffLiveView(userId: string, runId: string) {
  const run = await runFor(runId);
  const access = await classAccess(userId, run.classId);
  // The students this run is for, inside the viewer's scope.
  const forRun = [...(await studentsTargeted({ classId: run.classId, groupIds: run.groupIds, studentIds: [] }, await studentIdsInScope(access)))];
  const questions = await db.bankQuestion.findMany({ where: { id: { in: run.set.questionIds } }, select: { id: true, type: true, stem: true, choices: true, answer: true, explanation: true, imageUrl: true } });
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answers = await db.liveAnswer.findMany({ where: { runId, studentId: { in: forRun } }, select: { questionId: true, studentId: true, answerGiven: true, correct: true } });
  const joined = new Set(answers.map((a) => a.studentId));
  return {
    access,
    canTeach: can(access, "teach"),
    run: { id: run.id, code: run.code, kind: run.kind as LiveKind, status: run.status, title: run.set.title, className: run.class.name, classId: run.classId, revealed: run.revealed, createdAt: run.createdAt, closedAt: run.closedAt, session: run.session },
    eligible: forRun.length,
    joined: joined.size,
    questions: run.set.questionIds.flatMap((id, n) => {
      const q = byId.get(id);
      if (!q) return [];
      const mine = answers.filter((a) => a.questionId === id);
      const counts = new Map<string, number>();
      for (const a of mine) counts.set(a.answerGiven, (counts.get(a.answerGiven) ?? 0) + 1);
      return [
        {
          id,
          number: n + 1,
          type: q.type,
          stem: q.stem,
          choices: q.choices,
          imageUrl: q.imageUrl,
          answer: q.answer,
          explanation: q.explanation,
          answered: mine.length,
          correct: mine.filter((a) => a.correct).length,
          // MCQ: a count for every letter (zeros too); grid-in: each value given, most common first.
          counts: q.type === "mcq" ? LETTERS.slice(0, q.choices.length).map((l) => ({ answer: l, n: counts.get(l) ?? 0 })) : [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([answer, n]) => ({ answer, n })),
          revealed: run.revealed.includes(id),
        },
      ];
    }),
  };
}

/** Can this student take part in this run? (A class member it's for; Admin → Program access applies through class membership.) */
async function studentRun(userId: string, runId: string) {
  const run = await runFor(runId);
  const member = await db.classMember.count({ where: { classId: run.classId, userId } });
  if (!member || !(await isAssignedToStudent({ classId: run.classId, groupIds: run.groupIds, studentIds: [] }, userId))) throw new NotFoundError("Not found");
  return run;
}

/** The student's screen: questions without answers until revealed, and their own answers. */
export async function studentLiveView(userId: string, runId: string) {
  const run = await studentRun(userId, runId);
  const questions = await db.bankQuestion.findMany({ where: { id: { in: run.set.questionIds }, status: "published" }, select: { id: true, type: true, stem: true, choices: true, imageUrl: true, answer: true, explanation: true } });
  const byId = new Map(questions.map((q) => [q.id, q]));
  const mine = new Map((await db.liveAnswer.findMany({ where: { runId, studentId: userId } })).map((a) => [a.questionId, a]));
  return {
    run: { id: run.id, kind: run.kind as LiveKind, status: run.status, title: run.set.title, className: run.class.name },
    questions: run.set.questionIds.flatMap((id, n) => {
      const q = byId.get(id);
      if (!q) return [];
      const revealed = run.revealed.includes(id) || run.status === "CLOSED";
      const a = mine.get(id);
      return [{ id, number: n + 1, type: q.type, stem: q.stem, choices: q.choices, imageUrl: q.imageUrl, mine: a ? { answer: a.answerGiven, correct: revealed ? a.correct : null } : null, reveal: revealed ? { answer: q.answer, explanation: q.explanation } : null }];
    }),
  };
}

/** Answer one question (once). Recorded as a live answer and as a question-bank attempt. */
export async function answerLive(userId: string, runId: string, questionId: string, given: string, now = new Date()) {
  const run = await studentRun(userId, runId);
  if (run.status !== "OPEN") throw new ClassError("This run has ended.");
  if (!run.set.questionIds.includes(questionId)) throw new NotFoundError("Not found");
  if (run.revealed.includes(questionId)) throw new ClassError("The answer to this one is already showing.");
  const q = await db.bankQuestion.findUnique({ where: { id: questionId } });
  if (!q || q.status !== "published") throw new NotFoundError("Not found");
  const answer = given.trim().slice(0, 40);
  if (!answer) throw new ClassError("Enter an answer first.");
  const result = checkBankAnswer({ type: q.type, answer: q.answer, distractorNotes: q.distractorNotes }, answer);
  try {
    await db.liveAnswer.create({ data: { runId, questionId, studentId: userId, answerGiven: result.normalized, correct: result.correct, createdAt: now } });
  } catch {
    throw new ClassError("You've already answered this one.");
  }
  await db.bankAttempt.create({ data: { userId, questionId, questionVersion: q.version, setId: run.setId, answerGiven: result.normalized, correct: result.correct, createdAt: now } });
  await bumpActivity(userId, { questionsAnswered: 1, questionsCorrect: result.correct ? 1 : 0 }, now);
  return { answered: true };
}

/** Show one question's answer and explanation to students, or all of them. */
export async function revealLive(userId: string, runId: string, questionId: string | "all") {
  const run = await runFor(runId);
  await classAccess(userId, run.classId, "teach");
  const ids = questionId === "all" ? run.set.questionIds : run.set.questionIds.includes(questionId) ? [questionId] : null;
  if (!ids) throw new NotFoundError("Not found");
  await db.liveRun.update({ where: { id: runId }, data: { revealed: [...new Set([...run.revealed, ...ids])] } });
}

/**
 * End the run: students can no longer answer and see every answer. The run is
 * filed under its session (a new one for now if none was chosen), and every
 * student who answered is marked present unless already marked.
 */
export async function closeLive(userId: string, runId: string, now = new Date()) {
  const run = await runFor(runId);
  const access = await classAccess(userId, run.classId, "teach");
  if (run.status === "CLOSED") return { sessionId: run.sessionId };
  let sessionId = run.sessionId;
  if (!sessionId) {
    const s = await db.classSession.create({
      data: { classId: run.classId, groupId: run.groupIds.length === 1 ? run.groupIds[0] : null, title: `${KIND_LABEL[run.kind as LiveKind] ?? "Live"}: ${run.set.title}`.slice(0, 120), startsAt: run.createdAt, endsAt: now > run.createdAt ? now : new Date(run.createdAt.getTime() + 60_000), createdById: userId },
    });
    sessionId = s.id;
  }
  await db.liveRun.update({ where: { id: runId }, data: { status: "CLOSED", closedAt: now, sessionId } });
  const scope = new Set(await studentIdsInScope(access));
  const came = [...new Set((await db.liveAnswer.findMany({ where: { runId }, select: { studentId: true } })).map((a) => a.studentId))].filter((id) => scope.has(id));
  for (const studentId of came) {
    await db.attendanceRecord.upsert({ where: { sessionId_studentId: { sessionId, studentId } }, create: { sessionId, studentId, status: "PRESENT", markedById: userId, markedAt: now }, update: {} });
  }
  return { sessionId };
}

/** Runs in a class, newest first (staff). */
export async function classLiveRuns(userId: string, classId: string) {
  const access = await classAccess(userId, classId);
  const runs = await db.liveRun.findMany({ where: { classId, ...(access.groupIds.length ? { OR: [{ groupIds: { isEmpty: true } }, { groupIds: { hasSome: access.groupIds } }] } : {}) }, orderBy: { createdAt: "desc" }, take: 30, include: { set: { select: { title: true, questionIds: true } }, _count: { select: { answers: true } } } });
  return { access, runs };
}

/** Open runs a student can join now (for Today). */
export async function openRunsFor(userId: string) {
  const runs = await db.liveRun.findMany({ where: { status: "OPEN", class: { archivedAt: null, members: { some: { userId } } } }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, classId: true, groupIds: true, class: { select: { name: true } }, set: { select: { title: true } } } });
  const out = [];
  for (const r of runs) if (await isAssignedToStudent({ classId: r.classId, groupIds: r.groupIds, studentIds: [] }, userId)) out.push({ id: r.id, kind: r.kind as LiveKind, className: r.class.name, title: r.set.title });
  return out;
}

/** Join with a code: the run's id if this student may take part. */
export async function joinByCode(userId: string, code: string) {
  const run = await db.liveRun.findUnique({ where: { code: code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) }, select: { id: true, status: true } });
  if (!run || run.status !== "OPEN") throw new NotFoundError("No open run with that code.");
  await studentRun(userId, run.id);
  return run.id;
}

/** For the start form: sessions from 12 hours ago to a week ahead, and groups, inside the viewer's scope. */
export async function liveStartOptions(userId: string, classId: string, now = new Date()) {
  const access = await classAccess(userId, classId, "teach");
  const [sessions, groups, sets] = await Promise.all([
    db.classSession.findMany({
      where: { classId, startsAt: { gte: new Date(now.getTime() - 12 * 3600_000), lte: new Date(now.getTime() + 7 * 86_400_000) }, ...(access.groupIds.length ? { groupId: { in: access.groupIds } } : {}) },
      orderBy: { startsAt: "asc" },
      select: { id: true, title: true, startsAt: true },
    }),
    db.classGroup.findMany({ where: { classId, ...(access.groupIds.length ? { id: { in: access.groupIds } } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    liveSetOptions(await classIsInHouse(classId)),
  ]);
  return { sessions, groups, sets };
}
