import type { ReactNode } from "react";
import type { LessonContent } from "@/lib/ai/lesson-schema";
import { bookPageHref } from "./cite-pages";
import { Markdown } from "./markdown";
import { refPrefix, unitWord, type SourceKindName } from "@/lib/source-label";

/**
 * "p. 4" / "pp. 4, 6" links to the original book at that page. On the lesson
 * page they open the book viewer beside the lesson (data-book-page); elsewhere
 * they open the PDF in a new tab.
 */
export function PageRefs({ bookId, pages, kind }: { bookId: string; pages: number[]; kind?: SourceKindName }) {
  if (pages.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-muted">
      <span>{refPrefix(kind, pages.length)}</span>
      {pages.map((p) => (
        <a
          key={p}
          href={bookPageHref(bookId, p)}
          data-book-page={p}
          target="_blank"
          rel="noopener"
          className="rounded bg-surface-2 px-1.5 py-0.5 tabular-nums hover:text-text hover:underline"
          aria-label={`Open ${unitWord(kind)} ${p}`}
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
      <h2 id={id} className="mb-4 font-display text-2xl">
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

export function WorkedExamples({ items, bookId, kind }: { items: LessonContent["workedExamples"]; bookId: string; kind?: SourceKindName }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((w, i) => (
        <li key={i} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">{w.title}</h3>
            <PageRefs bookId={bookId} pages={w.pageRefs} kind={kind} />
          </div>
          <Markdown className="mt-2" bookId={bookId}>{w.problem}</Markdown>
          <details className="mt-3 group">
            <summary className="cursor-pointer text-sm font-medium text-primary">Show the solution</summary>
            <ol className="mt-3 flex list-decimal flex-col gap-2 pl-6">
              {w.steps.map((s, j) => (
                <li key={j}>
                  <Markdown className="[&_p]:m-0" bookId={bookId}>{s}</Markdown>
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

export function KeyTerms({ items, bookId, kind }: { items: LessonContent["keyTerms"]; bookId: string; kind?: SourceKindName }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((k, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface p-3">
          <dt className="flex flex-wrap items-baseline justify-between gap-2 font-semibold">
            <span>{k.term}</span>
            <PageRefs bookId={bookId} pages={k.pageRefs} kind={kind} />
          </dt>
          <dd className="mt-1 text-sm">
            <Markdown className="[&_p]:m-0" bookId={bookId}>{k.definition}</Markdown>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Flashcards({ items }: { items: { id: string; front: string; back: string }[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((f) => (
        <li key={f.id}>
          <details className="index-card press-soft group h-full p-4">
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
