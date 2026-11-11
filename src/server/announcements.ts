import "server-only";
import { db } from "./db";
import { env } from "./env";
import { NotFoundError } from "./courses";
import { ClassError, classAccess, type ClassAccess } from "./access";
import { notify } from "./notifications";
import { announcementMessage } from "./email/templates";

/**
 * Announcements to a class or one of its groups. Teachers and the program
 * admin post anywhere in their classes; a specialist limited to groups posts
 * only to those groups; viewers read. Students see their class's posts and
 * their own groups' posts on Today, pinned first.
 */

const MAX_TITLE = 120;
const MAX_BODY = 4000;
const RECENT_DAYS = 30;

function clean(input: { title?: string; body?: string }) {
  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  if (!title) throw new ClassError("Give the announcement a title.");
  if (title.length > MAX_TITLE) throw new ClassError(`Titles can be up to ${MAX_TITLE} characters.`);
  if (!body) throw new ClassError("Write the announcement first.");
  if (body.length > MAX_BODY) throw new ClassError(`Announcements can be up to ${MAX_BODY.toLocaleString("en-US")} characters.`);
  return { title, body };
}

/** Groups this person may post to or read; null = the whole class. */
const visibleGroups = (a: ClassAccess) => (a.groupIds.length ? a.groupIds : null);

export async function createAnnouncement(userId: string, classId: string, input: { groupId?: string | null; title: string; body: string; pinned?: boolean }, now = new Date()) {
  const access = await classAccess(userId, classId, "teach");
  const { title, body } = clean(input);
  const groupId = input.groupId || null;
  if (groupId) {
    const g = await db.classGroup.findFirst({ where: { id: groupId, classId }, select: { id: true } });
    if (!g) throw new ClassError("That group isn't in this class.");
  }
  const mine = visibleGroups(access);
  if (mine && (!groupId || !mine.includes(groupId))) throw new ClassError("You can only post to your own groups.", 403);
  const c = await db.class.findUniqueOrThrow({ where: { id: classId }, select: { name: true, archivedAt: true } });
  if (c.archivedAt) throw new ClassError("This class is archived.");
  const row = await db.announcement.create({ data: { classId, groupId, authorId: userId, title, body, pinned: Boolean(input.pinned), createdAt: now }, select: { id: true } });
  const recipients = groupId
    ? (await db.classGroupMember.findMany({ where: { groupId }, select: { userId: true } })).map((m) => m.userId)
    : (await db.classMember.findMany({ where: { classId }, select: { userId: true } })).map((m) => m.userId);
  await notify(
    recipients.filter((id) => id !== userId),
    {
      kind: "announcements",
      key: `announcement:${row.id}`,
      title: `${c.name}: ${title}`,
      href: "/dashboard#announcements",
      email: (to) => announcementMessage({ to: to.email, className: c.name, title, url: `${env.APP_URL}/dashboard`, settingsUrl: `${env.APP_URL}/settings#notifications` }),
    },
    now,
  );
  return row;
}

/** Edit, pin or delete: the author, or the class's teachers and the program admin. */
async function editable(userId: string, id: string) {
  const a = await db.announcement.findUnique({ where: { id }, select: { id: true, classId: true, groupId: true, authorId: true } });
  if (!a) throw new NotFoundError("Announcement not found");
  let access: ClassAccess;
  try {
    access = await classAccess(userId, a.classId, "teach");
  } catch (err) {
    if (err instanceof NotFoundError) throw new NotFoundError("Announcement not found");
    throw err;
  }
  const mine = visibleGroups(access);
  if (mine && (!a.groupId || !mine.includes(a.groupId))) throw new NotFoundError("Announcement not found");
  if (a.authorId !== userId && access.role !== "TEACHER" && access.role !== "ADMIN") throw new ClassError("Only the author or a teacher can change this announcement.", 403);
  return a;
}

export async function updateAnnouncement(userId: string, id: string, patch: { title?: string; body?: string; pinned?: boolean }) {
  const a = await editable(userId, id);
  const current = await db.announcement.findUniqueOrThrow({ where: { id: a.id }, select: { title: true, body: true } });
  const text = patch.title !== undefined || patch.body !== undefined ? clean({ title: patch.title ?? current.title, body: patch.body ?? current.body }) : {};
  return db.announcement.update({ where: { id: a.id }, data: { ...text, ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}) }, select: { id: true } });
}

export async function deleteAnnouncement(userId: string, id: string) {
  const a = await editable(userId, id);
  await db.announcement.delete({ where: { id: a.id } });
  await db.notification.deleteMany({ where: { key: `announcement:${a.id}` } });
}

/** A class's announcements as staff see them (a group-limited specialist sees class-wide posts and their groups'). */
export async function classAnnouncements(userId: string, classId: string) {
  const access = await classAccess(userId, classId, "view");
  const mine = visibleGroups(access);
  const rows = await db.announcement.findMany({
    where: { classId, ...(mine ? { OR: [{ groupId: null }, { groupId: { in: mine } }] } : {}) },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: { id: true, title: true, body: true, pinned: true, createdAt: true, updatedAt: true, authorId: true, author: { select: { name: true } }, group: { select: { id: true, name: true } } },
  });
  const groups = await db.classGroup.findMany({ where: { classId, ...(mine ? { id: { in: mine } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const canPost = access.role !== "VIEWER";
  const canEditAll = access.role === "TEACHER" || access.role === "ADMIN";
  return { access, groups, canPost, rows: rows.map((r) => ({ ...r, canEdit: canPost && (canEditAll || r.authorId === userId) })) };
}

/** What a student sees on Today: pinned posts, then the last 30 days', from their classes and groups. */
export async function studentAnnouncements(userId: string, now = new Date()) {
  const memberships = await db.classMember.findMany({ where: { userId, class: { archivedAt: null } }, select: { classId: true } });
  if (!memberships.length) return [];
  const groups = (await db.classGroupMember.findMany({ where: { userId }, select: { groupId: true } })).map((g) => g.groupId);
  return db.announcement.findMany({
    where: {
      classId: { in: memberships.map((m) => m.classId) },
      OR: [{ groupId: null }, { groupId: { in: groups } }],
      AND: [{ OR: [{ pinned: true }, { createdAt: { gte: new Date(now.getTime() - RECENT_DAYS * 86_400_000) } }] }],
    },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 8,
    select: { id: true, title: true, body: true, pinned: true, createdAt: true, class: { select: { name: true } }, group: { select: { name: true } }, author: { select: { name: true } } },
  });
}
