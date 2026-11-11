"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Markdown } from "@/components/lesson/markdown";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, ProgressBar } from "@/components/ui/misc";
import { burst } from "@/components/ui/burst";
import { handInAction, startQuestionsAction } from "@/server/actions/classes";
import { cn } from "@/lib/utils";

type Key = { correctChoice: number | null; answer: string; explanation: string; steps: string[] };
type Mine = { choice: number | null; response: string; correct?: boolean; score?: number; verdict?: string; feedback?: string; gradedBy?: string };
export type SetQuestion = { id: string; number: number; label: string; type: "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "STEP_BY_STEP"; prompt: string; choices: string[]; topic: string; answer: Key | null; mine: Mine | null };
export type QuestionSetData = {
  id: string;
  title: string;
  timeLimitMin: number | null;
  started: boolean;
  endsAt: string | null;
  handedIn: boolean;
  reveal: boolean;
  questions: SetQuestion[];
};

const letter = (i: number) => String.fromCharCode(65 + i);
const VERDICT: Record<string, { label: string; tone: string }> = {
  CORRECT: { label: "Correct", tone: "border-success bg-success-bg text-success" },
  PARTIAL: { label: "Partly right", tone: "border-warning bg-warning-bg text-warning" },
  INCORRECT: { label: "Not quite", tone: "border-danger bg-danger-bg text-danger" },
};

/** The clock for a timed set, ticking down to the server's end time. */
export function Countdown({ endsAt, onEnd }: { endsAt: string; onEnd: () => void }) {
  const [left, setLeft] = useState(() => new Date(endsAt).getTime() - Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      const ms = new Date(endsAt).getTime() - Date.now();
      setLeft(ms);
      if (ms <= 0) {
        clearInterval(t);
        onEnd();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [endsAt, onEnd]);
  const s = Math.max(0, Math.round(left / 1000));
  const low = s < 5 * 60;
  return (
    <span role="timer" aria-live={low ? "polite" : "off"} className={cn("rounded-full px-3 py-1 text-sm font-semibold tabular-nums", low ? "bg-danger-bg text-danger" : "bg-surface-2")}>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")} left
    </span>
  );
}

function QuestionCard({ assignmentId, q, timed, locked, onSaved }: { assignmentId: string; q: SetQuestion; timed: boolean; locked: boolean; onSaved: (id: string, mine: Mine, key: Key | null) => void }) {
  const [choice, setChoice] = useState<number | null>(q.mine?.choice ?? null);
  const [text, setText] = useState(q.mine?.response ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mcq = q.type === "MULTIPLE_CHOICE";
  const result = q.mine && q.mine.verdict ? q.mine : null;
  // After checking an answer the button can disappear: move focus to the result
  // so keyboard and screen-reader users land on the feedback, not the page top.
  const resultRef = useRef<HTMLDivElement>(null);
  const focusResult = useRef(false);
  useEffect(() => {
    if (focusResult.current && result) {
      focusResult.current = false;
      resultRef.current?.focus();
    }
  }, [result]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mcq ? choice === null : !text.trim()) return setError(mcq ? "Choose an answer first." : "Write an answer first.");
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mcq ? { itemId: q.id, choice } : { itemId: q.id, response: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? "Your answer couldn't be saved. Try again.");
      const r = data.result as { correct?: boolean; score?: number; verdict?: string; feedback?: string; gradedBy?: string; answer?: Key };
      if (r.verdict) focusResult.current = true;
      onSaved(q.id, { choice: mcq ? choice : null, response: mcq ? "" : text, ...(r.verdict ? { correct: r.correct, score: r.score, verdict: r.verdict, feedback: r.feedback, gradedBy: r.gradedBy } : {}) }, r.answer ?? null);
      if (r.correct) burst((e.target as HTMLElement).querySelector("button[type=submit]"), { count: 12, spread: 60 });
    } catch {
      setError("You seem to be offline. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="text-xs text-muted">
        Question {q.number} (#{q.label}) · {q.topic}
      </p>
      <Markdown>{q.prompt}</Markdown>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {mcq ? (
          <fieldset disabled={locked || pending} className="flex flex-col gap-1.5">
            <legend className="sr-only">Choose an answer</legend>
            {q.choices.map((c, j) => {
              const right = q.answer && j === q.answer.correctChoice;
              const wrongPick = result && !result.correct && q.mine?.choice === j;
              return (
                <label
                  key={j}
                  className={cn(
                    "flex cursor-pointer gap-2 rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
                    right ? "border-success bg-success-bg" : wrongPick ? "border-danger bg-danger-bg" : choice === j ? "border-primary bg-surface-2" : "border-border hover:bg-surface-2",
                  )}
                >
                  <input type="radio" name={`q-${q.id}`} checked={choice === j} onChange={() => setChoice(j)} className="sr-only" />
                  <span className="font-semibold text-muted">{letter(j)}.</span>
                  <Markdown className="flex-1 [&_p]:m-0">{c}</Markdown>
                  {right && <span className="text-success" aria-label="correct answer">✓</span>}
                </label>
              );
            })}
          </fieldset>
        ) : (
          <div>
            <label htmlFor={`a-${q.id}`} className="sr-only">
              Your answer to question {q.number}
            </label>
            <textarea
              id={`a-${q.id}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              readOnly={locked || pending}
              rows={q.type === "STEP_BY_STEP" ? 5 : 3}
              maxLength={4000}
              placeholder={q.type === "STEP_BY_STEP" ? "Show your working and the final answer…" : "Your answer…"}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm read-only:bg-surface-2"
            />
          </div>
        )}
        {!locked && (
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Checking…" : timed ? (q.mine ? "Update answer" : "Save answer") : q.mine ? "Try again" : "Check answer"}
            </Button>
            {timed && q.mine && <span className="text-xs text-muted">Saved</span>}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
      {result && (
        <div ref={resultRef} tabIndex={-1} role="status" className={cn("rounded-lg border p-3 text-sm", VERDICT[result.verdict!]?.tone)}>
          <p className="font-semibold">{VERDICT[result.verdict!]?.label ?? result.verdict}</p>
          {result.feedback && <Markdown className="mt-1 text-text [&_p]:m-0">{result.feedback}</Markdown>}
        </div>
      )}
      {q.answer && (
        <details className="rounded-lg bg-surface-2 p-3 text-sm">
          <summary className="font-medium">Answer and explanation</summary>
          <div className="mt-2 flex flex-col gap-2">
            {!mcq && <Markdown className="[&_p]:m-0">{`**Answer:** ${q.answer.answer}`}</Markdown>}
            {q.answer.steps.length > 0 && (
              <ol className="list-decimal pl-5">
                {q.answer.steps.map((s, i) => (
                  <li key={i}>
                    <Markdown className="[&_p]:m-0">{s}</Markdown>
                  </li>
                ))}
              </ol>
            )}
            {q.answer.explanation && <Markdown className="[&_p]:m-0">{q.answer.explanation}</Markdown>}
          </div>
        </details>
      )}
    </Card>
  );
}

/**
 * An assigned question set. Untimed: each answer is checked right away and can
 * be tried again. Timed: start the clock (kept on the server), answers are
 * saved, and results show once it's handed in or time is up.
 */
export function QuestionSet({ data }: { data: QuestionSetData }) {
  const router = useRouter();
  const [questions, setQuestions] = useState(data.questions);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const timed = Boolean(data.timeLimitMin);
  const answered = questions.filter((q) => q.mine).length;
  const locked = data.handedIn || (timed && !data.started);

  const onSaved = (id: string, mine: Mine, key: Key | null) => setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, mine, answer: key ?? q.answer } : q)));
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      router.refresh();
    });

  if (timed && !data.started && !data.handedIn) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <h2 className="text-lg font-semibold">Timed: {data.timeLimitMin} minutes</h2>
        <p className="text-sm text-muted">
          {questions.length} questions. The clock starts when you press Start and keeps running if you leave the page. You&apos;ll see your results when you hand in or time runs out.
        </p>
        {error && <Alert tone="error">{error}</Alert>}
        <Button disabled={pending} onClick={() => act(() => startQuestionsAction(data.id))}>
          Start ({data.timeLimitMin} min)
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-14 z-[5] -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bg/95 px-1 py-2 backdrop-blur lg:top-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-sm tabular-nums text-muted" aria-live="polite">
            {answered} of {questions.length} answered
          </span>
          <ProgressBar value={(answered / Math.max(1, questions.length)) * 100} label="Questions answered" />
        </div>
        {timed && data.endsAt && !data.handedIn && <Countdown endsAt={data.endsAt} onEnd={() => router.refresh()} />}
        {!data.handedIn && (
          <Button
            size="sm"
            variant={answered === questions.length ? "primary" : "secondary"}
            disabled={pending}
            onClick={() => {
              if (answered < questions.length && !window.confirm(`Hand in with ${questions.length - answered} unanswered? You can't change answers after.`)) return;
              act(() => handInAction(data.id));
            }}
          >
            Hand in
          </Button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {data.handedIn && (
        <Alert tone="success">
          Handed in. {data.reveal ? `You got ${questions.filter((q) => q.mine?.correct).length} of ${questions.length} right.` : ""} Open each answer to see the explanation.
        </Alert>
      )}
      {questions.map((q) => (
        <QuestionCard key={q.id} assignmentId={data.id} q={q} timed={timed} locked={locked} onSaved={onSaved} />
      ))}
    </div>
  );
}
