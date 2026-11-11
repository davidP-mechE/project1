import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/misc";
import { ClassNav } from "@/components/classes/class-nav";
import { AskForm, DraftLessonForm, DraftQuestionsForm, LessonReview, SummaryButton } from "@/components/classes/assistant-forms";
import { NotFoundError } from "@/server/courses";
import { getClassForTeacher } from "@/server/classes";
import { classLessons, latestSummaries } from "@/server/assistant";
import { listGroups } from "@/server/groups";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Assistant" };

/** Claude as a teaching assistant: everything it writes is a draft for staff to check. */
export default async function AssistantPage({ params }: PageProps<"/teach/[classId]/assistant">) {
  const user = await requireUser();
  const { classId } = await params;
  let c, sums, lessons, g;
  try {
    [c, sums, lessons, g] = await Promise.all([getClassForTeacher(user.id, classId), latestSummaries(user.id, classId), classLessons(user.id, classId), listGroups(user.id, classId)]);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const canDraft = c.access.role !== "VIEWER";
  const allowed = c.access.subjects ? [...c.access.subjects] : null;
  const groupName = new Map(g.groups.map((x) => [x.id, x.name]));
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <ClassNav c={c} active="assistant" />
      <Card>
        <h2 className="mb-1 text-lg font-semibold">Ask about your class</h2>
        <p className="mb-3 text-sm text-muted">Claude looks up your class&apos;s data (only what you can see) and answers. It can&apos;t change anything.</p>
        <AskForm classId={classId} />
      </Card>
      <Card>
        <h2 className="mb-1 text-lg font-semibold">Weekly summary</h2>
        <p className="mb-3 text-sm text-muted">Who improved, who&apos;s struggling, and what to reteach. Claude sees numbers and stand-in labels, never names. For staff only.</p>
        {canDraft && <SummaryButton classId={classId} groups={g.groups.map((x) => ({ id: x.id, name: x.name }))} />}
        {sums.summaries.slice(0, 3).map((s) => (
          <div key={s.id} className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm">
            <p className="text-xs font-medium text-muted">
              Week of {s.weekOf} · {s.groupId ? groupName.get(s.groupId) ?? "a group" : "whole class"}
            </p>
            <p>{s.content.overview}</p>
            {s.content.improved.length > 0 && (
              <p>
                <strong>Improved:</strong> {s.content.improved.map((x) => `${x.name} (${x.evidence})`).join("; ")}
              </p>
            )}
            {s.content.struggling.length > 0 && (
              <p>
                <strong>Struggling:</strong> {s.content.struggling.map((x) => `${x.name} (${x.evidence})`).join("; ")}
              </p>
            )}
            {s.content.reteach.length > 0 && (
              <p>
                <strong>Reteach:</strong> {s.content.reteach.map((x) => `${x.domain}: ${x.why}`).join("; ")}
              </p>
            )}
          </div>
        ))}
      </Card>
      {canDraft && (
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Draft practice questions</h2>
          <p className="mb-3 text-sm text-muted">Original SAT-style questions. They land in Worksheets as a draft; approve each one before assigning it or using it in a diagnostic.</p>
          <DraftQuestionsForm classId={classId} allowed={allowed} />
        </Card>
      )}
      <Card>
        <h2 className="mb-1 text-lg font-semibold">Lessons</h2>
        <p className="mb-3 text-sm text-muted">Short lessons for students, shown in their Classes page only after you approve them.</p>
        {canDraft && <DraftLessonForm classId={classId} allowed={allowed} />}
        {lessons.lessons.map((l) => (
          <details key={l.id} className="mt-3 rounded-lg border border-border p-3">
            <summary className="cursor-pointer font-medium">
              {l.title} <span className="text-xs font-normal text-muted">· {l.approvedAt ? "Shown to students" : "Draft"}</span>
            </summary>
            <div className="mt-3">{canDraft ? <LessonReview classId={classId} lesson={{ id: l.id, title: l.title, content: l.content, approved: Boolean(l.approvedAt) }} /> : <p className="text-sm">{l.content.slice(0, 400)}</p>}</div>
          </details>
        ))}
      </Card>
    </div>
  );
}
