"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { Markdown } from "@/components/lesson/markdown";
import { cn } from "@/lib/utils";

type CardRow = { id: string; front: string; back: string; state: string; dueLabel: string; lapses: number };
type LessonRow = { id: string; title: string; cards: CardRow[] };

const STATE_TONE: Record<string, string> = {
  NEW: "bg-surface-2 text-muted",
  LEARNING: "bg-warning-bg text-warning",
  RELEARNING: "bg-warning-bg text-warning",
  REVIEW: "bg-success-bg text-success",
};

/** Every card in the course, grouped by lesson, with a filter box. Editing happens in the lesson editor. */
export function FlashcardBrowser({ courseId, lessons }: { courseId: string; bookId: string; lessons: LessonRow[] }) {
  const [filter, setFilter] = useState("");
  const q = useDeferredValue(filter.trim().toLowerCase());
  const shown = lessons
    .map((l) => ({ ...l, cards: q ? l.cards.filter((c) => `${c.front} ${c.back}`.toLowerCase().includes(q)) : l.cards }))
    .filter((l) => l.cards.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <label htmlFor="card-filter" className="sr-only">
          Filter cards
        </label>
        <input
          id="card-filter"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter cards…"
          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
        />
      </div>
      {shown.length === 0 && <p className="text-sm text-muted">No cards match &ldquo;{filter}&rdquo;.</p>}
      {shown.map((l) => (
        <section key={l.id} aria-labelledby={`l-${l.id}`}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={`l-${l.id}`} className="font-semibold">
              {l.title} <span className="text-sm font-normal text-muted">({l.cards.length})</span>
            </h2>
            <Link href={`/courses/${courseId}/lessons/${l.id}/edit`} className="text-xs text-muted hover:text-text hover:underline">
              Edit these cards
            </Link>
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
            {l.cards.map((c) => (
              <li key={c.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[1fr_1fr_auto] sm:items-start sm:gap-4">
                <Markdown className="font-medium [&_p]:m-0">{c.front}</Markdown>
                <Markdown className="text-muted [&_p]:m-0">{c.back}</Markdown>
                <span className={cn("justify-self-start whitespace-nowrap rounded px-2 py-0.5 text-xs", STATE_TONE[c.state] ?? STATE_TONE.NEW)} title={c.lapses ? `Forgotten ${c.lapses} times` : undefined}>
                  {c.dueLabel}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
