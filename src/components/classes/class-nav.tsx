import Link from "next/link";
import { cn } from "@/lib/utils";
import { ProgramTag } from "@/components/brand/seal";
import { db } from "@/server/db";

export type ClassTab = "trends" | "announcements" | "overview" | "students" | "assign" | "skills" | "groups" | "review" | "staff" | "scores" | "attendance" | "alerts" | "curriculum" | "assistant";
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
    { id: "trends", label: "Trends", href: `/teach/${c.id}/trends`, show: true },
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
  const groups: { label: string; ids: ClassTab[] }[] = [
    { label: "Overview", ids: ["overview", "scores", "skills", "trends"] },
    { label: "Teach", ids: ["assign", "review", "curriculum", "assistant"] },
    { label: "People", ids: ["students", "groups", "staff", "attendance", "alerts", "announcements"] },
  ];
  const shown = new Map(tabs.filter((t) => t.show).map((t) => [t.id, t]));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p className="text-sm">
        <Link href="/teach" className="text-muted hover:text-text hover:underline">
          ← My classes
        </Link>
      </p>
      <header className="hero-card rounded-lg py-7 pb-10 pl-9 pr-5 sm:pl-[4.25rem] sm:pr-8">
        {program && <ProgramTag program={program} className="text-white [&_.text-muted]:text-white/80" />}
        <h1 className="cover-title mt-3 text-3xl sm:text-[2.6rem]">{c.name}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {c.archivedAt ? (
            <span className="rounded bg-white/15 px-3 py-1">Archived: students can&apos;t see it</span>
          ) : (
            <span className="rounded bg-white/15 px-3 py-1">
              Class code <span className="font-bold tracking-wider">{c.joinCode}</span>
            </span>
          )}
          <span className="rounded bg-white/15 px-3 py-1">You: {ROLE_LABEL[role]}</span>
        </p>
      </header>
      <nav aria-label="Class pages" className="min-w-0">
        <ul className="flex items-center gap-x-1 gap-y-1.5 overflow-x-auto rounded-lg border-[1.5px] border-border bg-surface p-1.5 sm:flex-wrap">
          {groups.map((g, gi) => {
            const items = g.ids.flatMap((id) => (shown.get(id) ? [shown.get(id)!] : []));
            if (!items.length) return null;
            return (
              <li key={g.label} className="flex shrink-0 items-center gap-1 sm:flex-wrap">
                {gi > 0 && <span aria-hidden className="mx-1 h-6 w-px bg-border" />}
                <span className="px-2 text-xs font-bold text-muted">{g.label}</span>
                {items.map((t) => (
                  <Link
                    key={t.id}
                    href={t.href}
                    aria-current={t.id === active ? "page" : undefined}
                    className={cn("press whitespace-nowrap rounded-xl px-3 py-1.5 text-sm transition-colors", t.id === active ? "bg-text font-semibold text-bg" : "text-text hover:bg-surface-2")}
                  >
                    {t.label}
                  </Link>
                ))}
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
