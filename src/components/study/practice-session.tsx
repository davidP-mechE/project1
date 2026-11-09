"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { QuestionCard, type PracticeQuestion } from "@/components/study/practice";
import { Button, ButtonLink } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/misc";
import { burst } from "@/components/ui/burst";
import { requeue } from "@/lib/mastery/mastery";
import { XP } from "@/lib/gamification/xp";
import type { AttemptView } from "@/server/study";

type Item = { question: PracticeQuestion; lesson: { id: string; title: string } | null; last: AttemptView | null };

/**
 * One practice set, one question at a time. A question answered wrong comes
 * back a few questions later (at most twice), so the set finishes with the
 * ideas answered right. Every answer is saved like any other practice answer.
 */
export function PracticeSession({
  courseId,
  bookId,
  items,
  grading,
  lessonTitle,
  title = "Practice set",
  doneHref,
  doneLabel = "See your mastery",
}: {
  courseId: string;
  bookId: string;
  items: Item[];
  grading: "claude" | "demo" | null;
  lessonTitle: string | null;
  title?: string;
  doneHref?: string;
  doneLabel?: string;
}) {
  const byId = useMemo(() => new Map(items.map((i) => [i.question.id, i])), [items]);
  const [queue, setQueue] = useState(() => items.map((i) => i.question.id));
  const [answeredNow, setAnsweredNow] = useState<AttemptView | null>(null);
  const [firstTry, setFirstTry] = useState(new Map<string, boolean>());
  const [answers, setAnswers] = useState(0);
  const [round, setRound] = useState(0); // remounts the card when a question comes back
  const [retries, setRetries] = useState(new Map<string, number>());
  const doneRef = useRef<HTMLDivElement>(null);

  const total = items.length;
  const solved = [...firstTry.keys()].filter((id) => !queue.includes(id)).length;
  const current = queue[0] ? byId.get(queue[0]) : null;

  if (!current) {
    const right = [...firstTry.values()].filter(Boolean).length;
    const xp = answers * XP.question + right * XP.correctBonus;
    return (
      <div ref={doneRef} className="pop-in flex flex-col items-center gap-4 rounded-3xl border border-border bg-surface p-8 text-center">
        <p className="text-5xl" aria-hidden>
          {right === total ? "🌕" : right >= total / 2 ? "🌔" : "🌓"}
        </p>
        <h2 className="font-display text-2xl font-semibold">{title === "Practice set" ? "Set complete!" : "All done!"}</h2>
        <p className="text-muted">
          {right} of {total} right the first time · +{xp} XP
        </p>
        <p className="max-w-sm text-sm text-muted">
          {right === total ? "Every one on the first try. Nicely done." : "The ones you missed came back until you got them. They'll show up again in a later set to make sure they stick."}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => window.location.reload()}>Another set</Button>
          <ButtonLink href={doneHref ?? `/courses/${courseId}/practice`} variant="secondary">
            {doneLabel}
          </ButtonLink>
        </div>
      </div>
    );
  }

  const next = () => {
    const correct = answeredNow?.correct ?? false;
    const counts = new Map(retries);
    setQueue(requeue(queue, queue[0], correct, counts));
    setRetries(counts);
    setAnsweredNow(null);
    setRound((r) => r + 1);
    if (queue.length === 1 && correct) setTimeout(() => burst(doneRef.current, { count: 30, spread: 120 }), 50);
  };

  const comingBack = (retries.get(current.question.id) ?? 0) > 0;
  // "Question 3": the order questions were first shown in (a returning question keeps its number).
  const seen = [...firstTry.keys()];
  const seenIndex = seen.includes(current.question.id) ? seen.indexOf(current.question.id) : seen.length;
  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-14 z-[5] -mx-1 flex flex-col gap-2 rounded-xl bg-bg/95 px-1 py-2 backdrop-blur lg:top-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">{lessonTitle ? `Practising: ${lessonTitle}` : title}</span>
          <span className="tabular-nums text-muted" aria-live="polite">
            {solved} of {total} done
          </span>
        </div>
        <ProgressBar value={(solved / total) * 100} label="Practice set progress" />
      </div>
      {comingBack && <p className="text-sm text-muted">↻ This one came back. Give it another go.</p>}
      {current.lesson && !lessonTitle && (
        <p className="text-xs text-muted">
          From{" "}
          <Link href={`/courses/${courseId}/lessons/${current.lesson.id}`} className="underline-offset-2 hover:underline">
            {current.lesson.title}
          </Link>
        </p>
      )}
      <QuestionCard
        key={`${current.question.id}-${round}`}
        q={current.question}
        index={seenIndex}
        bookId={bookId}
        last={comingBack ? null : current.last}
        grading={grading}
        onAttempt={(a) => {
          setAnsweredNow(a);
          setAnswers((n) => n + 1);
          setFirstTry((m) => (m.has(current.question.id) ? m : new Map(m).set(current.question.id, a.correct)));
        }}
      />
      <div className="flex justify-end">
        <Button onClick={next} disabled={!answeredNow}>
          {queue.length === 1 && answeredNow?.correct ? "Finish" : "Next question →"}
        </Button>
      </div>
    </div>
  );
}
