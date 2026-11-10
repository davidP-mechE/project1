import "server-only";
import { db } from "./db";
import { sendEmail, type EmailMessage } from "./email";
import { readPrefs, NOTICE_KINDS, type NoticeKind, type NotificationPrefs } from "@/lib/notification-prefs";
import { classAlerts } from "./cohort";
import { aiGradesToReview } from "./grade-review";

/**
 * The notification center (the bell in the sidebar) and notification emails.
 * Each person chooses per kind whether a notice shows in the site, is emailed,
 * both or neither (Settings → Notifications). Rows are keyed so a repeat
 * (another message in the same thread) refreshes the existing row.
 *
 * Titles and emails name who and where ("New message from Ms. Lee in SAT
 * Prep"), never the content: the content stays behind the login.
 */

const KIND_DB: Record<NoticeKind, string> = { messages: "MESSAGE", announcements: "ANNOUNCEMENT", alerts: "ALERT", review: "REVIEW" };
const PAGE = 30;

export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
  return readPrefs(u?.notificationPrefs);
}

export async function saveNotificationPrefs(userId: string, input: unknown): Promise<NotificationPrefs> {
  const prefs = readPrefs(input);
  await db.user.update({ where: { id: userId }, data: { notificationPrefs: prefs } });
  return prefs;
}

async function once(key: string) {
  try {
    await db.sentNotice.create({ data: { key } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Notify people of something. `email` builds the message for one recipient;
 * emails for the same key go at most once an hour per person (so a quick
 * back-and-forth doesn't flood an inbox). Never throws: a failed email is
 * logged and the in-site notice still lands.
 */
export async function notify(
  userIds: string[],
  n: { kind: NoticeKind; key: string; title: string; href: string; email?: (to: { email: string; name: string }) => EmailMessage },
  now = new Date(),
) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return { site: 0, email: 0 };
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, name: true, notificationPrefs: true } });
  let site = 0;
  let email = 0;
  for (const u of users) {
    const p = readPrefs(u.notificationPrefs)[n.kind];
    if (p.site) {
      await db.notification.upsert({
        where: { userId_key: { userId: u.id, key: n.key } },
        create: { userId: u.id, kind: KIND_DB[n.kind], key: n.key, title: n.title, href: n.href },
        update: { title: n.title, href: n.href, readAt: null, updatedAt: now },
      });
      site++;
    }
    if (p.email && n.email && (await once(`notice:${u.id}:${n.key}:${now.toISOString().slice(0, 13)}`))) {
      await sendEmail(n.email({ email: u.email, name: u.name })).catch((err) => console.warn("[notify] email not sent:", err instanceof Error ? err.message : err));
      email++;
    }
  }
  return { site, email };
}

export async function unreadCount(userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}

/** Newest first, 30 a page; `before` is the last row's id from the previous page. */
export async function listNotifications(userId: string, opts: { before?: string } = {}) {
  const rows = await db.notification.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
    select: { id: true, kind: true, title: true, href: true, updatedAt: true, readAt: true },
  });
  return { rows: rows.slice(0, PAGE), next: rows.length > PAGE ? rows[PAGE - 1].id : null };
}

/** Mark one notification (or all of them) read. Only the owner's rows are touched. */
export async function markNotificationsRead(userId: string, id: string | "all", now = new Date()) {
  const r = await db.notification.updateMany({ where: { userId, readAt: null, ...(id === "all" ? {} : { id }) }, data: { readAt: now } });
  return r.count;
}

export async function markReadByKey(userId: string, key: string, now = new Date()) {
  await db.notification.updateMany({ where: { userId, key, readAt: null }, data: { readAt: now } });
}

/**
 * Hourly: open student alerts and work waiting for review become notices for
 * staff, once a day per class (alerts) or whenever the count changes (review).
 */
export async function refreshStaffNotices(now = new Date()) {
  const staff = await db.user.findMany({ where: { OR: [{ programsAdmin: { some: {} } }, { classStaff: { some: { role: { not: "VIEWER" } } } }] }, select: { id: true, notificationPrefs: true } });
  const day = now.toISOString().slice(0, 10);
  let made = 0;
  for (const u of staff) {
    const prefs = readPrefs(u.notificationPrefs);
    if (!prefs.alerts.site && !prefs.review.site) continue;
    const classes = await db.class.findMany({ where: { archivedAt: null, OR: [{ program: { adminId: u.id } }, { staff: { some: { userId: u.id, role: { not: "VIEWER" } } } }] }, select: { id: true, name: true } });
    let toReview = 0;
    for (const c of classes) {
      if (prefs.alerts.site) {
        const a = await classAlerts(u.id, c.id, now).catch(() => null);
        if (a && a.alerts.length) {
          const students = new Set(a.alerts.map((x) => x.studentId)).size;
          const r = await notify([u.id], { kind: "alerts", key: `alerts:${c.id}:${day}`, title: `${students} student${students === 1 ? "" : "s"} in ${c.name} may need attention`, href: `/teach/${c.id}/alerts` }, now);
          made += r.site;
        }
      }
      if (prefs.review.site) toReview += (await aiGradesToReview(u.id, c.id).catch(() => null))?.answers.length ?? 0;
    }
    if (prefs.review.site) {
      const classIds = classes.map((c) => c.id);
      const [items, lessons] = await Promise.all([
        db.worksheetItem.count({ where: { approvedAt: null, archivedAt: null, worksheet: { ownerId: u.id, source: "AI_DRAFT" } } }),
        db.draftLesson.count({ where: { classId: { in: classIds }, approvedAt: null } }),
      ]);
      const total = toReview + items + lessons;
      const title = `${total} item${total === 1 ? "" : "s"} waiting for your review`;
      const existing = await db.notification.findUnique({ where: { userId_key: { userId: u.id, key: "review" } }, select: { title: true } });
      if (total > 0 && existing?.title !== title) {
        // Only when the count changes, so it doesn't turn unread every hour.
        const r = await notify([u.id], { kind: "review", key: "review", title, href: "/teach/review" }, now);
        made += r.site;
      } else if (total === 0 && existing) {
        await db.notification.deleteMany({ where: { userId: u.id, key: "review" } });
      }
    }
  }
  return made;
}

export { NOTICE_KINDS };
