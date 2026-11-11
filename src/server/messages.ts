import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { NotFoundError, RateLimitError } from "./courses";
import { ClassError, classAccess, studentIdsInScope, studentInScope, type ClassAccess } from "./access";
import { cleanTargets, studentsTargeted } from "./targets";
import { markReadByKey, notify } from "./notifications";
import { newMessageMessage } from "./email/templates";
import { audit } from "./programs";

/**
 * Messages between staff and students. Rules (checked here, on every call):
 *
 *   Staff (teacher, specialist, program admin) may message students in their
 *   current scope: a specialist limited to group B reaches group B only.
 *   Viewers can't message.
 *   Students may message their own tutors: their classes' teachers and the
 *   specialists whose groups include them (not other students, not staff
 *   outside their scope).
 *   The program admin can read every thread in the program's classes. Students
 *   are told so on the messages page.
 *
 * A thread is one staff member and one student in one class. If the staff
 * member loses the student from their scope, the thread closes to them, and
 * the student can read it but no longer reply.
 */

export const MAX_MESSAGE_CHARS = 4000;
const PER_10_MIN = 30;
const BULK_PER_HOUR = 6;
const PAGE = 25;

const notFound = () => new NotFoundError("Conversation not found");

/** The staff who may message this student in this class (their tutors), from the database now. */
export async function tutorsOf(studentId: string, classId?: string) {
  const memberships = await db.classMember.findMany({
    where: { userId: studentId, ...(classId ? { classId } : {}), class: { archivedAt: null } },
    select: { classId: true, class: { select: { name: true, staff: { where: { role: { in: ["TEACHER", "SPECIALIST"] } }, select: { userId: true, role: true, groupIds: true, user: { select: { name: true } } } } } } },
  });
  const myGroups = new Set((await db.classGroupMember.findMany({ where: { userId: studentId }, select: { groupId: true } })).map((g) => g.groupId));
  const out: { classId: string; className: string; staffId: string; name: string; role: "TEACHER" | "SPECIALIST" }[] = [];
  for (const m of memberships) {
    for (const s of m.class.staff) {
      if (s.userId === studentId) continue;
      if (s.role === "SPECIALIST" && s.groupIds.length && !s.groupIds.some((g) => myGroups.has(g))) continue;
      out.push({ classId: m.classId, className: m.class.name, staffId: s.userId, name: s.user.name, role: s.role as "TEACHER" | "SPECIALIST" });
    }
  }
  return out;
}

/** Staff side: may this person message this student in this class right now? */
async function staffCanReach(staffId: string, classId: string, studentId: string): Promise<ClassAccess | null> {
  try {
    const a = await classAccess(staffId, classId, "teach");
    return (await studentInScope(a, studentId)) ? a : null;
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ClassError) return null;
    throw err;
  }
}

async function isTutorOf(staffId: string, classId: string, studentId: string) {
  return (await tutorsOf(studentId, classId)).some((t) => t.staffId === staffId);
}

/** Can this pair (still) talk? Either side's view; the program admin counts as staff. */
async function pairOpen(t: { classId: string; studentId: string; staffId: string }) {
  const archived = await db.class.findUnique({ where: { id: t.classId }, select: { archivedAt: true } });
  if (!archived || archived.archivedAt) return false;
  const member = await db.classMember.count({ where: { classId: t.classId, userId: t.studentId } });
  if (!member) return false;
  return Boolean(await staffCanReach(t.staffId, t.classId, t.studentId));
}

/**
 * Open (or reuse) a thread. Staff pass a student; students pass a staff member.
 */
export async function startThread(actorId: string, input: { classId: string; studentId?: string; staffId?: string }) {
  let pair: { classId: string; studentId: string; staffId: string };
  if (input.studentId) {
    if (!(await staffCanReach(actorId, input.classId, input.studentId))) throw new NotFoundError("Student not found");
    pair = { classId: input.classId, studentId: input.studentId, staffId: actorId };
  } else if (input.staffId) {
    if (!(await isTutorOf(input.staffId, input.classId, actorId))) throw new NotFoundError("Tutor not found");
    pair = { classId: input.classId, studentId: actorId, staffId: input.staffId };
  } else {
    throw new ClassError("Choose who to message.");
  }
  const c = await db.class.findUnique({ where: { id: pair.classId }, select: { archivedAt: true } });
  if (c?.archivedAt) throw new ClassError("This class is archived.");
  return db.messageThread.upsert({ where: { classId_studentId_staffId: pair }, create: pair, update: {}, select: { id: true } });
}

type Viewer = { mode: "student" | "staff" | "admin"; canReply: boolean };

/** How this person sees a thread, or "not found". */
async function viewerOf(userId: string, t: { classId: string; studentId: string; staffId: string; class: { program: { adminId: string } } }): Promise<Viewer> {
  if (t.studentId === userId) return { mode: "student", canReply: await pairOpen(t) };
  if (t.staffId === userId) {
    if (!(await staffCanReach(userId, t.classId, t.studentId))) throw notFound();
    return { mode: "staff", canReply: await pairOpen(t) };
  }
  if (t.class.program.adminId === userId) return { mode: "admin", canReply: false };
  throw notFound();
}

const threadSelect = {
  id: true,
  classId: true,
  studentId: true,
  staffId: true,
  lastMessageAt: true,
  class: { select: { name: true, program: { select: { adminId: true } } } },
  student: { select: { name: true } },
  staff: { select: { name: true } },
} as const;

/** One thread's messages (newest page last), marking it read for a participant. */
export async function getThread(userId: string, threadId: string, opts: { before?: string } = {}, now = new Date()) {
  const t = await db.messageThread.findUnique({ where: { id: threadId }, select: threadSelect });
  if (!t) throw notFound();
  const viewer = await viewerOf(userId, t);
  const rows = await db.message.findMany({
    where: { threadId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
    select: { id: true, authorId: true, body: true, createdAt: true },
  });
  if (viewer.mode !== "admin") {
    await db.threadRead.upsert({ where: { threadId_userId: { threadId, userId } }, create: { threadId, userId, lastReadAt: now }, update: { lastReadAt: now } });
    await markReadByKey(userId, `thread:${threadId}`, now);
  }
  return {
    thread: { id: t.id, classId: t.classId, className: t.class.name, studentId: t.studentId, studentName: t.student.name, staffId: t.staffId, staffName: t.staff.name },
    viewer,
    messages: rows.slice(0, PAGE).reverse(),
    older: rows.length > PAGE ? rows[PAGE - 1].id : null,
  };
}

async function checkRate(authorId: string, now: Date, adding = 1) {
  const recent = await db.message.count({ where: { authorId, createdAt: { gte: new Date(now.getTime() - 10 * 60_000) }, bulkId: null } });
  if (recent + adding > PER_10_MIN) throw new RateLimitError("You've sent a lot of messages in the last few minutes. Wait a little and try again.");
}

function cleanBody(body: string) {
  const b = (body ?? "").trim();
  if (!b) throw new ClassError("Write a message first.");
  if (b.length > MAX_MESSAGE_CHARS) throw new ClassError(`Messages can be up to ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters.`);
  return b;
}

async function deliver(threadId: string, authorId: string, recipientId: string, names: { from: string; className: string }, now: Date) {
  await notify(
    [recipientId],
    {
      kind: "messages",
      key: `thread:${threadId}`,
      title: `New message from ${names.from} (${names.className})`,
      href: `/messages/${threadId}`,
      email: (to) => newMessageMessage({ to: to.email, fromName: names.from, className: names.className, url: `${env.APP_URL}/messages/${threadId}`, settingsUrl: `${env.APP_URL}/settings#notifications` }),
    },
    now,
  );
}

/** Reply in a thread. Only its two participants, and only while the pair is still in scope. */
export async function sendMessage(userId: string, threadId: string, body: string, now = new Date()) {
  const t = await db.messageThread.findUnique({ where: { id: threadId }, select: threadSelect });
  if (!t) throw notFound();
  const viewer = await viewerOf(userId, t);
  if (viewer.mode === "admin") throw new ClassError("The program admin can read this conversation but not reply in it.", 403);
  if (!viewer.canReply) throw new ClassError("This conversation is closed: the student or tutor is no longer in this class or group.", 403);
  const text = cleanBody(body);
  await checkRate(userId, now);
  const msg = await db.$transaction(async (tx) => {
    const m = await tx.message.create({ data: { threadId, authorId: userId, body: text, createdAt: now }, select: { id: true } });
    await tx.messageThread.update({ where: { id: threadId }, data: { lastMessageAt: now } });
    await tx.threadRead.upsert({ where: { threadId_userId: { threadId, userId } }, create: { threadId, userId, lastReadAt: now }, update: { lastReadAt: now } });
    return m;
  });
  const from = viewer.mode === "student" ? t.student.name : t.staff.name;
  await deliver(threadId, userId, viewer.mode === "student" ? t.staffId : t.studentId, { from, className: t.class.name }, now);
  return msg;
}

/**
 * One message to many students (the whole class, groups or chosen students),
 * inside the sender's scope. Each student gets it in their own thread, so
 * replies stay private.
 */
export async function bulkMessage(userId: string, classId: string, input: { groupIds?: string[]; studentIds?: string[]; body: string }, now = new Date()) {
  const access = await classAccess(userId, classId, "teach");
  const text = cleanBody(input.body);
  const c = await db.class.findUnique({ where: { id: classId }, select: { archivedAt: true, name: true } });
  if (c?.archivedAt) throw new ClassError("This class is archived.");
  const targets = await cleanTargets(access, { groupIds: input.groupIds, studentIds: input.studentIds });
  const inScope = await studentIdsInScope(access);
  const recipients = [...(await studentsTargeted({ ...targets, classId }, inScope))].filter((id) => id !== userId);
  if (!recipients.length) throw new ClassError("No students match. Choose a group or students in your scope.");
  const recentBulk = await db.message.findMany({ where: { authorId: userId, bulkId: { not: null }, createdAt: { gte: new Date(now.getTime() - 3600_000) } }, distinct: ["bulkId"], select: { bulkId: true } });
  if (recentBulk.length >= BULK_PER_HOUR) throw new RateLimitError(`You can send up to ${BULK_PER_HOUR} group messages an hour.`);
  const bulkId = randomUUID();
  const me = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  const threadIds: string[] = [];
  for (const studentId of recipients) {
    const pair = { classId, studentId, staffId: userId };
    const t = await db.messageThread.upsert({ where: { classId_studentId_staffId: pair }, create: { ...pair, lastMessageAt: now }, update: { lastMessageAt: now }, select: { id: true } });
    await db.message.create({ data: { threadId: t.id, authorId: userId, body: text, bulkId, createdAt: now } });
    await db.threadRead.upsert({ where: { threadId_userId: { threadId: t.id, userId } }, create: { threadId: t.id, userId, lastReadAt: now }, update: { lastReadAt: now } });
    threadIds.push(t.id);
  }
  for (let i = 0; i < recipients.length; i++) await deliver(threadIds[i], userId, recipients[i], { from: me.name, className: c!.name }, now);
  await audit(db, { programId: access.programId, actorId: userId, action: "message.bulk", targetType: "class", targetId: classId, summary: `Message sent to ${recipients.length} student${recipients.length === 1 ? "" : "s"}` });
  return { sent: recipients.length };
}

/**
 * The inbox. "mine": threads I'm in. "program": every thread in programs I
 * run (program admin only). Newest activity first, 25 a page.
 */
export async function listThreads(userId: string, opts: { view?: "mine" | "program"; before?: string } = {}) {
  const view = opts.view ?? "mine";
  let where;
  if (view === "program") {
    const programs = await db.program.findMany({ where: { adminId: userId }, select: { id: true } });
    if (!programs.length) throw new ClassError("Only the program admin can see every conversation.", 403);
    where = { class: { programId: { in: programs.map((p) => p.id) } } };
  } else {
    where = { OR: [{ studentId: userId }, { staffId: userId }] };
  }
  const rows = await db.messageThread.findMany({
    where: { ...where, messages: { some: {} } },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
    select: {
      ...threadSelect,
      reads: { where: { userId }, select: { lastReadAt: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, authorId: true } },
    },
  });
  const page = rows.slice(0, PAGE);
  // Staff only see threads they still have access to.
  const visible = [];
  for (const t of page) {
    if (view === "mine" && t.staffId === userId && !(await staffCanReach(userId, t.classId, t.studentId))) continue;
    visible.push(t);
  }
  return {
    threads: visible.map((t) => ({
      id: t.id,
      className: t.class.name,
      other: view === "program" ? `${t.staff.name} ↔ ${t.student.name}` : t.studentId === userId ? t.staff.name : t.student.name,
      lastMessageAt: t.lastMessageAt,
      preview: (t.messages[0]?.authorId === userId ? "You: " : "") + (t.messages[0]?.body ?? "").slice(0, 120),
      unread: view === "mine" && t.messages[0]?.authorId !== userId && (!t.reads[0] || t.reads[0].lastReadAt < t.lastMessageAt),
    })),
    next: rows.length > PAGE ? rows[PAGE - 1].id : null,
  };
}

/** Who this person can start a conversation with: tutors (students) or students in scope (staff). */
export async function contacts(userId: string) {
  const tutors = await tutorsOf(userId);
  const classes = await db.class.findMany({
    where: { archivedAt: null, OR: [{ program: { adminId: userId } }, { staff: { some: { userId, role: { in: ["TEACHER", "SPECIALIST"] } } } }] },
    select: { id: true, name: true, groups: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  const staffClasses = [];
  for (const c of classes) {
    let a: ClassAccess;
    try {
      a = await classAccess(userId, c.id, "teach");
    } catch {
      continue;
    }
    const ids = await studentIdsInScope(a);
    const students = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    staffClasses.push({ id: c.id, name: c.name, groups: a.groupIds.length ? c.groups.filter((g) => a.groupIds.includes(g.id)) : c.groups, students });
  }
  return { tutors, staffClasses };
}

/** Threads with something unread, for the sidebar. */
export async function unreadThreadCount(userId: string) {
  const rows = await db.messageThread.findMany({
    where: { OR: [{ studentId: userId }, { staffId: userId }], messages: { some: { authorId: { not: userId } } } },
    select: { lastMessageAt: true, reads: { where: { userId }, select: { lastReadAt: true } } },
    take: 200,
  });
  return rows.filter((r) => !r.reads[0] || r.reads[0].lastReadAt < r.lastMessageAt).length;
}
