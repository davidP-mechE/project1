/**
 * Notification settings: for each kind of notice, whether it shows in the
 * site's notification center and whether it's also emailed. Stored per user
 * as JSON; anything missing uses these defaults.
 */
export const NOTICE_KINDS = ["messages", "announcements", "alerts", "review"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export type Channel = { site: boolean; email: boolean };
export type NotificationPrefs = Record<NoticeKind, Channel>;

export const NOTICE_LABELS: Record<NoticeKind, { label: string; help: string; staffOnly?: boolean }> = {
  messages: { label: "Messages", help: "A new message from a tutor or student. Emails say who wrote, never what they wrote." },
  announcements: { label: "Announcements", help: "Posts to your class or group." },
  alerts: { label: "Student alerts", help: "Overdue work, dropping scores, absences in your classes.", staffOnly: true },
  review: { label: "Waiting for review", help: "Drafted questions and lessons, and answers that need a grade.", staffOnly: true },
};

export const DEFAULT_PREFS: NotificationPrefs = {
  messages: { site: true, email: true },
  announcements: { site: true, email: false },
  alerts: { site: true, email: false },
  review: { site: true, email: false },
};

/** Read stored JSON safely, filling gaps with defaults. */
export function readPrefs(raw: unknown): NotificationPrefs {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as NotificationPrefs;
  for (const k of NOTICE_KINDS) {
    const v = src[k] && typeof src[k] === "object" ? (src[k] as Record<string, unknown>) : {};
    out[k] = {
      site: typeof v.site === "boolean" ? v.site : DEFAULT_PREFS[k].site,
      email: typeof v.email === "boolean" ? v.email : DEFAULT_PREFS[k].email,
    };
  }
  return out;
}
