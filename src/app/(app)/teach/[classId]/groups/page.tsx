import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import { GroupEditor } from "@/components/classes/staff-forms";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { listGroups } from "@/server/groups";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Groups" };

/** Groups within the class: for assigning work, and for limiting a specialist (e.g. a student tutor) to some students. */
export default async function GroupsPage({ params }: PageProps<"/teach/[classId]/groups">) {
  const user = await requireUser();
  const { classId } = await params;
  let c, g;
  try {
    [c, g] = await Promise.all([getClassForTeacher(user.id, classId), listGroups(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <ClassNav c={c} active="groups" />
      {g.manage && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">New group</h2>
          <p className="mb-4 text-sm text-muted">Group students by score band, a weak subject or a session time. Students don&apos;t see group names.</p>
          <GroupEditor classId={classId} students={g.students} />
        </Card>
      )}
      {g.groups.length === 0 ? (
        <EmptyState title="No groups yet">{g.manage ? "Make one above." : "Groups you're given will show here."}</EmptyState>
      ) : (
        g.groups.map((group) => (
          <Card key={group.id}>
            {g.manage ? (
              <GroupEditor classId={classId} group={group} students={g.students} />
            ) : (
              <>
                <h2 className="mb-2 text-lg font-semibold">{group.name}</h2>
                <p className="text-sm">{group.members.map((m) => m.name || "Student").join(", ") || "No students yet."}</p>
              </>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
