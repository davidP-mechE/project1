import Link from "next/link";
import { PillNav } from "@/components/review/filters";
import { PageHeader } from "@/components/ui/misc";
import { ProgramTag } from "@/components/brand/seal";
import { db } from "@/server/db";

export type ClassTab = "announcements" | "overview" | "students" | "assign" | "skills" | "groups" | "review" | "staff" | "scores" | "attendance" | "alerts" | "curriculum" | "assistant";
type Role = "ADMIN" | "TEACHER" | "SPECIALIST" | "VIEWER";

export const ROLE_LABEL: Record<Role, string> = { ADMIN: "Program admin", TEACHER: "Teacher", SPECIALIST: "Specialist", VIEWER: "Viewer" };

/** Title and tabs shared by a class's staff pages, under the program's name and badge. Tabs follow the person's role (the server checks it again). */
export async function ClassNav({
  c,
  active,
}: {
  c: { id: string; name: string; joinCode: string; archivedAt: Date | null; access?: { role: Role; scope?: { sections: string[]; domains: string[]; groupIds: string[] } } };
  active: ClassTab;
}) {
  const role = c.access?.role ?? "TEACHER";
  const tabs: { id: ClassTab; label: string; href: string; show: boolean }[] = [
    { id: "overview", label: "Progress", href: `/teach/${c.id}`, show: true },
    { id: "assign", label: "Assign", href: `/teach/${c.id}/assign`, show: role !== "VIEWER" },
    { id: "scores", label: "Scores", href: `/teach/${c.id}/scores`, show: true },
    { id: "skills", label: "Skills", href: `/teach/${c.id}/skills`, show: true },
    { id: "review", label: "Review AI grades", href: `/teach/${c.id}/review`, show: role !== "VIEWER" },
    { id: "curriculum", label: "Curriculum", href: `/teach/${c.id}/curriculum`, show: true },
    { id: "assistant", label: "Assistant", href: `/teach/${c.id}/assistant`, show: true },
    { id: "attendance", label: "Attendance", href: `/teach/${c.id}/attendance`, show: true },
    { id: "alerts", label: "Alerts", href: `/teach/${c.id}/alerts`, show: true },
    { id: "announcements", label: "Announcements", href: `/teach/${c.id}/announcements`, show: true },
    { id: "students", label: "Students", href: `/teach/${c.id}/students`, show: true },
    { id: "groups", label: "Groups", href: `/teach/${c.id}/groups`, show: true },
    { id: "staff", label: "Staff", href: `/teach/${c.id}/staff`, show: true },
  ];
  const program = (await db.class.findUnique({ where: { id: c.id }, select: { program: { select: { name: true, badge: true } } } }))?.program;
  const status = c.archivedAt ? "Archived: students can't see it." : `Class code ${c.joinCode}`;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        <Link href="/teach" className="text-muted hover:text-text hover:underline">
          ← My classes
        </Link>
      </p>
      {program && <ProgramTag program={program} />}
      <PageHeader title={c.name} description={`${status} · You: ${ROLE_LABEL[role]}`} />
      <PillNav label="Class pages" items={tabs.filter((t) => t.show).map((t) => ({ href: t.href, label: t.label, active: t.id === active }))} />
    </div>
  );
}
