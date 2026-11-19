import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import { SmallGroupCard } from "@/components/practice-tools/small-groups";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { classSmallGroups } from "@/server/small-groups";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Small groups" };

/** Students grouped by their weakest skill, with one-click actions. */
export default async function SmallGroupsPage({ params }: PageProps<"/teach/[classId]/small-groups">) {
  const user = await requireUser();
  const { classId } = await params;
  let c, g;
  try {
    [c, g] = await Promise.all([getClassForTeacher(user.id, classId), classSmallGroups(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <ClassNav c={c} active="small-groups" />
      <Card>
        <h1 className="text-xl font-semibold">Suggested small groups</h1>
        <p className="mt-1 text-sm text-muted">
          Each student in your scope sits in the group for their weakest skill (from the last 60 days of practice, class work, the error log and the mistake log), biggest groups first. A skill counts once a student has 3+ answers on it or missed it on a practice test. Message a group, assign it a set for the skill, or set up a session just for them.
        </p>
      </Card>
      {g.groups.length === 0 ? (
        <EmptyState title="No groups to suggest yet">Groups appear once your students have practised enough to show a weak skill.</EmptyState>
      ) : (
        g.groups.map((x) => <SmallGroupCard key={x.skillId} group={x} canTeach={g.canTeach} canSession={g.canManage} />)
      )}
    </div>
  );
}
