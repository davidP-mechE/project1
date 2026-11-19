import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ScheduledCard } from "@/components/messages/manage";
import { listScheduled } from "@/server/scheduled";
import { requireUser, viewerZone } from "@/server/session";
import { db } from "@/server/db";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Scheduled sends" };

/** The value a datetime-local input needs, in the viewer's zone. */
function localInput(d: Date, zone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Messages and announcements you scheduled: waiting ones can be edited or cancelled. */
export default async function ScheduledPage() {
  const user = await requireUser();
  const [items, zone] = await Promise.all([listScheduled(user.id), viewerZone()]);
  const groupIds = [...new Set(items.flatMap((i) => [...i.groupIds, ...(i.groupId ? [i.groupId] : [])]))];
  const groups = new Map((await db.classGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } })).map((g) => [g.id, g.name]));
  const audience = (i: (typeof items)[number]) =>
    i.kind === "ANNOUNCEMENT"
      ? i.groupId ? `group “${groups.get(i.groupId) ?? ""}”` : "the whole class"
      : [i.groupIds.length ? `group${i.groupIds.length > 1 ? "s" : ""} ${i.groupIds.map((g) => `“${groups.get(g) ?? ""}”`).join(", ")}` : null, i.studentIds.length ? `${i.studentIds.length} chosen student${i.studentIds.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" and ") || "everyone you teach in the class";
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <p className="text-sm"><Link href="/messages" className="text-muted hover:text-text hover:underline">← Messages</Link></p>
      <PageHeader title="Scheduled sends" description={`Messages and announcements you set to send later. They go out from the server at their time, even if you're offline. Times are in ${zone}.`} />
      {items.length === 0 ? (
        <EmptyState title="Nothing scheduled">Choose &quot;Send later&quot; when writing a message or an announcement.</EmptyState>
      ) : (
        items.map((i) => (
          <ScheduledCard
            key={i.id}
            item={{ id: i.id, kind: i.kind, title: i.title, body: i.body, sendAtLocal: localInput(i.sendAt, zone), sendAtText: formatInZone(i.status === "SENT" && i.sentAt ? i.sentAt : i.sendAt, zone, "full"), status: i.status, className: i.class.name, error: i.error, reached: i.reached, audience: audience(i) }}
          />
        ))
      )}
    </div>
  );
}
