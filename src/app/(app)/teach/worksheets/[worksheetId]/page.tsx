import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookLoader } from "@/components/ui/book-loader";
import { Card, PageHeader } from "@/components/ui/misc";
import { ConfirmAllTagsButton } from "@/components/classes/tag-editor";
import { ApproveDraftButtons } from "@/components/classes/assistant-forms";
import { Alert } from "@/components/ui/alert";
import { AssignQuestionsForm, ItemCard, ReadingPoller, RetryWorksheetButton } from "@/components/classes/worksheet-editor";
import { dueText } from "@/components/classes/format";
import { NotFoundError } from "@/server/courses";
import { assignableCourses, listTeaching } from "@/server/classes";
import { getWorksheet } from "@/server/worksheets";
import { requireUser, viewerZone } from "@/server/session";

export const metadata: Metadata = { title: "Worksheet" };

/** A worksheet: the questions Claude found (check and edit them), and assigning them to classes. */
export default async function WorksheetPage({ params }: PageProps<"/teach/worksheets/[worksheetId]">) {
  const user = await requireUser();
  const zone = await viewerZone();
  const { worksheetId } = await params;
  let ws;
  try {
    ws = await getWorksheet(user.id, worksheetId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const [classes, courses] = ws.status === "READY" ? await Promise.all([listTeaching(user.id), assignableCourses(user.id)]) : [[], []];
  const toCheck = ws.items.filter((i) => i.answerSource === "CLAUDE").length;
  const draft = ws.source === "AI_DRAFT";
  const unapproved = ws.items.filter((i) => !i.approvedAt).length;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <p className="text-sm">
        <Link href="/teach/worksheets" className="text-muted hover:text-text hover:underline">
          ← Worksheets
        </Link>
      </p>
      <PageHeader
        title={ws.title}
        description={draft ? `${ws.items.length} questions drafted by Claude · ${unapproved} waiting for approval` : ws.status === "READY" ? `${ws.items.length} questions from ${ws.pageCount} ${ws.pageCount === 1 ? "page" : "pages"}${ws.hasAnswerKey ? " · answer key found" : ""}` : undefined}
        actions={
          draft ? (
            unapproved > 0 && <ApproveDraftButtons worksheetId={ws.id} pendingCount={unapproved} />
          ) : (
            <a href={`/api/worksheets/${ws.id}/file`} target="_blank" rel="noopener" className="text-sm underline">
              Open the PDF
            </a>
          )
        }
      />
      {draft && unapproved > 0 && <Alert tone="warning">Claude wrote these. Check each question and its answer key, fix anything with Edit, then approve. Unapproved questions can&apos;t be assigned or used in diagnostics.</Alert>}

      {ws.status === "READING" && (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <ReadingPoller />
          <BookLoader label="Claude is reading the worksheet" showLabel size="lg" />
          <p className="max-w-md text-sm text-muted">Claude is listing each question and its answer. This usually takes under a minute.</p>
        </Card>
      )}
      {ws.status === "FAILED" && (
        <Card className="flex flex-col gap-3">
          <Alert tone="error">{ws.error ?? "This worksheet couldn't be read."}</Alert>
          <RetryWorksheetButton worksheetId={ws.id} />
        </Card>
      )}

      {ws.status === "READY" && (
        <>
          {toCheck > 0 && (
            <Alert tone="warning">
              {toCheck} {toCheck === 1 ? "answer was" : "answers were"} worked out by Claude because the worksheet didn&apos;t include {toCheck === 1 ? "it" : "them"}. Check {toCheck === 1 ? "it" : "them"} below (Edit to fix).
            </Alert>
          )}
          {ws.assignments.length > 0 && (
            <Card>
              <h2 className="mb-2 text-lg font-semibold">Assigned</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {ws.assignments.map((a) => (
                  <li key={a.id}>
                    <Link href={`/teach/${a.class.id}/assignments/${a.id}`} className="font-medium hover:underline">
                      {a.title}
                    </Link>{" "}
                    <span className="text-muted">
                      · {a.class.name} · {a.itemIds.length} questions · {dueText(a.dueAt, undefined, zone)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Assign questions</h2>
            <AssignQuestionsForm
              worksheetId={ws.id}
              worksheetTitle={ws.title}
              items={ws.items.map((i) => ({ id: i.id, label: i.label, topic: i.topic, prompt: i.prompt, answerSource: i.answerSource }))}
              classes={classes.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, name: c.name }))}
              courses={courses.map((c) => ({ id: c.id, title: c.title }))}
            />
          </Card>
          <section aria-labelledby="questions" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="questions" className="text-lg font-semibold">
                Questions
              </h2>
              <ConfirmAllTagsButton worksheetId={ws.id} count={ws.items.filter((i) => !i.tagsConfirmed).length} />
            </div>
            {ws.items.map((i, n) => (
              <div key={i.id} className="flex flex-col gap-2">
              {draft && !i.approvedAt && (
                <div className="flex justify-end">
                  <ApproveDraftButtons worksheetId={ws.id} itemId={i.id} />
                </div>
              )}
              <ItemCard worksheetId={ws.id} number={n + 1} item={{ id: i.id, label: i.label, type: i.type, prompt: i.prompt, choices: i.choices, correctChoice: i.correctChoice, answer: i.answer, explanation: i.explanation, steps: i.steps, topic: i.topic, answerSource: i.answerSource, tags: { domain: i.domain, skill: i.skill, difficulty: i.difficulty, desmosSolvable: i.desmosSolvable, tagsConfirmed: i.tagsConfirmed }, version: i.version, answered: i._count.answers }} />
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
