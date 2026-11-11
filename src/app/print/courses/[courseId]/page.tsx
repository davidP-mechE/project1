import { formatInZone } from "@/lib/dates";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/export/print-toolbar";
import { Markdown } from "@/components/lesson/markdown";
import { pagesLabel, rangeLabel, type ExportQuestion } from "@/lib/export/types";
import type { SourceKindName } from "@/lib/source-label";
import { NotFoundError } from "@/server/courses";
import { getCourseExport } from "@/server/export";
import { requireUser, viewerZone } from "@/server/session";
import { track } from "@/server/analytics";

export const metadata: Metadata = { title: "Study guide" };

const letter = (i: number) => String.fromCharCode(65 + i);

/**
 * The printable study guide. Print it, or "Save as PDF" from the browser's
 * print dialog: it's the same rendering as the app (math via KaTeX), laid out
 * for paper (black on white, units start on a new page, no app chrome).
 */
export default async function PrintCoursePage({ params, searchParams }: PageProps<"/print/courses/[courseId]">) {
  const user = await requireUser();
  const zone = await viewerZone();
  const { courseId } = await params;
  const sp = await searchParams;
  const answers = sp.answers !== "0";
  const flashcards = sp.flashcards !== "0";
  let c;
  try {
    c = await getCourseExport(user.id, courseId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  await track("print_opened", user.id);
  return (
    <div className="print-doc">
      <PrintToolbar courseId={courseId} answers={answers} flashcards={flashcards} autoPrint={sp.autoprint === "1"} />
      <article className="mx-auto max-w-[46rem] px-6 pb-16">
        <header className="mb-10 border-b-2 border-black pb-6">
          <p className="text-sm text-neutral-500">Study guide</p>
          <h1 className="mt-2 text-4xl font-bold">{c.title}</h1>
          <p className="mt-3 text-sm text-neutral-600">
            Made with Coursebook from “{c.bookFilename}” on {formatInZone(new Date(), zone, "long")}. Page numbers refer to the original book.
          </p>
        </header>
        <nav className="mb-10">
          <h2 className="mb-2 text-lg font-bold">Contents</h2>
          <ol className="list-decimal pl-6 text-sm">
            {c.units.map((u, i) => (
              <li key={i}>
                {u.title}
                <ol className="list-[lower-alpha] pl-6 text-neutral-700">
                  {u.lessons.map((l, j) => (
                    <li key={j}>
                      {l.title} <span className="text-neutral-500">({rangeLabel(l.pageStart, l.pageEnd, c.kind)})</span>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
            {c.finalExam.length > 0 && <li>Final exam</li>}
          </ol>
        </nav>
        {c.units.map((u, i) => (
          <section key={i} className="print-unit">
            <h2 className="mb-4 border-b border-black pb-2 text-2xl font-bold">{u.title}</h2>
            {u.summary && (
              <div className="mb-6 rounded border border-neutral-300 p-4">
                <p className="mb-2 font-bold">Unit summary</p>
                <Markdown>{u.summary}</Markdown>
              </div>
            )}
            {u.lessons.map((l, j) => (
              <section key={j} className="print-lesson mb-8">
                <h3 className="text-xl font-bold">{l.title}</h3>
                <p className="mb-3 text-xs text-neutral-500">{rangeLabel(l.pageStart, l.pageEnd, c.kind)}</p>
                {l.objectives.length > 0 && (
                  <ul className="mb-3 list-disc pl-6 text-sm">
                    {l.objectives.map((o, k) => (
                      <li key={k}>
                        <Markdown className="[&_p]:m-0">{o}</Markdown>
                      </li>
                    ))}
                  </ul>
                )}
                <Markdown>{l.explanation}</Markdown>
                {l.workedExamples.length > 0 && (
                  <div className="mt-4">
                    <h4 className="font-bold">Worked examples</h4>
                    {l.workedExamples.map((w, k) => (
                      <div key={k} className="print-keep mt-2 rounded border border-neutral-300 p-3 text-sm">
                        <p className="font-semibold">
                          {w.title} <span className="font-normal text-neutral-500">{pagesLabel(w.pageRefs, c.kind)}</span>
                        </p>
                        <Markdown>{w.problem}</Markdown>
                        <ol className="mt-1 list-decimal pl-6">
                          {w.steps.map((s, m) => (
                            <li key={m}>
                              <Markdown className="[&_p]:m-0">{s}</Markdown>
                            </li>
                          ))}
                        </ol>
                        <p className="mt-1">
                          <strong>Answer:</strong> <Markdown className="inline [&_p]:inline">{w.answer}</Markdown>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {l.keyTerms.length > 0 && (
                  <div className="print-keep mt-4">
                    <h4 className="font-bold">Key terms</h4>
                    <dl className="mt-1 text-sm">
                      {l.keyTerms.map((k, m) => (
                        <div key={m} className="mt-1">
                          <dt className="inline font-semibold">{k.term}: </dt>
                          <dd className="inline">
                            <Markdown className="inline [&_p]:inline">{k.definition}</Markdown>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
                {l.questions.length > 0 && <Questions title="Practice questions" qs={l.questions} answers={answers} kind={c.kind} />}
                {flashcards && l.flashcards.length > 0 && (
                  <div className="mt-4">
                    <h4 className="font-bold">Flashcards</h4>
                    <table className="mt-1 w-full border-collapse text-sm">
                      <tbody>
                        {l.flashcards.map((f) => (
                          <tr key={f.id} className="print-keep">
                            <td className="w-1/2 border border-neutral-300 p-2 align-top font-medium">
                              <Markdown className="[&_p]:m-0">{f.front}</Markdown>
                            </td>
                            <td className="border border-neutral-300 p-2 align-top">
                              <Markdown className="[&_p]:m-0">{f.back}</Markdown>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}
            {u.test.length > 0 && <Questions title={`${u.title}: unit test`} qs={u.test} answers={answers} kind={c.kind} />}
          </section>
        ))}
        {c.finalExam.length > 0 && (
          <section className="print-unit">
            <h2 className="mb-4 border-b border-black pb-2 text-2xl font-bold">Final exam</h2>
            <Questions title="" qs={c.finalExam} answers={answers} kind={c.kind} />
          </section>
        )}
      </article>
    </div>
  );
}

function Questions({ title, qs, answers, kind }: { title: string; qs: ExportQuestion[]; answers: boolean; kind?: SourceKindName }) {
  return (
    <div className="mt-4">
      {title && <h4 className="font-bold">{title}</h4>}
      <ol className="mt-1 list-decimal pl-6 text-sm">
        {qs.map((q, i) => (
          <li key={i} className="print-keep mt-2">
            <Markdown className="[&_p]:m-0">{q.prompt}</Markdown>
            {q.choices.length > 0 && (
              <ul className="mt-1 pl-2">
                {q.choices.map((ch, j) => (
                  <li key={j} className="flex gap-1">
                    <span>{letter(j)}.</span>
                    <Markdown className="[&_p]:m-0">{ch}</Markdown>
                  </li>
                ))}
              </ul>
            )}
            {answers && (
              <div className="mt-1 border-l-2 border-neutral-400 pl-2 text-neutral-700">
                <strong>Answer: </strong>
                {q.type === "MULTIPLE_CHOICE" && q.correctChoice !== null ? `${letter(q.correctChoice)}. ` : ""}
                <Markdown className="inline [&_p]:inline">{q.type === "MULTIPLE_CHOICE" && q.correctChoice !== null ? (q.choices[q.correctChoice] ?? "") : q.answer}</Markdown>
                {q.steps.length > 0 && (
                  <ol className="list-decimal pl-6">
                    {q.steps.map((s, j) => (
                      <li key={j}>
                        <Markdown className="[&_p]:m-0">{s}</Markdown>
                      </li>
                    ))}
                  </ol>
                )}
                {q.pageRefs.length > 0 && <span className="text-xs text-neutral-500"> ({pagesLabel(q.pageRefs, kind)})</span>}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
