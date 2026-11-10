import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, EmptyState, ProgressBar } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import { pct } from "@/components/classes/format";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher, skillsReport } from "@/server/classes";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Skills" };

/** How the class does on each skill tested by worksheet questions, weakest first, and who's struggling with it. */
export default async function SkillsPage({ params }: PageProps<"/teach/[classId]/skills">) {
  const user = await requireUser();
  const { classId } = await params;
  let c, skills;
  try {
    [c, skills] = await Promise.all([getClassForTeacher(user.id, classId), skillsReport(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <ClassNav c={c} active="skills" />
      {skills.length === 0 ? (
        <EmptyState title="No answers yet">Skills come from worksheet questions. Once students answer some, you&apos;ll see the class&apos;s weakest skills here.</EmptyState>
      ) : (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Skills, weakest first</h2>
          <p className="mb-4 text-sm text-muted">From students&apos; latest answers to worksheet questions. Struggling: under 60% on a skill, with at least 2 answers.</p>
          <ul className="flex flex-col gap-4">
            {skills.map((s) => (
              <li key={s.topic} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{s.topic}</span>
                  <span className="tabular-nums text-muted">
                    {pct(s.accuracy)} · {s.answers} {s.answers === 1 ? "answer" : "answers"}
                  </span>
                </div>
                <ProgressBar value={s.accuracy * 100} label={`${s.topic}: ${pct(s.accuracy)} correct`} />
                {s.struggling.length > 0 && (
                  <p className="text-xs text-muted">
                    Struggling: {s.struggling.map((x) => `${x.name} (${pct(x.accuracy)})`).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
