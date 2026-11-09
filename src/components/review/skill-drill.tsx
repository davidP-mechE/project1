"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { QuestionCard, type PracticeQuestion } from "@/components/study/practice";
import { Button, ButtonLink } from "@/components/ui/button";
import { BookLoader } from "@/components/ui/book-loader";
import { burst } from "@/components/ui/burst";
import { HAMMER_STREAK } from "@/lib/mastery/review";
import { requeue } from "@/lib/mastery/mastery";
import { cn } from "@/lib/utils";
import type { AttemptView } from "@/server/study";

type Item = { question: PracticeQuestion; lesson: { id: string; title: string } | null; last: AttemptView | null };

/**
 * Review: hammer one skill. Questions on the skill come one at a time; a miss
 * comes back a few questions later. When the questions run low, Claude writes
 * five more on the same skill, so it keeps going until the student gets
 * HAMMER_STREAK right in a row (and after that, as long as they like).
 */
export function SkillDrill({ courseId, bookId, skillKey, topic, items, grading, canGenerate }: { courseId: string; bookId: string; skillKey: string; topic: string; items: Item[]; grading: "claude" | "demo" | null; canGenerate: boolean }) {
  const [pool, setPool] = useState(() => new Map(items.map((i) => [i.question.id, i])));
  const [queue, setQueue] = useState(() => items.map((i) => i.question.id));
  const [answered, setAnswered] = useState<AttemptView | null>(null);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [count, setCount] = useState({ answered: 0, right: 0 });
  const [round, setRound] = useState(0);
  const [retries, setRetries] = useState(new Map<string, number>());
  const [hammered, setHammered] = useState(false);
  const [writing, setWriting] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [written, setWritten] = useState(0);
  const meterRef = useRef<HTMLDivElement>(null);

  const current = queue[0] ? pool.get(queue[0]) : null;

  const writeMore = useCallback(async () => {
    if (writing || !canGenerate) return;
    setWriting(true);
    setGenError(null);
    try {
      const res = await fetch("/api/review/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, skill: skillKey }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't write new questions.");
      const fresh: Item[] = data.items;
      setPool((p) => {
        const next = new Map(p);
        for (const i of fresh) next.set(i.question.id, i);
        return next;
      });
      setQueue((q) => [...q, ...fresh.map((i) => i.question.id)]);
      setWritten((n) => n + fresh.length);
    } catch (err) {
      setGenError((err as Error).message);
    } finally {
      setWriting(false);
    }
  }, [writing, canGenerate, courseId, skillKey]);

  // Very few questions to start with: ask for more right away (once).
  const started = useRef(false);
  useEffect(() => {
    if (started.current || items.length > 2) return;
    started.current = true;
    const t = setTimeout(() => void writeMore(), 0);
    return () => clearTimeout(t);
  }, [items.length, writeMore]);

  const next = () => {
    const correct = answered?.correct ?? false;
    const counts = new Map(retries);
    // In Review, a question answered right also goes round again later (unless the skill is hammered), so the drill never runs dry too soon.
    let q = requeue(queue, queue[0], correct, counts, 3, 2);
    if (correct && q.length < 3 && !hammered) q = [...q, queue[0]];
    setQueue(q);
    setRetries(counts);
    // Running low: ask for more in the background, so there's always a next question.
    if (q.length <= 2 && !hammered && !genError) void writeMore();
    setAnswered(null);
    setRound((r) => r + 1);
  };

  const onAttempt = (a: AttemptView) => {
    setAnswered(a);
    setCount((c) => ({ answered: c.answered + 1, right: c.right + (a.correct ? 1 : 0) }));
    const s = a.correct ? streak + 1 : 0;
    setStreak(s);
    setBest((b) => Math.max(b, s));
    if (s >= HAMMER_STREAK && !hammered) {
      setHammered(true);
      setTimeout(() => burst(meterRef.current, { count: 40, spread: 140 }), 50);
    }
  };

  const comingBack = current ? (retries.get(current.question.id) ?? 0) > 0 : false;

  return (
    <div className="flex flex-col gap-5">
      <div ref={meterRef} className="hero-card flex flex-col gap-4 rounded-3xl p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold opacity-85">Hammering a skill</p>
            <h2 className="mt-1 text-2xl font-semibold sm:text-3xl">{topic}</h2>
          </div>
          <p className="text-sm font-semibold" aria-live="polite">
            {hammered ? "Hammered! 🌕" : `${streak} of ${HAMMER_STREAK} right in a row`}
          </p>
        </div>
        <div className="flex gap-1.5" role="img" aria-label={`${Math.min(streak, HAMMER_STREAK)} of ${HAMMER_STREAK} right in a row`}>
          {Array.from({ length: HAMMER_STREAK }, (_, i) => (
            <span key={i} className={cn("h-2.5 flex-1 rounded-full transition-colors", i < streak || hammered ? "hero-fill" : "hero-track")} />
          ))}
        </div>
        <p className="text-sm opacity-85">
          {count.answered} answered · {count.right} right · best run {best}
          {written > 0 && ` · ${written} new questions written for you`}
        </p>
      </div>

      {hammered && (
        <div className="pop-in flex flex-col items-start gap-3 rounded-2xl border border-success/40 bg-success-bg p-5 text-success">
          <p className="font-semibold">You got {HAMMER_STREAK} right in a row: this skill is hammered.</p>
          <p className="text-sm">It will come back in spaced repetition to make sure it sticks. Keep going if you want more practice.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setHammered(false)} variant="secondary">
              Keep going
            </Button>
            <ButtonLink href="/skills" variant="ghost">
              Back to Review
            </ButtonLink>
          </div>
        </div>
      )}

      {!hammered && current && (
        <>
          {comingBack && <p className="text-sm text-muted">↻ This one came back. Give it another go.</p>}
          {current.lesson && (
            <p className="text-xs text-muted">
              From{" "}
              <Link href={`/courses/${courseId}/lessons/${current.lesson.id}`} className="underline-offset-2 hover:underline">
                {current.lesson.title}
              </Link>
            </p>
          )}
          <QuestionCard key={`${current.question.id}-${round}`} q={current.question} index={answered ? count.answered - 1 : count.answered} bookId={bookId} last={null} grading={grading} onAttempt={onAttempt} />
          <div className="flex items-center justify-end gap-3">
            {writing && <span className="text-sm text-muted">Writing more questions…</span>}
            <Button onClick={next} disabled={!answered}>
              Next question →
            </Button>
          </div>
        </>
      )}

      {!hammered && !current && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-8 text-center">
          {writing ? (
            <BookLoader label="Claude is writing new questions on this skill…" showLabel />
          ) : (
            <>
              <p className="font-semibold">That&apos;s every question on this skill for now.</p>
              {genError ? <p className="text-sm text-danger">{genError}</p> : !canGenerate && <p className="text-sm text-muted">New questions need Claude (an API key on the server).</p>}
              <div className="flex flex-wrap justify-center gap-2">
                {canGenerate && <Button onClick={() => void writeMore()}>Write more questions</Button>}
                <Button variant="secondary" onClick={() => window.location.reload()}>
                  Start over
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {genError && current && <p className="text-sm text-danger">{genError}</p>}
    </div>
  );
}
