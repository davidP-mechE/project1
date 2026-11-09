import type { Metadata } from "next";
import Link from "next/link";
import { PillNav } from "@/components/review/filters";
import { SkillBadge } from "@/components/review/skill-badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { HAMMER_STREAK } from "@/lib/mastery/review";
import { getSkills } from "@/server/review";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Review" };

const drillHref = (courseId: string, key: string) => `/skills/drill?course=${courseId}&skill=${encodeURIComponent(key)}`;

/** Review: every skill (question topic) by course, shakiest first, each with a "Hammer it" drill. */
export default async function SkillsPage({ searchParams }: PageProps<"/skills">) {
  const user = await requireUser();
  const sp = await searchParams;
  const all = await getSkills(user.id);
  const courseId = typeof sp.course === "string" && all.some((c) => c.id === sp.course) ? sp.course : null;
  const shown = courseId ? all.filter((c) => c.id === courseId) : all;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Review"
        description={`Pick a skill and hammer it: questions on just that skill, with misses coming back, and new ones written for you until you get ${HAMMER_STREAK} right in a row.`}
      />
      {all.length === 0 ? (
        <EmptyState title="No skills yet" action={<Link href="/library" className={buttonClasses("primary")}>Go to your library</Link>}>
          Skills come from the practice questions in your courses. Generate a course to start.
        </EmptyState>
      ) : (
        <>
          {all.length > 1 && (
            <PillNav
              label="Choose a course"
              items={[{ href: "/skills", label: "All courses", active: !courseId }, ...all.map((c) => ({ href: `/skills?course=${c.id}`, label: c.title, count: c.skills.length, active: c.id === courseId }))]}
            />
          )}
          {shown.map((c) => (
            <section key={c.id} aria-labelledby={`skills-${c.id}`} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-2">
                <h2 id={`skills-${c.id}`} className="text-xl font-semibold">
                  {c.title}
                </h2>
                <span className="text-sm text-muted">
                  {c.skills.filter((s) => s.stats.status === "hammered").length} of {c.skills.length} hammered
                </span>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {c.skills.map((s) => (
                  <li key={s.key} className="lift flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">{s.topic}</p>
                        {s.lesson && <p className="truncate text-xs text-muted">{s.lesson.title}</p>}
                      </div>
                      <SkillBadge status={s.stats.status} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={s.stats.accuracy === null ? "Not tried yet" : `${Math.round(s.stats.accuracy * 100)}% recently`}>
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((s.stats.accuracy ?? 0) * 100)}%` }} />
                      </div>
                      <span className="shrink-0 tabular-nums">
                        {s.stats.accuracy === null ? `${s.questions} questions` : `${Math.round(s.stats.accuracy * 100)}% · ${s.stats.attempts} answers`}
                      </span>
                    </div>
                    <Link href={drillHref(c.id, s.key)} className={buttonClasses(s.stats.status === "hammered" ? "secondary" : "primary", "sm", "self-start")}>
                      {s.stats.status === "hammered" ? "Practise again" : "Hammer it"}
                      <span className="sr-only">: {s.topic}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
