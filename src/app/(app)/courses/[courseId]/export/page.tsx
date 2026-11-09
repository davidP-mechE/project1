import type { Metadata } from "next";
import Link from "next/link";
import { CourseHeader } from "@/components/course/course-header";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { getCourseOr404 } from "@/server/course-page";
import { getCourseExport } from "@/server/export";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Export" };

export default async function ExportPage({ params }: PageProps<"/courses/[courseId]/export">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await getCourseOr404(user.id, courseId);
  const data = await getCourseExport(user.id, courseId);
  const lessons = data.units.reduce((n, u) => n + u.lessons.length, 0);
  const cards = data.units.reduce((n, u) => n + u.lessons.reduce((m, l) => m + l.flashcards.length, 0), 0);
  const questions = data.units.reduce((n, u) => n + u.test.length + u.lessons.reduce((m, l) => m + l.questions.length, 0), 0) + data.finalExam.length;
  const api = `/api/courses/${courseId}/export`;

  const options = [
    {
      icon: "📄",
      title: "Study guide (PDF)",
      body: "Every lesson with its math, worked examples, key terms, questions and answers, laid out for paper. Opens a printable page: choose Save as PDF in the print dialog.",
      action: (
        <Link href={`/print/courses/${courseId}?autoprint=1`} className={buttonClasses("primary", "sm")} target="_blank">
          Open printable guide
        </Link>
      ),
    },
    {
      icon: "🃏",
      title: "Anki deck",
      body: `${cards} flashcards as an .apkg file, one subdeck per unit, with math. Double-click it (or File → Import in Anki).`,
      action: (
        <a href={`${api}?format=apkg`} className={buttonClasses("secondary", "sm")} download>
          Download .apkg
        </a>
      ),
    },
    {
      icon: "📝",
      title: "Markdown",
      body: "The whole guide as one .md file, for Obsidian, Notion, Typora or any notes app. Math stays as LaTeX.",
      action: (
        <span className="flex flex-wrap gap-2">
          <a href={`${api}?format=md`} className={buttonClasses("secondary", "sm")} download>
            With answers
          </a>
          <a href={`${api}?format=md&answers=0`} className={buttonClasses("ghost", "sm")} download>
            Without answers
          </a>
        </span>
      ),
    },
    {
      icon: "📊",
      title: "Spreadsheets (CSV)",
      body: `Flashcards (works with Quizlet import) or all ${questions} questions with answers, for Excel, Google Sheets or Numbers.`,
      action: (
        <span className="flex flex-wrap gap-2">
          <a href={`${api}?format=cards.csv`} className={buttonClasses("secondary", "sm")} download>
            Flashcards CSV
          </a>
          <a href={`${api}?format=questions.csv`} className={buttonClasses("ghost", "sm")} download>
            Questions CSV
          </a>
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <CourseHeader course={course} />
      {lessons === 0 ? (
        <EmptyState title="Nothing to export yet">Generate some lessons first.</EmptyState>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            {lessons} lessons · {questions} questions · {cards} flashcards. Exports include only lessons that have been written. Your notes and highlights export from the Notes tab.
          </p>
          <ul className="grid gap-4 sm:grid-cols-2">
            {options.map((o) => (
              <li key={o.title} className="stagger flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
                <div className="flex items-center gap-3">
                  <span className="text-2xl" aria-hidden>
                    {o.icon}
                  </span>
                  <h2 className="font-semibold">{o.title}</h2>
                </div>
                <p className="flex-1 text-sm text-muted">{o.body}</p>
                <div>{o.action}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
