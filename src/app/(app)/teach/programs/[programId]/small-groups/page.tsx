import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { SmallGroupCard } from "@/components/practice-tools/small-groups";
import { NotFoundError } from "@/server/courses";
import { ClassError } from "@/server/access";
import { programSmallGroups } from "@/server/small-groups";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Small groups" };

/** The program admin's view: small groups across every class. */
export default async function ProgramSmallGroupsPage({ params }: PageProps<"/teach/programs/[programId]/small-groups">) {
  const user = await requireUser();
  const { programId } = await params;
  let g;
  try {
    g = await programSmallGroups(user.id, programId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    if (err instanceof ClassError) return <PageHeader title="Small groups" description={err.message} />;
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <p className="text-sm">
        <Link href={`/teach/programs/${programId}`} className="text-muted hover:text-text hover:underline">← {g.program.name}</Link>
      </p>
      <PageHeader title="Small groups across the program" description="Every student grouped by their weakest skill, across all classes. Messages and sets go out class by class. To run a session for a group, open it from its class (sessions belong to one class)." />
      {g.groups.length === 0 ? (
        <EmptyState title="No groups to suggest yet">Groups appear once students have practised enough to show a weak skill.</EmptyState>
      ) : (
        g.groups.map((x) => <SmallGroupCard key={x.skillId} group={x} canTeach canSession showClass />)
      )}
    </div>
  );
}
