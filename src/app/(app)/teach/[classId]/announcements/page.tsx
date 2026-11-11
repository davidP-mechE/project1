import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import { AnnouncementActions, AnnouncementForm } from "@/components/messages/forms";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { classAnnouncements } from "@/server/announcements";
import { requireUser, viewerZone } from "@/server/session";
import { formatInZone } from "@/lib/dates";

export const metadata: Metadata = { title: "Announcements" };

/** Posts to the whole class or one group; students see them on Today. */
export default async function AnnouncementsPage({ params }: PageProps<"/teach/[classId]/announcements">) {
  const user = await requireUser();
  const { classId } = await params;
  let c, a;
  try {
    [c, a] = await Promise.all([getClassForTeacher(user.id, classId), classAnnouncements(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const zone = await viewerZone();
  const groupOnly = a.access.groupIds.length > 0;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <ClassNav c={c} active="announcements" />
      {a.canPost && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">New announcement</h2>
          <p className="mb-4 text-sm text-muted">{groupOnly ? "You can post to your own groups." : "It shows on students' Today page, pinned posts first."}</p>
          {groupOnly && a.groups.length === 0 ? <p className="text-sm text-muted">You don&apos;t have any groups in this class yet.</p> : <AnnouncementForm classId={classId} groups={a.groups} groupOnly={groupOnly} />}
        </Card>
      )}
      {a.rows.length === 0 ? (
        <EmptyState title="No announcements yet">Posts to the class or a group show up here and on students&apos; Today page.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {a.rows.map((r) => (
            <li key={r.id}>
              <Card className={r.pinned ? "border-accent" : undefined}>
                <p className="eyebrow">
                  {r.pinned && <span className="text-accent-ink">Pinned · </span>}
                  {r.group ? r.group.name : "Whole class"}
                </p>
                <h3 className="mt-1 font-semibold">{r.title}</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{r.body}</p>
                <p className="mt-2 text-xs text-muted">
                  {r.author?.name ?? "Former staff"} · {formatInZone(r.createdAt, zone, "dayTime")}
                  {r.updatedAt.getTime() - r.createdAt.getTime() > 60_000 && " · edited"}
                </p>
                {r.canEdit && <AnnouncementActions classId={classId} id={r.id} pinned={r.pinned} title={r.title} body={r.body} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
