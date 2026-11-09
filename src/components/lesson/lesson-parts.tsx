import type { ReactNode } from "react";
import type { LessonContent } from "@/lib/ai/lesson-schema";
import { Markdown } from "./markdown";

/** "p. 4" / "pp. 4, 6" links that open the original PDF at that page. */
export function PageRefs({ bookId, pages }: { bookId: string; pages: number[] }) {
  if (pages.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-muted">
      <span>{pages.length === 1 ? "p." : "pp."}</span>
      {pages.map((p) => (
        <a
          key={p}
          href={`/api/books/${bookId}/file#page=${p}`}
          target="_blank"
          rel="noopener"
          className="rounded bg-surface-2 px-1.5 py-0.5 tabular-nums hover:text-text hover:underline"
          aria-label={`Open the original book at page ${p}`}
        >
          {p}
        </a>
      ))}
    </span>
  );
}

export function Section({ title, id, children, count }: { title: string; id: string; children: ReactNode; count?: number }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-20">
      <h2 id={id} className="mb-3 text-lg font-semibold">
        {title}
        {count !== undefined && <span className="ml-2 text-sm font-normal text-muted">({count})</span>}
      </h2>
      {children}
    </section>
  );
}

export function Objectives({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((o, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-1 text-primary">
            ✓
          </span>
          <Markdown className="[&_p]:m-0">{o}</Markdown>
        </li>
      ))}
    </ul>
  );
}

export function WorkedExamples({ items, bookId }: { items: LessonContent["workedExamples"]; bookId: string }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((w, i) => (
        <li key={i} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">{w.title}</h3>
            <PageRefs bookId={bookId} pages={w.pageRefs} />
          </div>
          <Markdown className="mt-2">{w.problem}</Markdown>
          <details className="mt-3 group">
            <summary className="cursor-pointer text-sm font-medium text-primary">Show the solution</summary>
            <ol className="mt-3 flex list-decimal flex-col gap-2 pl-6">
              {w.steps.map((s, j) => (
                <li key={j}>
                  <Markdown className="[&_p]:m-0">{s}</Markdown>
                </li>
              ))}
            </ol>
            {w.answer && (
              <div className="mt-3 rounded-lg bg-success-bg p-3 text-sm">
                <span className="font-semibold">Answer: </span>
                <Markdown className="inline [&_p]:inline">{w.answer}</Markdown>
              </div>
            )}
          </details>
        </li>
      ))}
    </ol>
  );
}

export function KeyTerms({ items, bookId }: { items: LessonContent["keyTerms"]; bookId: string }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((k, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface p-3">
          <dt className="flex flex-wrap items-baseline justify-between gap-2 font-semibold">
            <span>{k.term}</span>
            <PageRefs bookId={bookId} pages={k.pageRefs} />
          </dt>
          <dd className="mt-1 text-sm">
            <Markdown className="[&_p]:m-0">{k.definition}</Markdown>
          </dd>
        </div>
      ))}
    </dl>
  );
}

type Q = {
  id: string;
  type: "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "STEP_BY_STEP";
  prompt: string;
  choices: string[];
  correctChoice: number | null;
  answer: string;
  explanation: string;
  steps: string[];
  pageRefs: number[];
  topic: string;
};

const TYPE_LABEL = { MULTIPLE_CHOICE: "Multiple choice", SHORT_ANSWER: "Short answer", STEP_BY_STEP: "Step-by-step problem" };

/** Practice questions. Checking answers interactively comes in Phase 5; for now answers can be revealed. */
export function Questions({ items, bookId }: { items: Q[]; bookId: string }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((q, i) => (
        <li key={q.id} className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>
              Question {i + 1} · {TYPE_LABEL[q.type]} · {q.topic}
            </span>
            <PageRefs bookId={bookId} pages={q.pageRefs} />
          </div>
          <Markdown>{q.prompt}</Markdown>
          {q.type === "MULTIPLE_CHOICE" && (
            <ol className="mt-3 flex flex-col gap-1.5" type="A">
              {q.choices.map((c, j) => (
                <li key={j} className="flex gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="font-semibold text-muted">{String.fromCharCode(65 + j)}.</span>
                  <Markdown className="[&_p]:m-0">{c}</Markdown>
                </li>
              ))}
            </ol>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-primary">Show the answer</summary>
            <div className="mt-3 flex flex-col gap-3 rounded-lg bg-surface-2 p-3 text-sm">
              <div>
                <span className="font-semibold">Answer: </span>
                {q.type === "MULTIPLE_CHOICE" && q.correctChoice !== null ? (
                  <span>
                    {String.fromCharCode(65 + q.correctChoice)}. <Markdown className="inline [&_p]:inline">{q.choices[q.correctChoice] ?? ""}</Markdown>
                  </span>
                ) : (
                  <Markdown className="inline [&_p]:inline">{q.answer}</Markdown>
                )}
              </div>
              {q.steps.length > 0 && (
                <ol className="flex list-decimal flex-col gap-1.5 pl-6">
                  {q.steps.map((s, j) => (
                    <li key={j}>
                      <Markdown className="[&_p]:m-0">{s}</Markdown>
                    </li>
                  ))}
                </ol>
              )}
              {q.explanation && (
                <div>
                  <span className="font-semibold">Why: </span>
                  <Markdown className="inline [&_p]:inline">{q.explanation}</Markdown>
                </div>
              )}
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

export function Flashcards({ items }: { items: { id: string; front: string; back: string }[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((f) => (
        <li key={f.id}>
          <details className="group h-full rounded-xl border border-border bg-surface p-4 open:bg-surface-2">
            <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
              <Markdown className="[&_p]:m-0">{f.front}</Markdown>
              <span className="mt-2 block text-xs font-normal text-primary group-open:hidden">Tap to flip</span>
            </summary>
            <div className="mt-3 border-t border-border pt-3 text-sm">
              <Markdown className="[&_p]:m-0">{f.back}</Markdown>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
