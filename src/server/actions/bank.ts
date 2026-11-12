"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import * as bank from "../bank";

/** Server Actions for the question bank and practice player. Every function they call checks the role on the server. */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);

async function run<T extends object>(fn: (userId: string) => Promise<T | void>, paths: string[] = []): Promise<Result<T>> {
  const user = await requireUser();
  try {
    const out = (await fn(user.id)) ?? ({} as T);
    for (const p of paths) revalidatePath(p);
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof bank.BankError) return { ok: false, error: err.message };
    if (err instanceof NotFoundError) return { ok: false, error: "That no longer exists, or you don't have access to it." };
    if (err instanceof z.ZodError) return { ok: false, error: "Please check the form." };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

const record = z.record(z.string(), z.unknown());

export async function saveQuestionAction(questionId: string | null, input: unknown, mode: "draft" | "publish" | "keep") {
  const data = record.parse(input);
  return run(async (u) => {
    const q = questionId ? await bank.updateQuestion(u, id.parse(questionId), data, { publish: mode === "publish", unpublish: mode === "draft" }) : await bank.createQuestion(u, data, { publish: mode === "publish" });
    return { questionId: q.id, version: q.version, status: q.status };
  }, ["/bank"]);
}

export async function setQuestionStatusAction(questionId: string, status: string) {
  return run((u) => bank.setQuestionStatus(u, id.parse(questionId), z.enum(["draft", "published"]).parse(status)).then(() => undefined), ["/bank"]);
}

export async function deleteQuestionAction(questionId: string) {
  return run((u) => bank.deleteQuestion(u, id.parse(questionId)), ["/bank"]);
}

export async function saveQuestionDesmosAction(questionId: string, state: unknown, technique?: string | null) {
  const s = state === null ? null : z.record(z.string(), z.unknown()).parse(state);
  if (JSON.stringify(s ?? {}).length > 200_000) return { ok: false as const, error: "That graph is too large to save." };
  return run(async (u) => {
    const q = await bank.setQuestionDesmos(u, id.parse(questionId), s, technique === undefined ? undefined : technique ? z.string().max(40).parse(technique) : null);
    return { version: q.version };
  }, [`/bank/${questionId}`]);
}

export async function importQuestionsAction(text: string, format: string, commit: boolean) {
  const t = z.string().max(5_000_000).parse(text);
  const f = z.enum(["csv", "json"]).parse(format);
  return run(async (u) => {
    const r = await bank.importQuestions(u, t, f, { commit });
    // Rows go back without the parsed data (the preview only needs status and messages).
    return { report: { ...r, rows: r.rows.map(({ data, ...rest }) => ({ ...rest, stem: data?.stem.slice(0, 120) ?? null })) } };
  }, ["/bank"]);
}

const setInput = z.object({
  title: z.string().max(200),
  description: z.string().max(2000).nullable().optional(),
  questionIds: z.array(id).max(200),
  visibility: z.enum(["private", "class", "public"]).optional(),
  timeLimitMin: z.number().int().nullable().optional(),
});

export async function createSetAction(input: unknown) {
  const s = setInput.parse(input);
  return run(async (u) => ({ setId: (await bank.createSet(u, s)).id }), ["/bank/sets"]);
}
export async function updateSetAction(setId: string, input: unknown) {
  const s = setInput.parse(input);
  return run((u) => bank.updateSet(u, id.parse(setId), s).then(() => undefined), ["/bank/sets", `/bank/sets/${setId}`]);
}
export async function setSetStatusAction(setId: string, status: string, withQuestions = false) {
  return run((u) => bank.setSetStatus(u, id.parse(setId), z.enum(["draft", "published"]).parse(status), { withQuestions }).then(() => undefined), ["/bank/sets", `/bank/sets/${setId}`, "/practice"]);
}
export async function deleteSetAction(setId: string) {
  return run((u) => bank.deleteSet(u, id.parse(setId)), ["/bank/sets"]);
}
export async function autoSetAction(input: unknown) {
  const p = z
    .object({ title: z.string().max(200).optional(), count: z.number().int(), skillId: id.nullable().optional(), section: z.string().max(10).nullable().optional(), difficultyMin: z.number().int().optional(), difficultyMax: z.number().int().optional(), type: z.string().max(10).nullable().optional(), publishedOnly: z.boolean().optional() })
    .parse(input);
  return run(async (u) => {
    const r = await bank.autoGenerateSet(u, p);
    return { setId: r.set.id, picked: r.set.questionIds.length, found: r.found };
  }, ["/bank/sets"]);
}

export async function startPracticeAction(setId: string, opts: { assignmentId?: string | null; timed?: boolean } = {}) {
  return run(async (u) => bank.startPractice(u, id.parse(setId), { assignmentId: opts.assignmentId ? id.parse(opts.assignmentId) : null, timed: Boolean(opts.timed) }));
}
export async function answerPracticeAction(sessionId: string, questionId: string, answer: string, timeSeconds: number) {
  return run(async (u) => ({ feedback: await bank.answerPractice(u, id.parse(sessionId), id.parse(questionId), z.string().max(40).parse(answer), z.number().parse(timeSeconds)) }));
}
export async function finishPracticeAction(sessionId: string) {
  return run(async (u) => ({ result: await bank.finishPractice(u, id.parse(sessionId)) }), ["/classes", "/practice"]);
}

export async function findQuestionsAction(refs: string) {
  const list = z.string().max(20_000).parse(refs).split(/[\s,]+/);
  return run(async (u) => bank.findQuestions(u, list));
}
