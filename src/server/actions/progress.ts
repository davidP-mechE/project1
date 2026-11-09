"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError } from "../courses";
import { recordStudyMinute } from "../activity";
import { deletePlan, PlanError, savePlan } from "../plan";
import { PreferencesError, savePreferences } from "../preferences";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof PlanError || err instanceof PreferencesError) return { ok: false, error: err.message };
  if (err instanceof NotFoundError) return { ok: false, error: "That course no longer exists." };
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Sent once a minute while a study page is open and being used. */
export async function studyHeartbeatAction(): Promise<void> {
  const user = await requireUser();
  await recordStudyMinute(user.id);
}

export async function savePlanAction(
  courseId: string,
  input: { targetDate: string; studyDays: number[]; minutesPerDay: number },
): Promise<Result<{ fits: boolean; finishDay: string | null; neededMinutesPerDay: number | null; lessons: number }>> {
  const user = await requireUser();
  try {
    const res = await savePlan(user.id, id.parse(courseId), input ?? {});
    revalidatePath(`/courses/${courseId}/plan`);
    return { ok: true, ...res };
  } catch (err) {
    return fail(err);
  }
}

export async function deletePlanAction(courseId: string): Promise<Result> {
  const user = await requireUser();
  try {
    await deletePlan(user.id, id.parse(courseId));
    revalidatePath(`/courses/${courseId}/plan`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function savePreferencesAction(input: {
  dailyGoalMinutes: number;
  newCardsPerDay: number;
  reminderEmails: boolean;
  reminderHour: number;
  timezone: string;
}): Promise<Result> {
  const user = await requireUser();
  try {
    await savePreferences(user.id, input ?? {});
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
