"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import * as tracker from "../tracker";

/** Server Actions for the practice-test tracker. The functions they call check ownership on the server. */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);

async function run<T extends object>(fn: (userId: string) => Promise<T | void>, paths: string[] = []): Promise<Result<T>> {
  const user = await requireUser();
  try {
    const out = (await fn(user.id)) ?? ({} as T);
    for (const p of paths) revalidatePath(p);
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof tracker.TrackerError) return { ok: false, error: err.message };
    if (err instanceof NotFoundError) return { ok: false, error: "That no longer exists, or you don't have access to it." };
    if (err instanceof z.ZodError) return { ok: false, error: "Please check the form." };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

const item = z.object({
  section: z.enum(["rw", "math"]),
  module: z.number().int(),
  questionNumber: z.number().int(),
  result: z.enum(["correct", "wrong", "skipped", "guessed"]),
  skillId: z.string().max(120).nullable().optional(),
  errorTypeId: z.string().max(40).nullable().optional(),
  note: z.string().max(200).nullable().optional(),
});
const patch = z.object({
  dateTaken: z.string().max(40).optional(),
  scoreRw: z.union([z.number(), z.string().max(6), z.null()]).optional(),
  scoreMath: z.union([z.number(), z.string().max(6), z.null()]).optional(),
  total: z.union([z.number(), z.string().max(6), z.null()]).optional(),
  minutesUsed: z.union([z.number(), z.string().max(6), z.null()]).optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(item).max(400).optional(),
});

export async function createTestAction(input: unknown) {
  const p = z.object({ name: z.string().max(120), source: z.string().max(20).optional(), modules: z.unknown() }).parse(input);
  return run(async (u) => ({ testId: (await tracker.createTest(u, p)).id }), ["/practice-tests/new"]);
}
export async function startAttemptAction(testId: string, dateTaken: string) {
  return run(async (u) => ({ attemptId: (await tracker.startAttempt(u, { testId: id.parse(testId), dateTaken: z.string().max(40).parse(dateTaken) })).id }), ["/practice-tests"]);
}
export async function saveAttemptAction(attemptId: string, input: unknown) {
  const p = patch.parse(input);
  return run(async (u) => {
    const a = await tracker.saveAttempt(u, id.parse(attemptId), p);
    return { status: a.status, total: a.total };
  }, ["/practice-tests"]);
}
export async function completeAttemptAction(attemptId: string) {
  return run(async (u) => {
    await tracker.completeAttempt(u, id.parse(attemptId));
  }, ["/practice-tests", "/scores", "/practice-tests/insights"]);
}
export async function deleteAttemptAction(attemptId: string) {
  return run((u) => tracker.deleteAttempt(u, id.parse(attemptId)), ["/practice-tests", "/scores"]);
}

export async function setRedoStatusAction(itemId: string, status: string) {
  const s = z.enum(["to_redo", "redone_correct", "still_wrong"]).parse(status);
  return run(async (u) => {
    const { setRedoStatus } = await import("../insights");
    await setRedoStatus(u, id.parse(itemId), s);
  }, ["/practice-tests/redo"]);
}
