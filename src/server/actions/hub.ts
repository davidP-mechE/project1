"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { requireAdmin } from "../admin";
import { NotFoundError } from "../courses";
import { CatalogError, enroll, publishCourse, setPublished } from "../catalog";
import { setCourseSubject } from "../subjects";
import { SUBJECT_IDS } from "@/lib/subjects";

type Result = { ok: true; message?: string } | { ok: false; error: string };
const id = z.string().min(1).max(64);

/** Add a provided course to my library, then open it. */
export async function enrollAction(entryId: string) {
  const user = await requireUser();
  let courseId: string;
  try {
    courseId = await enroll(user.id, id.parse(entryId));
  } catch (err) {
    if (err instanceof NotFoundError) redirect("/hub?error=unavailable");
    throw err;
  }
  revalidatePath("/hub");
  redirect(`/courses/${courseId}`);
}

export async function setSubjectAction(courseId: string, subject: string): Promise<Result> {
  const user = await requireUser();
  try {
    await setCourseSubject(user.id, id.parse(courseId), subject);
    revalidatePath("/mastery");
    return { ok: true };
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, error: "That course no longer exists." };
    return { ok: false, error: "Couldn't change the subject." };
  }
}

const publishSchema = z.object({
  description: z.string().max(600),
  subject: z.enum(SUBJECT_IDS as [string, ...string[]]),
  license: z.string().max(80),
  attribution: z.string().max(600),
  sourceUrl: z.union([z.url().max(300), z.literal("")]).optional(),
});

/** Admins: publish a generated course to the Hub (or update its details). */
export async function publishAction(courseId: string, input: unknown): Promise<Result> {
  await requireAdmin();
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the fields: the source link must be a full web address (https://…)." };
  try {
    await publishCourse(id.parse(courseId), { ...parsed.data, subject: parsed.data.subject as (typeof SUBJECT_IDS)[number] });
    revalidatePath("/hub");
    revalidatePath(`/courses/${courseId}`);
    return { ok: true, message: "Published to the Hub." };
  } catch (err) {
    if (err instanceof CatalogError) return { ok: false, error: err.message };
    if (err instanceof NotFoundError) return { ok: false, error: "That course no longer exists." };
    console.error(err);
    return { ok: false, error: "Publishing failed. Please try again." };
  }
}

export async function setPublishedAction(entryId: string, published: boolean): Promise<Result> {
  await requireAdmin();
  await setPublished(id.parse(entryId), Boolean(published));
  revalidatePath("/hub");
  return { ok: true, message: published ? "Back in the Hub." : "Hidden from the Hub. Students who added it keep their copy." };
}
