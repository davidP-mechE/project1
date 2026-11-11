import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/misc";
import { Alert } from "@/components/ui/alert";
import { ClassNav } from "@/components/classes/class-nav";
import { CurriculumImport, PublishCurriculumButton, SuggestionCard, UnitRow } from "@/components/classes/assistant-forms";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { getCurriculum, pacingSuggestions } from "@/server/curriculum";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Curriculum" };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The class's plan on the school calendar: import, edit, publish, and pacing suggestions. */
export default async function CurriculumPage({ params }: PageProps<"/teach/[classId]/curriculum">) {
  const user = await requireUser();
  const { classId } = await params;
  let c, cur, sug;
  try {
    [c, cur, sug] = await Promise.all([getClassForTeacher(user.id, classId), getCurriculum(user.id, classId), pacingSuggestions(user.id, classId, { wording: true }).catch(() => ({ suggestions: [] }))]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const manage = cur.access.role === "ADMIN" || cur.access.role === "TEACHER";
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <ClassNav c={c} active="curriculum" />
      {sug.suggestions.map((s) => (
        <SuggestionCard key={s.key} classId={classId} s={s} />
      ))}
      {cur.curriculum ? (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {cur.curriculum.title}{" "}
              <span className="text-sm font-normal text-muted">· {cur.curriculum.status === "ACTIVE" ? "Published" : "Draft (students can't see it)"}</span>
            </h2>
            {manage && cur.curriculum.status === "DRAFT" && <PublishCurriculumButton classId={classId} curriculumId={cur.curriculum.id} />}
          </div>
          {!cur.calendar.termStart && <Alert tone="info">Units start from today. The program admin can set the term dates and days off on the program page; new imports follow them.</Alert>}
          <ol className="flex flex-col divide-y divide-border">
            {cur.curriculum.units.map((u) => (
              <UnitRow key={u.id} classId={classId} canEdit={cur.canEdit} unit={{ id: u.id, title: u.title, domains: u.domains, startsOn: iso(u.startsOn), endsOn: iso(u.endsOn), notes: u.notes }} />
            ))}
          </ol>
        </Card>
      ) : (
        !manage && <Alert tone="info">No curriculum yet.</Alert>
      )}
      {manage && (
        <Card>
          <h2 className="mb-3 text-lg font-semibold">{cur.curriculum ? "Start over" : "Set up the curriculum"}</h2>
          <CurriculumImport classId={classId} />
        </Card>
      )}
    </div>
  );
}
