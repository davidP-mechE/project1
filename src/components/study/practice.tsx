"use client";

import { useId, useRef, useState } from "react";
import { Markdown } from "@/components/lesson/markdown";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { burst } from "@/components/ui/burst";
import { cn } from "@/lib/utils";
import { useSourceKind } from "@/components/course/source-kind";
import { sourceNoun, unitWord } from "@/lib/source-label";
import type { AttemptView } from "@/server/study";

export type PracticeQuestion = {
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
const VERDICT = {
  CORRECT: { label: "Correct", tone: "border-success/40 bg-success-bg text-success", icon: "✓" },
  PARTIAL: { label: "Partly right", tone: "border-warning/40 bg-warning-bg text-warning", icon: "◐" },
  INCORRECT: { label: "Not quite", tone: "border-danger/40 bg-danger-bg text-danger", icon: "✗" },
};
const letter = (i: number) => String.fromCharCode(65 + i);

type Props = {
  items: PracticeQuestion[];
  bookId: string;
  latest: Record<string, AttemptView>;
  /** "claude": written answers are graded by Claude; "demo": rough offline check; null: self-check only. */
  grading: "claude" | "demo" | null;
};

/** Practice questions you can answer: multiple choice is checked instantly, written answers by Claude. */
export function Practice({ items, bookId, latest: initial, grading }: Props) {
  const noun = sourceNoun(useSourceKind());
  const [latest, setLatest] = useState(initial);
  const answered = items.filter((q) => latest[q.id]);
  const correct = answered.filter((q) => latest[q.id].correct).length;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted" aria-live="polite">
        {answered.length === 0
          ? `Answer each question, then check it. Written answers are compared with the ${noun}.`
          : `Score: ${correct} of ${items.length} correct${answered.length < items.length ? ` (${items.length - answered.length} not tried yet)` : ""}.`}
      </p>
      <ol className="flex flex-col gap-4">
        {items.map((q, i) => (
          <li key={q.id}>
            <QuestionCard q={q} index={i} bookId={bookId} last={latest[q.id] ?? null} grading={grading} onAttempt={(a) => setLatest((m) => ({ ...m, [q.id]: a }))} />
          </li>
        ))}
      </ol>
    </div>
  );
}

export function QuestionCard({
  q,
  index,
  bookId,
  last,
  grading,
  onAttempt,
}: {
  q: PracticeQuestion;
  index: number;
  bookId: string;
  last: AttemptView | null;
  grading: Props["grading"];
  onAttempt: (a: AttemptView) => void;
}) {
  const id = useId();
  const noun = sourceNoun(useSourceKind());
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<AttemptView | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mcq = q.type === "MULTIPLE_CHOICE";
  const done = result !== null;
  const showAnswer = done || revealed;

  const cardRef = useRef<HTMLDivElement>(null);

  async function check() {
    setError(null);
    if (mcq && choice === null) return setError("Pick one of the answers first.");
    if (!mcq && !text.trim()) return setError("Write your answer first.");
    setPending(true);
    try {
      const res = await fetch(`/api/questions/${q.id}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mcq ? { choice } : { response: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Your answer couldn't be checked. Please try again.");
        if (res.status === 503) setRevealed(true); // no grader: let them compare themselves
        return;
      }
      setResult(data.attempt);
      onAttempt(data.attempt);
      if (data.attempt.correct) burst(cardRef.current?.querySelector("[data-check]") ?? null, { count: 14, spread: 70 });
    } catch {
      setError("You seem to be offline. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  function retry() {
    setResult(null);
    setRevealed(false);
    setChoice(null);
    setError(null);
  }

  return (
    <div ref={cardRef} className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Question {index + 1} · {TYPE_LABEL[q.type]} · {q.topic}
        </span>
        {!done && last && (
          <span className={cn("rounded px-2 py-0.5", last.correct ? "bg-success-bg text-success" : "bg-surface-2")}>
            Last try: {VERDICT[last.verdict].label.toLowerCase()}
          </span>
        )}
      </div>
      <div id={`${id}-prompt`}>
        <Markdown bookId={bookId}>{q.prompt}</Markdown>
      </div>

      {mcq ? (
        <fieldset className="mt-3" disabled={done || pending}>
          <legend className="sr-only">Choose an answer</legend>
          <div className="flex flex-col gap-1.5">
            {q.choices.map((c, j) => {
              const isCorrect = showAnswer && j === q.correctChoice;
              const isWrongPick = done && result.choice === j && !result.correct;
              return (
                <label
                  key={j}
                  className={cn(
                    "press-soft flex cursor-pointer gap-2 rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
                    isCorrect ? cn("border-success bg-success-bg", done && result.correct && "answer-glow") : isWrongPick ? "nudge border-danger bg-danger-bg" : choice === j ? "border-primary bg-primary/5" : "border-border hover:bg-surface-2",
                    (done || pending) && "cursor-default",
                  )}
                >
                  <input type="radio" name={`${id}-choice`} value={j} checked={choice === j} onChange={() => setChoice(j)} className="sr-only" />
                  <span className="font-semibold text-muted">{letter(j)}.</span>
                  <Markdown className="flex-1 [&_p]:m-0">{c}</Markdown>
                  {isCorrect && <span className="text-success" aria-label="correct answer">✓</span>}
                  {isWrongPick && <span className="text-danger" aria-label="your answer, incorrect">✗</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <div className="mt-3">
          <label htmlFor={`${id}-answer`} className="sr-only">
            Your answer
          </label>
          <textarea
            id={`${id}-answer`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={done || pending}
            rows={q.type === "STEP_BY_STEP" ? 5 : 3}
            maxLength={4000}
            placeholder={q.type === "STEP_BY_STEP" ? "Show your working and the final answer (with units)…" : "Your answer, in a sentence or two…"}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm read-only:bg-surface-2"
          />
          <p className="mt-1 text-xs text-muted">Tip: write math like $x^2$ or plain text like x^2.</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!done && (
          <Button size="sm" onClick={check} disabled={pending} data-check>
            {pending ? (
              <>
                <Spinner /> {mcq ? "Checking…" : `Checking against the ${noun}…`}
              </>
            ) : (
              "Check answer"
            )}
          </Button>
        )}
        {done && (
          <Button size="sm" variant="secondary" onClick={retry}>
            Try again
          </Button>
        )}
        {!showAnswer && (
          <Button size="sm" variant="ghost" onClick={() => setRevealed(true)} disabled={pending}>
            Show the answer
          </Button>
        )}
        {!mcq && !done && grading === null && <span className="text-xs text-muted">Only exact matches can be checked on this server.</span>}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {result && (
        <div role="status" className={cn("mt-3 rounded-lg border p-3 text-sm", VERDICT[result.verdict].tone, result.correct ? "pop-in" : "nudge")}>
          <p className="font-semibold">
            <span aria-hidden>{VERDICT[result.verdict].icon} </span>
            {VERDICT[result.verdict].label}
            {!mcq && result.verdict === "PARTIAL" && ` (${Math.round(result.score * 100)}%)`}
          </p>
          {!mcq && (
            <div className="mt-1 text-text">
              <Markdown bookId={bookId} className="[&_p]:m-0">{result.feedback}</Markdown>
              <p className="mt-1 text-xs text-muted">
                {result.gradedBy === "CLAUDE" ? `Checked by Claude against the ${noun}. It can make mistakes.` : result.gradedBy === "DEMO" ? "Demo check, not Claude." : "Matches the model answer."}
              </p>
            </div>
          )}
        </div>
      )}

      {showAnswer && <AnswerKey q={q} bookId={bookId} />}
    </div>
  );
}

function AnswerKey({ q, bookId }: { q: PracticeQuestion; bookId: string }) {
  const kind = useSourceKind();
  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg bg-surface-2 p-3 text-sm">
      <div>
        <span className="font-semibold">{q.type === "MULTIPLE_CHOICE" ? "Answer: " : "Model answer: "}</span>
        {q.type === "MULTIPLE_CHOICE" && q.correctChoice !== null ? (
          <span>
            {letter(q.correctChoice)}. <Markdown className="inline [&_p]:inline">{q.choices[q.correctChoice] ?? ""}</Markdown>
          </span>
        ) : (
          <Markdown bookId={bookId} className="inline [&_p]:inline">{q.answer}</Markdown>
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
          <Markdown bookId={bookId} className="inline [&_p]:inline">{q.explanation}</Markdown>
        </div>
      )}
      {q.pageRefs.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted">
          In the {sourceNoun(kind)}:
          {q.pageRefs.map((p) => (
            <a key={p} href={`/api/books/${bookId}/file#page=${p}`} data-book-page={p} target="_blank" rel="noopener" className="rounded bg-surface px-1.5 py-0.5 tabular-nums hover:text-text hover:underline">
              {kind === "SLIDES" ? `${unitWord(kind)} ${p}` : `p. ${p}`}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}
