import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { MarkAllRead, NotificationLink } from "@/components/messages/forms";
import { listNotifications } from "@/server/notifications";
import { requireUser, viewerZone } from "@/server/session";
import { relativeTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Notifications" };

const KIND: Record<string, string> = { MESSAGE: "Message", ANNOUNCEMENT: "Announcement", ALERT: "Alert", REVIEW: "Review" };

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const user = await requireUser();
  const { before } = await searchParams;
  const [{ rows, next }, zone] = await Promise.all([listNotifications(user.id, { before: typeof before === "string" ? before : undefined }), viewerZone()]);
  const unread = rows.some((r) => !r.readAt);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Notifications" description="Messages, announcements, and for staff, alerts and work to review." actions={unread ? <MarkAllRead /> : undefined} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing new" action={<Link href="/settings#notifications" className="text-sm font-medium text-primary underline">Notification settings</Link>}>
          New messages and announcements show up here.
        </EmptyState>
      ) : (
        <Card className="p-2">
          <ul className="divide-y divide-border">
            {rows.map((n) => (
              <li key={n.id}>
                <NotificationLink id={n.id} href={n.href} unread={!n.readAt}>
                  <span className="flex items-start gap-3">
                    <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`} />
                    <span className="flex-1">
                      <span className={`block text-sm ${n.readAt ? "" : "font-semibold"}`}>
                        {n.title}
                        {!n.readAt && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="text-xs text-muted">
                        {KIND[n.kind] ?? "Notice"} · {relativeTime(n.updatedAt, zone)}
                      </span>
                    </span>
                  </span>
                </NotificationLink>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mt-4 flex justify-between text-sm">
        {before ? <Link href="/notifications" className="text-primary underline">Newest</Link> : <span />}
        {next && <Link href={`/notifications?before=${next}`} className="text-primary underline">Older</Link>}
      </div>
      <p className="mt-6 text-xs text-muted">
        Choose what reaches you, and what&apos;s emailed, in <Link href="/settings#notifications" className="underline">Settings → Notifications</Link>.
      </p>
    </div>
  );
}
