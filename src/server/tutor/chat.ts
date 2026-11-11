import "server-only";
import { courseAccessWhere, programAccess } from "../program-access";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { env } from "../env";
import { NotFoundError } from "../courses";
import { recordUsage } from "../usage";
import { AiError } from "../ai/writer";
import { assertAiBudget, LimitError } from "../limits";
import type { TutorModel } from "../ai/tutor";
import type { QueryEmbedder } from "../embeddings/types";
import { embeddingProgress } from "../embeddings/book";
import { retrievePassages } from "./retrieve";
import { checkCitations, saysNotInBook } from "@/lib/tutor/citations";
import { pagesCovered } from "@/lib/tutor/retrieval";
import { threadTitle, tutorMessages, type TutorTurn } from "@/lib/tutor/prompt";
import { looksLikeSat } from "@/lib/tutor/sat-curriculum";

/**
 * "Ask the book": one question → find passages → Claude answers (streamed)
 * → citations checked → saved. Every step checks the course is the student's.
 */

export class TutorError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const MAX_QUESTION_CHARS = 4_000;

export type Source = { chunkId: string; pageStart: number; pageEnd: number };
export type TutorEvent =
  | { type: "meta"; threadId: string; threadTitle: string; messageId: string; sources: Source[]; confidence: "high" | "low" | "none"; mode: "hybrid" | "keyword" }
  | { type: "delta"; text: string }
  | { type: "done"; content: string; citedPages: number[]; notInBook: boolean; status: "DONE" | "STOPPED" }
  | { type: "error"; message: string };

async function ownedCourse(userId: string, courseId: string) {
  const course = await db.course.findFirst({
    where: { id: courseId, userId, ...courseAccessWhere(await programAccess(userId)) },
    select: { id: true, title: true, bookId: true, status: true, book: { select: { status: true, kind: true } } },
  });
  if (!course) throw new NotFoundError("Course not found");
  return course;
}

export async function listThreads(userId: string, courseId: string) {
  await ownedCourse(userId, courseId);
  return db.tutorThread.findMany({
    where: { userId, courseId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, title: true, updatedAt: true, lessonId: true, lesson: { select: { title: true } } },
  });
}

export async function getThread(userId: string, threadId: string) {
  const thread = await db.tutorThread.findFirst({
    where: { id: threadId, userId },
    select: {
      id: true,
      title: true,
      courseId: true,
      lessonId: true,
      lesson: { select: { title: true } },
      messages: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true, status: true, sources: true, citedPages: true, notInBook: true, error: true } },
    },
  });
  if (!thread) throw new NotFoundError("Conversation not found");
  return thread;
}

export async function deleteThread(userId: string, threadId: string) {
  const res = await db.tutorThread.deleteMany({ where: { id: threadId, userId } });
  if (res.count === 0) throw new NotFoundError("Conversation not found");
}

/** Is the book ready for the tutor? (Embeddings are optional: keyword search works without them.) */
export async function tutorStatus(userId: string, courseId: string) {
  const course = await ownedCourse(userId, courseId);
  const [chunks, progress] = await Promise.all([db.chunk.count({ where: { bookId: course.bookId } }), embeddingProgress(course.bookId)]);
  return { ready: course.book.status === "READY" && chunks > 0, meaningSearch: progress };
}

/** SAT prep courses get the program's SAT curriculum in the tutor (by title, Hub course or class program). */
async function isSatCourse(courseId: string) {
  const c = await db.course.findUnique({
    where: { id: courseId },
    select: { title: true, catalogEntry: { select: { title: true } }, classCourse: { select: { class: { select: { program: { select: { subject: true } } } } } } },
  });
  return c ? looksLikeSat({ title: c.title, catalogTitle: c.catalogEntry?.title, programSubject: c.classCourse?.class.program?.subject }) : false;
}

export type AskInput = { courseId: string; threadId?: string | null; lessonId?: string | null; question: unknown };
export type AskDeps = { tutor: TutorModel | null; embedder: QueryEmbedder };

export async function askTutor(userId: string, input: AskInput, deps: AskDeps, emit: (e: TutorEvent) => void, signal: AbortSignal) {
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) throw new TutorError("Type a question first.");
  if (question.length > MAX_QUESTION_CHARS) throw new TutorError(`Please keep questions under ${MAX_QUESTION_CHARS.toLocaleString("en-US")} characters.`);

  const course = await ownedCourse(userId, input.courseId);
  if (course.book.status !== "READY") throw new TutorError("The book is still being read. The tutor will be ready when processing finishes.", 409);
  if (!deps.tutor) throw new TutorError("The tutor isn't set up on this server yet (no Claude API key).", 503);

  // An existing conversation (must be in this course), or a new one, optionally about a lesson.
  let thread = input.threadId
    ? await db.tutorThread.findFirst({ where: { id: input.threadId, userId, courseId: course.id }, select: { id: true, title: true, lessonId: true } })
    : null;
  if (input.threadId && !thread) throw new NotFoundError("Conversation not found");
  const lessonId = thread ? thread.lessonId : input.lessonId ? ((await db.lesson.findFirst({ where: { id: input.lessonId, courseId: course.id }, select: { id: true } }))?.id ?? null) : null;

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.tutorMessage.count({ where: { role: "USER", createdAt: { gte: since }, thread: { userId } } });
  if (recent >= env.TUTOR_PER_HOUR) {
    throw new TutorError(`You've asked ${env.TUTOR_PER_HOUR} questions in the last hour, the hourly limit. Please try again a bit later.`, 429);
  }
  try {
    await assertAiBudget(userId);
  } catch (err) {
    if (err instanceof LimitError) throw new TutorError(err.message, 429);
    throw err;
  }

  const [lesson, history] = await Promise.all([
    lessonId ? db.lesson.findUnique({ where: { id: lessonId }, select: { title: true, pageStart: true, pageEnd: true } }) : null,
    thread
      ? db.tutorMessage.findMany({ where: { threadId: thread.id, status: { in: ["DONE", "STOPPED"] } }, orderBy: { createdAt: "desc" }, take: 6, select: { role: true, content: true } })
      : [],
  ]);

  const found = await retrievePassages({ bookId: course.bookId, question, focus: lesson, embedder: deps.embedder });
  const sources: Source[] = found.passages.map((p) => ({ chunkId: p.id, pageStart: p.pageStart, pageEnd: p.pageEnd }));

  thread ??= await db.tutorThread.create({ data: { userId, courseId: course.id, lessonId, title: threadTitle(question) }, select: { id: true, title: true, lessonId: true } });
  await db.tutorMessage.create({ data: { threadId: thread.id, role: "USER", content: question } });
  const reply = await db.tutorMessage.create({
    data: { threadId: thread.id, role: "ASSISTANT", content: "", status: "STREAMING", sources: sources as unknown as Prisma.InputJsonValue },
  });
  emit({ type: "meta", threadId: thread.id, threadTitle: thread.title, messageId: reply.id, sources, confidence: found.confidence, mode: found.mode });

  const turns: TutorTurn[] = history.reverse().map((m) => ({ role: m.role === "USER" ? "user" : "assistant", content: m.content }));
  const messages = tutorMessages({ history: turns, passages: found.passages, question, context: { courseTitle: course.title, lessonTitle: lesson?.title, slides: course.book.kind === "SLIDES" } });
  const usageCtx = { userId, courseId: course.id, lessonId, feature: "TUTOR" as const };

  try {
    const answer = await deps.tutor.answer(messages, (text) => emit({ type: "delta", text }), signal, { sat: await isSatCourse(course.id) });
    await recordUsage(usageCtx, answer.calls);
    const checked = checkCitations(answer.text, pagesCovered(found.passages));
    const content = answer.stop === "too_long" ? `${checked.text}\n\n_(The answer was cut short. Ask a narrower question for the rest.)_` : checked.text;
    const status = answer.stop === "stopped" ? "STOPPED" : "DONE";
    const notInBook = saysNotInBook(content);
    await db.$transaction([
      db.tutorMessage.update({ where: { id: reply.id }, data: { content, status, citedPages: checked.pages, notInBook } }),
      db.tutorThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } }),
    ]);
    emit({ type: "done", content, citedPages: checked.pages, notInBook, status });
  } catch (err) {
    const message = err instanceof AiError ? err.userMessage : "Something went wrong. Please try again.";
    if (err instanceof AiError) await recordUsage(usageCtx, err.calls);
    else console.error(err);
    await db.tutorMessage.update({ where: { id: reply.id }, data: { status: "ERROR", error: message } });
    emit({ type: "error", message });
  }
}
