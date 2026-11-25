"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import * as ai from "../academic-index";

/** Server Actions for the Academic Index. The functions they call check ownership. */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);
const PATHS = ["/academic-index", "/academic-index/inputs", "/academic-index/import"];

async function run<T extends object>(fn: (userId: string) => Promise<T | void>, paths: string[] = PATHS): Promise<Result<T>> {
  const user = await requireUser();
  try {
    const out = (await fn(user.id)) ?? ({} as T);
    for (const p of paths) revalidatePath(p);
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof ai.AcademicIndexError) return { ok: false, error: err.message };
    if (err instanceof NotFoundError) return { ok: false, error: "That no longer exists." };
    if (err instanceof z.ZodError) return { ok: false, error: "Please check the form." };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

const draft = z.object({ inputs: z.unknown(), sources: z.unknown(), keepEssays: z.boolean() });

export async function ageCheckAction(birthDate: string) {
  const d = z.string().max(10).parse(birthDate);
  return run(async (u) => void (await ai.submitAgeCheck(u, d)));
}

export async function saveDraftAction(input: { inputs: unknown; sources: unknown; keepEssays: boolean }) {
  const d = draft.parse(input);
  return run(async (u) => ({ needed: (await ai.saveDraft(u, d)).needed }));
}

export async function confirmReviewAction(input: { inputs: unknown; sources: unknown; keepEssays: boolean; ticked: string[] }) {
  const d = draft.extend({ ticked: z.array(z.string().max(80)).max(500) }).parse(input);
  return run((u) => ai.confirmReview(u, d));
}

export async function scoreAction(input: { inputs: unknown; sources: unknown; keepEssays: boolean }) {
  const d = draft.parse(input);
  return run((u) => ai.scoreAcademicIndex(u, d));
}

export async function applyExtractionsAction() {
  return run((u) => ai.applyExtractions(u));
}

export async function removeUploadAction(uploadId: string) {
  return run((u) => ai.removeUpload(u, id.parse(uploadId)));
}

export async function setSharesAction(classIds: string[]) {
  const ids = z.array(id).max(50).parse(classIds);
  return run((u) => ai.setShares(u, ids));
}

export async function deleteResultAction(resultId: string) {
  return run((u) => ai.deleteResult(u, id.parse(resultId)));
}
