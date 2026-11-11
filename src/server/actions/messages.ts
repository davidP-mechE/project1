"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../session";
import { NotFoundError, RateLimitError } from "../courses";
import { ClassError } from "../access";
import * as messages from "../messages";
import * as announcements from "../announcements";
import * as notifications from "../notifications";

/** Server Actions for messages, announcements and notifications. The functions they call check role and scope. */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const id = z.string().min(1).max(64);
const ids = z.array(id).max(500).optional();

async function run<T extends object>(fn: (userId: string) => Promise<T | void>, paths: string[] = []): Promise<Result<T>> {
  const user = await requireUser();
  try {
    const out = (await fn(user.id)) ?? ({} as T);
    for (const p of paths) revalidatePath(p);
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof ClassError || err instanceof RateLimitError) return { ok: false, error: err.message };
    if (err instanceof NotFoundError) return { ok: false, error: "That no longer exists, or you don't have access to it." };
    if (err instanceof z.ZodError) return { ok: false, error: "Please check the form." };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function startThreadAction(input: { classId: string; studentId?: string; staffId?: string; body: string }) {
  const p = z.object({ classId: id, studentId: id.optional(), staffId: id.optional(), body: z.string().max(10_000) }).parse(input);
  return run(async (u) => {
    const t = await messages.startThread(u, p);
    await messages.sendMessage(u, t.id, p.body);
    return { threadId: t.id };
  }, ["/messages"]);
}

export async function sendMessageAction(threadId: string, body: string) {
  return run(async (u) => {
    await messages.sendMessage(u, id.parse(threadId), z.string().max(10_000).parse(body));
  }, [`/messages/${threadId}`, "/messages"]);
}

export async function bulkMessageAction(classId: string, input: { groupIds?: string[]; studentIds?: string[]; body: string }) {
  const p = z.object({ groupIds: ids, studentIds: ids, body: z.string().max(10_000) }).parse(input);
  return run(async (u) => messages.bulkMessage(u, id.parse(classId), p), ["/messages"]);
}

export async function createAnnouncementAction(classId: string, input: { groupId?: string | null; title: string; body: string; pinned?: boolean }) {
  const p = z.object({ groupId: id.nullable().optional(), title: z.string().max(500), body: z.string().max(10_000), pinned: z.boolean().optional() }).parse(input);
  return run(async (u) => {
    await announcements.createAnnouncement(u, id.parse(classId), p);
  }, [`/teach/${classId}/announcements`]);
}

export async function updateAnnouncementAction(classId: string, announcementId: string, patch: { title?: string; body?: string; pinned?: boolean }) {
  const p = z.object({ title: z.string().max(500).optional(), body: z.string().max(10_000).optional(), pinned: z.boolean().optional() }).parse(patch);
  return run(async (u) => {
    await announcements.updateAnnouncement(u, id.parse(announcementId), p);
  }, [`/teach/${classId}/announcements`]);
}

export async function deleteAnnouncementAction(classId: string, announcementId: string) {
  return run((u) => announcements.deleteAnnouncement(u, id.parse(announcementId)), [`/teach/${classId}/announcements`]);
}

export async function markNotificationsReadAction(notificationId: string | "all") {
  return run(async (u) => ({ count: await notifications.markNotificationsRead(u, notificationId === "all" ? "all" : id.parse(notificationId)) }), ["/notifications"]);
}

export async function saveNotificationPrefsAction(prefs: unknown) {
  return run(async (u) => {
    await notifications.saveNotificationPrefs(u, prefs);
  }, ["/settings"]);
}

export async function resetCalendarLinkAction() {
  const { resetFeedToken } = await import("../calendar");
  return run(async (u) => ({ token: await resetFeedToken(u) }), ["/calendar"]);
}
