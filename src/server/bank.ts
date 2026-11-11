import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { roleOf } from "./roles";
import { isAssignedToStudent } from "./targets";
import { Prisma } from "@/generated/prisma/client";
import { checkBankAnswer, LETTERS } from "@/lib/bank/answers";
import { readRecords, skillResolver, techniqueFromDb, techniqueToDb, validateRecord, validateRecords, type ImportedQuestion, type RowResult } from "@/lib/bank/import";

/**
 * The question bank: original questions only (source is always "original").
 *
 * Who can do what (checked here, on the server, for every page and route):
 *   owner, approved tutors   see every question; create, import, edit and build sets.
 *                            Tutors edit their own questions and sets; the owner edits any.
 *   students                 never see the bank itself; they play published sets and
 *                            only ever see published questions in them.
 *
 * Versions: editing a published question (or one that's been answered) saves the
 * old content as a version and bumps `version`; attempts keep the version they answered.
 */

export class BankError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Authors only; everyone else gets "not found" so the bank can't be probed. */
export async function requireAuthor(userId: string) {
  const r = await roleOf(userId);
  if (!r.isAuthor) throw new NotFoundError("Not found");
  return r;
}

export async function canAuthor(userId: string) {
  return (await roleOf(userId)).isAuthor;
}

async function skills() {
  return db.skill.findMany({ select: { id: true, section: true, name: true, parentId: true, domain: true }, orderBy: { order: "asc" } });
}

export async function skillOptions() {
  const all = await skills();
  return all.filter((s) => s.parentId).map((s) => ({ id: s.id, section: s.section, domain: s.domain, name: s.name }));
}

// ─── Listing ─────────────────────────────────────────────────────────────

export type BankFilters = { section?: string; skillId?: string; week?: number; difficulty?: number; type?: string; status?: string; q?: string; page?: number };
const PAGE = 50;

export async function listBank(userId: string, f: BankFilters = {}) {
  await requireAuthor(userId);
  const where: Prisma.BankQuestionWhereInput = {
    ...(f.section === "math" || f.section === "rw" ? { section: f.section } : {}),
    ...(f.skillId ? { skillId: f.skillId } : {}),
    ...(f.week ? { week: f.week } : {}),
    ...(f.difficulty ? { difficulty: f.difficulty } : {}),
    ...(f.type === "mcq" || f.type === "grid_in" ? { type: f.type } : {}),
    ...(f.status === "draft" || f.status === "published" ? { status: f.status } : {}),
    ...(f.q?.trim() ? { OR: [{ stem: { contains: f.q.trim(), mode: "insensitive" as const } }, { externalId: { contains: f.q.trim(), mode: "insensitive" as const } }] } : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.bankQuestion.findMany({
      where,
      orderBy: [{ week: { sort: "asc", nulls: "last" } }, { externalId: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      select: { id: true, externalId: true, section: true, type: true, difficulty: true, status: true, version: true, week: true, stem: true, skill: { select: { name: true } }, author: { select: { name: true } } },
    }),
    db.bankQuestion.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE)) };
}

export async function getBankQuestion(userId: string, id: string) {
  await requireAuthor(userId);
  const q = await db.bankQuestion.findUnique({ where: { id }, include: { skill: true, author: { select: { id: true, name: true } }, versions: { orderBy: { version: "desc" }, select: { version: true, createdAt: true } }, _count: { select: { attempts: true } } } });
  if (!q) throw new NotFoundError("Question not found");
  return q;
}

// ─── Creating and editing ────────────────────────────────────────────────

/** The editor sends the same field names as the import format. */
export type QuestionInput = Record<string, unknown>;

async function validated(input: QuestionInput) {
  const res = validateRecord(input, 1, skillResolver(await skills()));
  if (!res.ok) throw new BankError(res.errors.join(" "));
  return res.data!;
}

const contentOf = (d: ImportedQuestion) => ({
  section: d.section,
  skillId: d.skillId,
  type: d.type,
  difficulty: d.difficulty,
  stem: d.stem,
  choices: d.choices,
  answer: d.answer,
  answerText: d.answerText,
  explanation: d.explanation,
  distractorNotes: d.distractorNotes,
  week: d.week,
  lesson: d.lesson,
  unit: d.unit,
  focus: d.focus,
  blueprint: d.blueprint,
  desmosTechnique: d.desmosTechnique ? techniqueToDb(d.desmosTechnique) : null,
  imageUrl: d.imageUrl,
});

export async function createQuestion(userId: string, input: QuestionInput, opts: { publish?: boolean } = {}) {
  await requireAuthor(userId);
  const d = await validated(input);
  if (d.externalId && (await db.bankQuestion.findUnique({ where: { externalId: d.externalId }, select: { id: true } }))) throw new BankError(`The id "${d.externalId}" is already used.`);
  const desmosState = input.desmos_state === undefined ? undefined : (d.desmosState as Prisma.InputJsonValue | null) ?? undefined;
  return db.bankQuestion.create({ data: { ...contentOf(d), externalId: d.externalId, authorId: userId, source: "original", status: opts.publish ? "published" : "draft", ...(desmosState ? { desmosState } : {}) } });
}

/** Content fields whose change makes a new version. */
const VERSIONED = ["type", "stem", "choices", "answer", "answerText", "explanation", "distractorNotes", "desmosState", "imageUrl"] as const;

async function editable(userId: string, id: string) {
  const r = await requireAuthor(userId);
  const q = await db.bankQuestion.findUnique({ where: { id } });
  if (!q) throw new NotFoundError("Question not found");
  if (!r.isOwner && q.authorId !== userId) throw new BankError("Only the question's author (or the owner) can change it.", 403);
  return q;
}

/**
 * Save edits. A published question (or one students have answered) keeps its
 * old content as a version, and its version number goes up, so past attempts
 * still point at exactly what was answered. Drafts nobody answered are edited in place.
 */
export async function updateQuestion(userId: string, id: string, input: QuestionInput, opts: { publish?: boolean; unpublish?: boolean } = {}) {
  const q = await editable(userId, id);
  const d = await validated(input);
  if (d.externalId && d.externalId !== q.externalId && (await db.bankQuestion.findUnique({ where: { externalId: d.externalId }, select: { id: true } }))) throw new BankError(`The id "${d.externalId}" is already used.`);
  const next = { ...contentOf(d), externalId: d.externalId ?? q.externalId };
  const desmosState = input.desmos_state === undefined ? q.desmosState : d.desmosState;
  const changed = VERSIONED.some((k) => JSON.stringify(k === "desmosState" ? (desmosState ?? null) : (next as Record<string, unknown>)[k] ?? null) !== JSON.stringify((q as Record<string, unknown>)[k] ?? null));
  const answered = (await db.bankAttempt.count({ where: { questionId: id, questionVersion: q.version } })) > 0;
  const bump = changed && (q.status === "published" || answered);
  const status = opts.publish ? "published" : opts.unpublish ? "draft" : q.status;
  return db.$transaction(async (tx) => {
    if (bump) {
      await tx.bankQuestionVersion.create({
        data: {
          questionId: id,
          version: q.version,
          type: q.type,
          stem: q.stem,
          choices: q.choices,
          answer: q.answer,
          answerText: q.answerText,
          explanation: q.explanation,
          distractorNotes: q.distractorNotes as Prisma.InputJsonValue,
          desmosState: (q.desmosState as Prisma.InputJsonValue) ?? undefined,
          imageUrl: q.imageUrl,
          editedById: userId,
        },
      });
    }
    return tx.bankQuestion.update({
      where: { id },
      data: { ...next, desmosState: desmosState === null ? Prisma.DbNull : (desmosState as Prisma.InputJsonValue), status, version: bump ? q.version + 1 : q.version },
    });
  });
}

/** Save just the Desmos graph (from the editor's calculator), versioned like any edit. */
export async function setQuestionDesmos(userId: string, id: string, state: object | null, technique?: string | null) {
  const q = await editable(userId, id);
  return updateQuestion(userId, id, { ...toRecord(q), desmos_state: state, ...(technique !== undefined ? { desmos_technique: technique ?? "" } : {}) });
}

export async function setQuestionStatus(userId: string, id: string, status: "draft" | "published") {
  await editable(userId, id);
  return db.bankQuestion.update({ where: { id }, data: { status } });
}

export async function deleteQuestion(userId: string, id: string) {
  const q = await editable(userId, id);
  if (q.status === "published" || (await db.bankAttempt.count({ where: { questionId: id } })) > 0) throw new BankError("Published or answered questions can't be deleted (it would change students' history). Unpublish it instead.");
  await db.bankQuestion.delete({ where: { id } });
  await db.$executeRaw`UPDATE "question_sets" SET "question_ids" = array_remove("question_ids", ${id})`;
}

/** A question as an import-format record (for the editor and for re-saving). */
export function toRecord(q: { externalId: string | null; section: string; skillId: string | null; type: string; difficulty: number; stem: string; choices: string[]; answer: string; answerText: string | null; explanation: string; distractorNotes: unknown; week: number | null; lesson: string | null; unit: string | null; focus: string | null; blueprint: string | null; desmosTechnique: string | null; imageUrl: string | null }) {
  return {
    external_id: q.externalId ?? "",
    section: q.section,
    skill: q.skillId ?? "",
    difficulty: q.difficulty,
    type: q.type === "grid_in" ? "grid-in" : "mcq",
    stem: q.stem,
    choice_a: q.choices[0] ?? "",
    choice_b: q.choices[1] ?? "",
    choice_c: q.choices[2] ?? "",
    choice_d: q.choices[3] ?? "",
    answer: q.answer,
    answer_text: q.answerText ?? "",
    explanation: q.explanation,
    distractor_notes: (q.distractorNotes ?? {}) as Record<string, string>,
    week: q.week ?? "",
    lesson: q.lesson ?? "",
    unit: q.unit ?? "",
    focus: q.focus ?? "",
    blueprint: q.blueprint ?? "",
    desmos_technique: q.desmosTechnique ? techniqueFromDb(q.desmosTechnique) : "",
    image_url: q.imageUrl ?? "",
  };
}

// ─── Import ──────────────────────────────────────────────────────────────

export type ImportReport = { rows: RowResult[]; imported: number; skipped: { row: number; externalId: string | null; reason: string }[]; failed: number; questionIds: string[] };

/**
 * Preview (commit = false) or import (commit = true) a CSV/JSON file. Good rows
 * are imported as drafts; rows with errors are reported, never imported; a row
 * whose id is already in the bank is skipped. Unknown fields are ignored.
 */
export async function importQuestions(userId: string, text: string, format: "csv" | "json", opts: { commit: boolean }): Promise<ImportReport> {
  await requireAuthor(userId);
  return runImport(text, format, { commit: opts.commit, authorId: userId });
}

/** The import itself, without a permission check: only for npm run db:seed and importQuestions. */
export async function runImport(text: string, format: "csv" | "json", opts: { commit: boolean; authorId: string | null }): Promise<ImportReport> {
  let records: Record<string, unknown>[];
  try {
    records = readRecords(text, format);
  } catch (err) {
    throw new BankError(err instanceof Error ? err.message : "That file couldn't be read.");
  }
  const rows = validateRecords(records, skillResolver(await skills()), { firstRow: format === "csv" ? 2 : 1 });
  const ids = rows.flatMap((r) => (r.ok && r.externalId ? [r.externalId] : []));
  const existing = new Set((await db.bankQuestion.findMany({ where: { externalId: { in: ids } }, select: { externalId: true } })).map((q) => q.externalId!));
  const skipped = rows.filter((r) => r.ok && r.externalId && existing.has(r.externalId)).map((r) => ({ row: r.row, externalId: r.externalId, reason: "Already in the bank" }));
  const todo = rows.filter((r) => r.ok && !(r.externalId && existing.has(r.externalId)));
  const questionIds: string[] = [];
  if (opts.commit && todo.length) {
    const authorId = opts.authorId;
    await db.$transaction(async (tx) => {
      for (const r of todo) {
        const d = r.data!;
        const q = await tx.bankQuestion.create({ data: { ...contentOf(d), externalId: d.externalId, authorId, source: "original", status: "draft", ...(d.desmosState ? { desmosState: d.desmosState as Prisma.InputJsonValue } : {}) }, select: { id: true } });
        questionIds.push(q.id);
      }
    });
  }
  return { rows, imported: opts.commit ? questionIds.length : todo.length, skipped, failed: rows.filter((r) => !r.ok).length, questionIds };
}

// ─── Sets ────────────────────────────────────────────────────────────────

async function setSkills(questionIds: string[]) {
  const qs = await db.bankQuestion.findMany({ where: { id: { in: questionIds } }, select: { skillId: true } });
  return [...new Set(qs.flatMap((q) => (q.skillId ? [q.skillId] : [])))];
}

export type SetInput = { title: string; description?: string | null; questionIds: string[]; visibility?: "private" | "class" | "public"; timeLimitMin?: number | null };

function cleanSet(input: SetInput) {
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new BankError("Give the set a title.");
  const ids = [...new Set(input.questionIds)];
  if (ids.length > 200) throw new BankError("A set can have at most 200 questions.");
  const limit = input.timeLimitMin ? Math.round(input.timeLimitMin) : null;
  if (limit !== null && (limit < 1 || limit > 300)) throw new BankError("A time limit can be 1 to 300 minutes.");
  return { title, description: input.description?.trim().slice(0, 2000) || null, questionIds: ids, visibility: input.visibility ?? "private", timeLimitMin: limit };
}

export async function createSet(userId: string, input: SetInput) {
  await requireAuthor(userId);
  const s = cleanSet(input);
  if ((await db.bankQuestion.count({ where: { id: { in: s.questionIds } } })) !== s.questionIds.length) throw new BankError("Some of those questions aren't in the bank.");
  return db.questionSet.create({ data: { ...s, authorId: userId, skillIds: await setSkills(s.questionIds) } });
}

async function editableSet(userId: string, setId: string) {
  const r = await requireAuthor(userId);
  const s = await db.questionSet.findUnique({ where: { id: setId } });
  if (!s) throw new NotFoundError("Set not found");
  if (!r.isOwner && s.authorId !== userId) throw new BankError("Only the set's author (or the owner) can change it.", 403);
  return s;
}

export async function updateSet(userId: string, setId: string, input: SetInput) {
  await editableSet(userId, setId);
  const s = cleanSet(input);
  if ((await db.bankQuestion.count({ where: { id: { in: s.questionIds } } })) !== s.questionIds.length) throw new BankError("Some of those questions aren't in the bank.");
  return db.questionSet.update({ where: { id: setId }, data: { ...s, skillIds: await setSkills(s.questionIds) } });
}

/** Publish or unpublish a set. With `withQuestions`, its draft questions are published too. */
export async function setSetStatus(userId: string, setId: string, status: "draft" | "published", opts: { withQuestions?: boolean } = {}) {
  const s = await editableSet(userId, setId);
  if (status === "published" && opts.withQuestions) {
    const r = await roleOf(userId);
    await db.bankQuestion.updateMany({ where: { id: { in: s.questionIds }, status: "draft", ...(r.isOwner ? {} : { authorId: userId }) }, data: { status: "published" } });
  }
  return db.questionSet.update({ where: { id: setId }, data: { status } });
}

export async function deleteSet(userId: string, setId: string) {
  await editableSet(userId, setId);
  if (await db.assignment.count({ where: { questionSetId: setId } })) throw new BankError("This set is assigned to a class. Delete the assignment first.");
  await db.questionSet.delete({ where: { id: setId } });
}

/** "10 questions, skill X, difficulty 2–3": a random pick of matching questions (published ones first). */
export async function autoGenerateSet(userId: string, input: { title?: string; count: number; skillId?: string | null; section?: string | null; difficultyMin?: number; difficultyMax?: number; type?: string | null; publishedOnly?: boolean }) {
  await requireAuthor(userId);
  const count = Math.round(input.count);
  if (!(count >= 1 && count <= 100)) throw new BankError("Choose 1 to 100 questions.");
  const lo = Math.max(1, Math.min(3, input.difficultyMin ?? 1));
  const hi = Math.max(lo, Math.min(3, input.difficultyMax ?? 3));
  const pool = await db.bankQuestion.findMany({
    where: {
      difficulty: { gte: lo, lte: hi },
      ...(input.skillId ? { skillId: input.skillId } : {}),
      ...(input.section === "math" || input.section === "rw" ? { section: input.section } : {}),
      ...(input.type === "mcq" || input.type === "grid_in" ? { type: input.type } : {}),
      ...(input.publishedOnly ? { status: "published" as const } : {}),
    },
    select: { id: true, status: true },
  });
  if (pool.length === 0) throw new BankError("No questions match. Try a wider difficulty or another skill.");
  const shuffled = pool.map((q) => ({ q, k: (q.status === "published" ? 0 : 1) + Math.random() })).sort((a, b) => a.k - b.k);
  const picked = shuffled.slice(0, count).map((x) => x.q.id);
  const skill = input.skillId ? await db.skill.findUnique({ where: { id: input.skillId }, select: { name: true } }) : null;
  const title = input.title?.trim() || `${picked.length} questions${skill ? ` · ${skill.name}` : ""} · difficulty ${lo === hi ? lo : `${lo}–${hi}`}`;
  return { set: await createSet(userId, { title, questionIds: picked, visibility: "private" }), found: pool.length };
}

export async function listSets(userId: string) {
  await requireAuthor(userId);
  return db.questionSet.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, visibility: true, questionIds: true, timeLimitMin: true, author: { select: { name: true } }, updatedAt: true } });
}

export async function getSetForAuthor(userId: string, setId: string) {
  await requireAuthor(userId);
  const s = await db.questionSet.findUnique({ where: { id: setId }, include: { author: { select: { name: true } } } });
  if (!s) throw new NotFoundError("Set not found");
  const qs = await db.bankQuestion.findMany({ where: { id: { in: s.questionIds } }, select: { id: true, externalId: true, stem: true, status: true, difficulty: true, type: true, skill: { select: { name: true } } } });
  const byId = new Map(qs.map((q) => [q.id, q]));
  return { ...s, questions: s.questionIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])) };
}

// ─── Practice player ─────────────────────────────────────────────────────

/**
 * May this person play this set? Authors: any set (to preview). Students: a
 * published set that's public, or assigned to them in one of their classes.
 */
async function playAccess(userId: string, setId: string, assignmentId?: string | null) {
  const set = await db.questionSet.findUnique({ where: { id: setId } });
  if (!set) throw new NotFoundError("Set not found");
  const r = await roleOf(userId);
  let assignment: { id: string; calculator: "ALLOWED" | "BY_HAND"; timeLimitMin: number | null } | null = null;
  if (assignmentId) {
    const a = await db.assignment.findUnique({ where: { id: assignmentId }, select: { id: true, classId: true, kind: true, questionSetId: true, calculator: true, timeLimitMin: true, groupIds: true, studentIds: true } });
    const member = a ? await db.classMember.count({ where: { classId: a.classId, userId } }) : 0;
    if (!a || a.kind !== "QUESTION_SET" || a.questionSetId !== setId || !member || !(await isAssignedToStudent(a, userId))) throw new NotFoundError("Set not found");
    assignment = a;
  }
  if (!r.isAuthor) {
    if (set.status !== "published") throw new NotFoundError("Set not found");
    if (!assignment && set.visibility !== "public") throw new NotFoundError("Set not found");
  }
  return { set, isAuthor: r.isAuthor, assignment };
}

/** Questions as the player shows them: never the answer, explanation or notes (those come back after answering). */
async function playableQuestions(setIds: string[], isAuthor: boolean) {
  const qs = await db.bankQuestion.findMany({
    where: { id: { in: setIds }, source: "original", ...(isAuthor ? {} : { status: "published" }) },
    select: { id: true, version: true, type: true, section: true, stem: true, choices: true, imageUrl: true, difficulty: true, skill: { select: { name: true } } },
  });
  const byId = new Map(qs.map((q) => [q.id, q]));
  return setIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/** Start a sitting (each one is a fresh calculator and, if timed, a fresh clock). */
export async function startPractice(userId: string, setId: string, opts: { assignmentId?: string | null; timed?: boolean } = {}) {
  const { set, isAuthor, assignment } = await playAccess(userId, setId, opts.assignmentId);
  const limitMin = assignment?.timeLimitMin ?? (opts.timed ? set.timeLimitMin ?? Math.max(1, Math.round(set.questionIds.length * 1.6)) : null);
  const session = await db.practiceSession.create({
    data: { userId, setId, assignmentId: assignment?.id ?? null, timeLimitSec: limitMin ? limitMin * 60 : null, calculator: assignment?.calculator ?? "ALLOWED" },
  });
  return { sessionId: session.id, isAuthor };
}

export async function practiceState(userId: string, sessionId: string, now = new Date()) {
  const s = await db.practiceSession.findUnique({ where: { id: sessionId }, include: { set: true, attempts: { orderBy: { createdAt: "asc" } } } });
  if (!s || s.userId !== userId) throw new NotFoundError("Not found");
  const r = await roleOf(userId);
  const questions = await playableQuestions(s.set.questionIds, r.isAuthor);
  const endsAt = s.timeLimitSec ? new Date(s.startedAt.getTime() + s.timeLimitSec * 1000) : null;
  const answered = new Map(s.attempts.map((a) => [a.questionId, a]));
  const feedback = await Promise.all(
    [...answered.values()].map(async (a) => [a.questionId, await feedbackFor(a.questionId, a.questionVersion, a.answerGiven)] as const),
  );
  return {
    sessionId: s.id,
    setId: s.setId,
    title: s.set.title,
    calculator: s.calculator,
    assignmentId: s.assignmentId,
    startedAt: s.startedAt,
    endsAt,
    timeUp: Boolean(endsAt && now >= endsAt),
    finishedAt: s.finishedAt,
    isAuthor: r.isAuthor,
    questions: questions.map((q) => ({ id: q.id, type: q.type, section: q.section, stem: q.stem, choices: q.choices, imageUrl: q.imageUrl, skill: q.skill?.name ?? null, difficulty: q.difficulty })),
    answers: Object.fromEntries(feedback),
  };
}

/** What the player shows after an answer, from the version that was answered. */
async function feedbackFor(questionId: string, version: number, given: string) {
  const q = await db.bankQuestion.findUniqueOrThrow({ where: { id: questionId } });
  const old = version === q.version ? null : await db.bankQuestionVersion.findUnique({ where: { questionId_version: { questionId, version } } });
  const content = old ?? q;
  const result = checkBankAnswer({ type: content.type, answer: content.answer, distractorNotes: content.distractorNotes }, given);
  const lesson = q.desmosTechnique ? await toolkitLesson(q.desmosTechnique) : null;
  return {
    given,
    correct: result.correct,
    likelyMistake: result.likelyMistake,
    correctAnswer: content.type === "mcq" ? `${content.answer}${content.answerText ? ` (${content.answerText})` : content.choices[LETTERS.indexOf(content.answer as (typeof LETTERS)[number])] ? ` (${content.choices[LETTERS.indexOf(content.answer as (typeof LETTERS)[number])]})` : ""}` : content.answer.split(/[|;]/)[0].trim(),
    explanation: content.explanation,
    desmosState: (content.desmosState as object | null) ?? null,
    desmosTechnique: q.desmosTechnique ? techniqueFromDb(q.desmosTechnique) : null,
    toolkitLesson: lesson,
  };
}

/** The published Desmos Toolkit lesson for a technique, if there is one. */
export async function toolkitLesson(technique: string) {
  const l = await db.studioLesson.findFirst({
    where: { desmosTechnique: technique as never, unit: { course: { status: "published", visibility: "public" } } },
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    select: { id: true, title: true, unit: { select: { course: { select: { slug: true } } } } },
  });
  return l ? { title: l.title, href: `/learn/${l.unit.course.slug}/lessons/${l.id}` } : null;
}

const GRACE_MS = 5_000;

/** Check one answer, record it against the question's current version, and return the feedback. One answer per question per sitting. */
export async function answerPractice(userId: string, sessionId: string, questionId: string, given: string, timeSeconds: number, now = new Date()) {
  const s = await db.practiceSession.findUnique({ where: { id: sessionId }, include: { set: { select: { questionIds: true } } } });
  if (!s || s.userId !== userId) throw new NotFoundError("Not found");
  if (s.finishedAt) throw new BankError("This set is finished. Start it again to practise more.");
  if (s.timeLimitSec && now.getTime() > s.startedAt.getTime() + s.timeLimitSec * 1000 + GRACE_MS) throw new BankError("Time's up for this set.", 409);
  if (!s.set.questionIds.includes(questionId)) throw new NotFoundError("Not found");
  const r = await roleOf(userId);
  const q = await db.bankQuestion.findUnique({ where: { id: questionId } });
  if (!q || (!r.isAuthor && q.status !== "published")) throw new NotFoundError("Not found");
  const answer = given.trim().slice(0, 40);
  if (!answer) throw new BankError("Enter an answer first.");
  if (await db.bankAttempt.findFirst({ where: { sessionId, questionId }, select: { id: true } })) throw new BankError("You've already answered this one in this sitting.", 409);
  const result = checkBankAnswer({ type: q.type, answer: q.answer, distractorNotes: q.distractorNotes }, answer);
  await db.bankAttempt.create({
    data: { userId, questionId, questionVersion: q.version, setId: s.setId, sessionId, answerGiven: result.normalized, correct: result.correct, timeSeconds: Math.max(0, Math.min(3600, Math.round(timeSeconds || 0))) },
  });
  return feedbackFor(questionId, q.version, result.normalized);
}

export async function finishPractice(userId: string, sessionId: string) {
  const s = await db.practiceSession.findUnique({ where: { id: sessionId } });
  if (!s || s.userId !== userId) throw new NotFoundError("Not found");
  if (!s.finishedAt) await db.practiceSession.update({ where: { id: sessionId }, data: { finishedAt: new Date() } });
  const attempts = await db.bankAttempt.findMany({ where: { sessionId } });
  return { correct: attempts.filter((a) => a.correct).length, answered: attempts.length };
}

/** Sets a student can play: published + public, plus anything assigned to them (found from their classes). */
export async function practiceCatalog(userId: string) {
  const r = await roleOf(userId);
  const sets = await db.questionSet.findMany({
    where: r.isAuthor ? {} : { status: "published", visibility: "public" },
    orderBy: { title: "asc" },
    select: { id: true, title: true, description: true, status: true, questionIds: true, timeLimitMin: true },
  });
  const counts = await db.bankQuestion.findMany({ where: { id: { in: sets.flatMap((s) => s.questionIds) }, ...(r.isAuthor ? {} : { status: "published" }) }, select: { id: true } });
  const visible = new Set(counts.map((c) => c.id));
  return sets.map((s) => ({ ...s, count: s.questionIds.filter((id) => visible.has(id)).length })).filter((s) => r.isAuthor || s.count > 0);
}

/** Look questions up by external id (W3-01) or id, for adding to a set by hand. */
export async function findQuestions(userId: string, refs: string[]) {
  await requireAuthor(userId);
  const clean = [...new Set(refs.map((r) => r.trim()).filter(Boolean))].slice(0, 200);
  const qs = await db.bankQuestion.findMany({ where: { OR: [{ externalId: { in: clean } }, { id: { in: clean } }] }, select: { id: true, externalId: true, stem: true, status: true, difficulty: true, type: true, skill: { select: { name: true } } } });
  const found = new Map<string, (typeof qs)[number]>();
  for (const q of qs) {
    if (q.externalId) found.set(q.externalId, q);
    found.set(q.id, q);
  }
  return { questions: clean.flatMap((r) => (found.has(r) ? [found.get(r)!] : [])), missing: clean.filter((r) => !found.has(r)) };
}

/** The start screen for a set (same access rules as playing it). */
export async function practiceIntro(userId: string, setId: string, assignmentId?: string | null) {
  const { set, isAuthor, assignment } = await playAccess(userId, setId, assignmentId);
  const count = await db.bankQuestion.count({ where: { id: { in: set.questionIds }, ...(isAuthor ? {} : { status: "published" }) } });
  return { id: set.id, title: set.title, description: set.description, status: set.status, count, timeLimitMin: assignment?.timeLimitMin ?? set.timeLimitMin, assignment, isAuthor };
}
