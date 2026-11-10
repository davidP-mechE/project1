import Link from "next/link";
import { PillNav } from "@/components/review/filters";
import { PageHeader } from "@/components/ui/misc";

/** Title and tabs shared by a class's teacher pages. */
export function ClassNav({ c, active }: { c: { id: string; name: string; joinCode: string; archivedAt: Date | null }; active: "overview" | "students" | "assign" | "skills" }) {
  const tabs = [
    { id: "overview", label: "Progress", href: `/teach/${c.id}` },
    { id: "assign", label: "Assign lessons", href: `/teach/${c.id}/assign` },
    { id: "skills", label: "Skills", href: `/teach/${c.id}/skills` },
    { id: "students", label: "Students", href: `/teach/${c.id}/students` },
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <Link href="/teach" className="text-muted hover:text-text hover:underline">
          ← My classes
        </Link>
      </p>
      <PageHeader title={c.name} description={c.archivedAt ? "Archived: students can't see it." : `Class code ${c.joinCode}`} />
      <PillNav label="Class pages" items={tabs.map((t) => ({ href: t.href, label: t.label, active: t.id === active }))} />
    </div>
  );
}
