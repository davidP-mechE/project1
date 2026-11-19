import "server-only";
import { db } from "./db";
import { NotFoundError } from "./courses";
import { classAccess, ClassError, studentIdsInScope } from "./access";
import { cleanTargets, studentsTargeted } from "./targets";
import { bulkMessage, MAX_MESSAGE_CHARS } from "./messages";
import { createAnnouncement } from "./announcements";
import { notify } from "./notifications";
import { dequeueScheduledSend, enqueueScheduledSend } from "./queue";
import { fillPlaceholders } from "@/lib/messaging/placeholders";

/**
 * Scheduled messages and announcements. Staff write them now and pick a time;
 * the worker sends them then (a delayed queue job, plus a sweep every 15
 * minutes as a fallback), so the request never waits on email. Until they go,
 * the author can edit or cancel them. When one sends, the author's access is
 * checked again: students who left their scope since are skipped. The author
 * gets a notice when it's sent, or if it failed.
 */

export type ScheduleInput = {
  classId: string;
  kind: "MESSAGE" | "ANNOUNCEMENT";
  /** MESSAGE: who it's for (empty both = everyone in the author's scope). */
  studentIds?: string[];
  groupIds?: string[];
  /** ANNOUNCEMENT */
  title?: string;
  groupId?: string | null;
  pinned?: boolean;
  body: string;
  sendAt: string | Date;
};

const MIN_AHEAD_MS = 60_000;
const MAX_AHEAD_DAYS = 90;
const MAX_PENDING = 50;

function checkTime(sendAt: Date, now: Date) {
  if (Number.isNaN(sendAt.getTime())) throw new ClassError("Choose a date and time to send it.");
  if (sendAt.getTime() < now.getTime() + MIN_AHEAD_MS) throw new ClassError("Choose a time at least a minute from now (or send it now instead).");
  if (sendAt.getTime() > now.getTime() + MAX_AHEAD_DAYS * 86_400_000) throw new ClassError(`You can schedule up to ${MAX_AHEAD_DAYS} days ahead.`);
}

function checkBody(body: string, title: string | undefined, kind: ScheduleInput["kind"]) {
  const b = body.trim();
  if (!b) throw new ClassError("Write the message first.");
  if (b.length > MAX_MESSAGE_CHARS) throw new ClassError(`Messages can be up to ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters.`);
  const t = (title ?? "").trim();
  if (kind === "ANNOUNCEMENT" && !t) throw new ClassError("Give the announcement a title.");
  if (t.length > 120) throw new ClassError("Titles can be up to 120 characters.");
  return { body: b, title: kind === "ANNOUNCEMENT" ? t : null };
}

/** Who a scheduled item is for, checked against the author's scope now. */
async function checkAudience(userId: string, input: Pick<ScheduleInput, "classId" | "kind" | "studentIds" | "groupIds" | "groupId">) {
  const access = await classAccess(userId, input.classId, "teach");
  if (input.kind === "ANNOUNCEMENT") {
    const groupId = input.groupId || null;
    if (groupId && !(await db.classGroup.count({ where: { id: groupId, classId: input.classId } }))) throw new ClassError("That group isn't in this class.");
    if (access.groupIds.length && (!groupId || !access.groupIds.includes(groupId))) throw new ClassError("You can only post to your own groups.", 403);
    return { access, groupId, groupIds: [] as string[], studentIds: [] as string[] };
  }
  const targets = await cleanTargets(access, { groupIds: input.groupIds ?? [], studentIds: input.studentIds ?? [] });
  const reach = await studentsTargeted({ ...targets, classId: input.classId }, await studentIdsInScope(access));
  if (!reach.size) throw new ClassError("No students match. Choose a group or students in your scope.");
  return { access, groupId: null, ...targets };
}

export async function scheduleSend(userId: string, input: ScheduleInput, now = new Date()) {
  const sendAt = new Date(input.sendAt);
  checkTime(sendAt, now);
  const text = checkBody(input.body, input.title, input.kind);
  const audience = await checkAudience(userId, input);
  const c = await db.class.findUniqueOrThrow({ where: { id: input.classId }, select: { archivedAt: true } });
  if (c.archivedAt) throw new ClassError("This class is archived.");
  if ((await db.scheduledSend.count({ where: { authorId: userId, status: "PENDING" } })) >= MAX_PENDING) throw new ClassError(`You can have up to ${MAX_PENDING} scheduled sends waiting.`);
  const row = await db.scheduledSend.create({
    data: { authorId: userId, classId: input.classId, kind: input.kind, studentIds: audience.studentIds, groupIds: audience.groupIds, groupId: audience.groupId, title: text.title, pinned: Boolean(input.pinned), body: text.body, sendAt },
  });
  await enqueueScheduledSend(row.id, sendAt, now);
  return row;
}

async function mine(userId: string, id: string) {
  const r = await db.scheduledSend.findUnique({ where: { id } });
  if (!r || r.authorId !== userId) throw new NotFoundError("Not found");
  return r;
}

/** Change the text, title or time of a scheduled item that hasn't gone yet. */
export async function updateScheduled(userId: string, id: string, patch: { body?: string; title?: string; sendAt?: string | Date; pinned?: boolean }, now = new Date()) {
  const r = await mine(userId, id);
  if (r.status !== "PENDING") throw new ClassError("That one has already been sent or cancelled.");
  const sendAt = patch.sendAt !== undefined ? new Date(patch.sendAt) : r.sendAt;
  if (patch.sendAt !== undefined) checkTime(sendAt, now);
  const text = checkBody(patch.body ?? r.body, patch.title ?? r.title ?? undefined, r.kind as ScheduleInput["kind"]);
  // Only while still pending: a send that started in the meantime isn't changed underneath it.
  const done = await db.scheduledSend.updateMany({ where: { id, status: "PENDING" }, data: { body: text.body, title: text.title, sendAt, pinned: patch.pinned ?? r.pinned } });
  if (!done.count) throw new ClassError("That one has already been sent or cancelled.");
  await enqueueScheduledSend(id, sendAt, now);
}

export async function cancelScheduled(userId: string, id: string) {
  await mine(userId, id);
  const done = await db.scheduledSend.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (!done.count) throw new ClassError("That one has already been sent or cancelled.");
  await dequeueScheduledSend(id);
}

/** The author's waiting items, and what was sent or failed in the last 30 days. */
export async function listScheduled(userId: string, opts: { classId?: string } = {}, now = new Date()) {
  return db.scheduledSend.findMany({
    where: { authorId: userId, ...(opts.classId ? { classId: opts.classId } : {}), OR: [{ status: { in: ["PENDING", "SENDING"] } }, { updatedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }] },
    orderBy: [{ status: "desc" }, { sendAt: "asc" }],
    take: 100,
    include: { class: { select: { name: true } } },
  });
}

/**
 * In the worker: send one scheduled item if it's due and still pending. The
 * claim (PENDING → SENDING) makes it go once even if the queue job and the
 * sweep both pick it up.
 */
export async function runScheduledSend(id: string, now = new Date()) {
  const claimed = await db.scheduledSend.updateMany({ where: { id, status: "PENDING", sendAt: { lte: new Date(now.getTime() + 5_000) } }, data: { status: "SENDING" } });
  if (!claimed.count) return "skipped" as const;
  const r = await db.scheduledSend.findUniqueOrThrow({ where: { id }, include: { class: { select: { name: true } } } });
  try {
    let reached = 0;
    if (r.kind === "ANNOUNCEMENT") {
      // One post for many readers: {class} is filled in; {first_name} and {due_date} can't be per student.
      const body = fillPlaceholders(r.body, { firstName: "everyone", className: r.class.name, dueDate: null });
      await createAnnouncement(r.authorId, r.classId, { groupId: r.groupId, title: r.title ?? "Announcement", body, pinned: r.pinned }, now);
      reached = r.groupId ? await db.classGroupMember.count({ where: { groupId: r.groupId } }) : await db.classMember.count({ where: { classId: r.classId } });
    } else {
      reached = (await bulkMessage(r.authorId, r.classId, { groupIds: r.groupIds, studentIds: r.studentIds, body: r.body }, now, { scheduled: true })).sent;
    }
    await db.scheduledSend.update({ where: { id }, data: { status: "SENT", sentAt: now, reached, error: null } });
    await notify([r.authorId], { kind: "scheduled", key: `scheduled:${id}`, title: `Sent: your scheduled ${r.kind === "ANNOUNCEMENT" ? "announcement" : "message"} to ${r.class.name} (${reached} student${reached === 1 ? "" : "s"})`, href: "/messages/scheduled" }, now);
    return "sent" as const;
  } catch (err) {
    const why = err instanceof ClassError || err instanceof NotFoundError ? (err instanceof NotFoundError ? "You no longer have access to this class or these students." : err.message) : "Something went wrong sending it.";
    await db.scheduledSend.update({ where: { id }, data: { status: "FAILED", error: why.slice(0, 300) } });
    await notify([r.authorId], { kind: "scheduled", key: `scheduled:${id}`, title: `Not sent: your scheduled message to ${r.class.name}. ${why}`.slice(0, 200), href: "/messages/scheduled" }, now);
    if (!(err instanceof ClassError || err instanceof NotFoundError)) console.error("[scheduled] send failed:", err);
    return "failed" as const;
  }
}

/** Every 15 minutes from the worker: send anything due that the queue missed. */
export async function sweepScheduledSends(now = new Date()) {
  const due = await db.scheduledSend.findMany({ where: { status: "PENDING", sendAt: { lte: now } }, orderBy: { sendAt: "asc" }, take: 200, select: { id: true } });
  let sent = 0;
  for (const d of due) if ((await runScheduledSend(d.id, now)) === "sent") sent++;
  return sent;
}
