"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BookLoader } from "@/components/ui/book-loader";
import { Markdown } from "@/components/lesson/markdown";
import { bookPageHref } from "@/components/lesson/cite-pages";
import { GoalRing } from "@/components/dashboard/charts";
import { Button, ButtonLink } from "@/components/ui/button";
import { ProgressBar, Spinner } from "@/components/ui/misc";
import { burst } from "@/components/ui/burst";
import { cn } from "@/lib/utils";
import { useSourceKind } from "@/components/course/source-kind";
import { sourceNoun } from "@/lib/source-label";
import type { TestResult } from "@/server/assessments";

type Q = { id: string; type: "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "STEP_BY_STEP"; prompt: string; choices: string[]; topic: string };
type Answer = { choice?: number; response?: string };
const letter = (i: number) => String.fromCharCode(65 + i);
const VERDICT = {
  CORRECT: { label: "Correct", tone: "border-success/40 bg-success-bg", icon: "✓", ink: "text-success" },
  PARTIAL: { label: "Partly right", tone: "border-warning/40 bg-warning-bg", icon: "◐", ink: "text-warning" },
  INCORRECT: { label: "Not quite", tone: "border-danger/40 bg-danger-bg", icon: "✗", ink: "text-danger" },
};

/**
 * Taking a unit test or the final exam: answer everything, then submit once.
 * Answers are kept in this browser while you work (and if grading fails), so
 * nothing is lost on a reload.
 */
export function TestRunner({ assessmentId, bookId, title, questions, backHref }: { assessmentId: string; bookId: string; title: string; questions: Q[]; backHref: string }) {
  const kind = useSourceKind();
  const storageKey = `cb-test-${assessmentId}`;
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [phase, setPhase] = useState<"taking" | "grading" | "results">("taking");
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore a draft (after mount, so server and browser render the same).
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) setAnswers(JSON.parse(saved));
      } catch {
        /* no saved draft */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [storageKey]);
  const save = (next: Record<string, Answer>) => {
    setAnswers(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const answered = useMemo(
    () => questions.filter((q) => (q.type === "MULTIPLE_CHOICE" ? typeof answers[q.id]?.choice === "number" : (answers[q.id]?.response ?? "").trim() !== "")).length,
    [answers, questions],
  );

  async function submit() {
    if (answered < questions.length && !confirm(`You've answered ${answered} of ${questions.length} questions. Unanswered ones count as wrong. Submit anyway?`)) return;
    setError(null);
    setPhase("grading");
    try {
      const res = await fetch(`/api/assessments/${assessmentId}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Your test couldn't be graded. Your answers are kept; please try again.");
      setResult(data);
      setPhase("results");
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (data.score >= 0.8) setTimeout(() => burst(null, { count: 50, spread: 180 }), 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("taking");
    }
  }

  if (phase === "results" && result) return <Results result={result} bookId={bookId} title={title} backHref={backHref} onRetake={() => { setAnswers({}); setResult(null); setPhase("taking"); }} />;

  return (
    <div className="flex flex-col gap-5">
      <div className="sticky top-14 z-10 -mx-4 lg:top-0 flex items-center gap-3 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ProgressBar value={(answered / questions.length) * 100} label="Questions answered" />
          <span className="text-xs text-muted" aria-live="polite">
            {answered} of {questions.length} answered
          </span>
        </div>
        <Button onClick={submit} disabled={phase === "grading"}>
          {phase === "grading" ? (
            <>
              <Spinner /> Checking…
            </>
          ) : (
            "Submit test"
          )}
        </Button>
      </div>
      {phase === "grading" && (
        <div className="flex items-center gap-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm">
          <BookLoader label="Checking" className="shrink-0 scale-75" />
          <p role="status">Checking your answers. Written answers are compared with the {sourceNoun(kind)} by Claude, which takes a few seconds…</p>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-bg px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <ol className="flex flex-col gap-4">
        {questions.map((q, i) => (
          <li key={q.id} className="rounded-xl border border-border bg-surface p-4">
            <p className="mb-2 text-xs text-muted">
              Question {i + 1} of {questions.length}
            </p>
            <Markdown bookId={bookId}>{q.prompt}</Markdown>
            {q.type === "MULTIPLE_CHOICE" ? (
              <fieldset className="mt-3" disabled={phase === "grading"}>
                <legend className="sr-only">Choose an answer</legend>
                <div className="flex flex-col gap-1.5">
                  {q.choices.map((c, j) => (
                    <label
                      key={j}
                      className={cn(
                        "press-soft flex cursor-pointer gap-2 rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
                        answers[q.id]?.choice === j ? "border-primary bg-primary/5" : "border-border hover:bg-surface-2",
                      )}
                    >
                      <input type="radio" name={q.id} className="sr-only" checked={answers[q.id]?.choice === j} onChange={() => save({ ...answers, [q.id]: { choice: j } })} />
                      <span className="choice-letter">{letter(j)}<span className="sr-only">.</span></span>
                      <Markdown className="flex-1 [&_p]:m-0">{c}</Markdown>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <div className="mt-3">
                <label htmlFor={`a-${q.id}`} className="sr-only">
                  Your answer
                </label>
                <textarea
                  id={`a-${q.id}`}
                  rows={q.type === "STEP_BY_STEP" ? 5 : 3}
                  maxLength={4000}
                  value={answers[q.id]?.response ?? ""}
                  onChange={(e) => save({ ...answers, [q.id]: { response: e.target.value } })}
                  readOnly={phase === "grading"}
                  placeholder={q.type === "STEP_BY_STEP" ? "Show your working and the final answer…" : "Your answer…"}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                />
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="flex justify-between gap-2">
        <ButtonLink href={backHref} variant="ghost">
          Leave (answers are kept)
        </ButtonLink>
        <Button onClick={submit} disabled={phase === "grading"}>
          Submit test
        </Button>
      </div>
    </div>
  );
}

function Results({ result, bookId, title, backHref, onRetake }: { result: TestResult; bookId: string; title: string; backHref: string; onRetake: () => void }) {
  const kind = useSourceKind();
  const pct = Math.round(result.score * 100);
  const message = pct >= 90 ? "Excellent! You know this material." : pct >= 75 ? "Good work. A few things to tidy up." : pct >= 50 ? "Getting there. Review the topics below and try again." : "Worth another pass. Revisit the lessons below, then retake the test.";
  const weak = [...new Set(result.questions.filter((q) => q.score < 0.8).map((q) => q.topic))];
  return (
    <div className="flex flex-col gap-6">
      <div className="pop-in flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-6 text-center sm:flex-row sm:text-left">
        <GoalRing minutes={pct} target={100} score={{ passed: pct >= 80 }} />
        <div className="flex-1">
          <p className="text-sm text-muted">{title}</p>
          <h2 className="text-2xl font-semibold">
            {pct}% · {result.correct} of {result.total} correct
          </h2>
          <p className="mt-1 text-sm text-muted">{message}</p>
          {weak.length > 0 && (
            <p className="mt-2 text-sm">
              <span className="font-medium">To revisit:</span> {weak.slice(0, 6).join(", ")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={onRetake} variant="secondary">
            Retake test
          </Button>
          <ButtonLink href={backHref} variant="ghost">
            Back
          </ButtonLink>
        </div>
      </div>
      <ol className="flex flex-col gap-3">
        {result.questions.map((q, i) => {
          const v = VERDICT[q.verdict];
          return (
            <li key={q.id}>
              <details open={q.score < 0.8} className={cn("rounded-xl border p-4", v.tone)}>
                <summary className="flex cursor-pointer items-start gap-2">
                  <span className={cn("font-semibold", v.ink)} aria-hidden>
                    {v.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-xs text-muted">
                      Question {i + 1} · {v.label} · {q.topic}
                    </span>
                    <Markdown bookId={bookId} className="[&_p]:m-0">{q.prompt}</Markdown>
                  </span>
                </summary>
                <div className="mt-3 flex flex-col gap-2 border-t border-black/10 pt-3 text-sm dark:border-white/10">
                  {q.type === "MULTIPLE_CHOICE" ? (
                    <p>
                      <span className="font-medium">Your answer:</span> {q.yourChoice === null ? "not answered" : `${letter(q.yourChoice)}. ${q.choices[q.yourChoice] ?? ""}`}
                      <br />
                      <span className="font-medium">Correct answer:</span> {q.correctChoice !== null ? `${letter(q.correctChoice)}. ${q.choices[q.correctChoice]}` : q.answer}
                    </p>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap">
                        <span className="font-medium">Your answer:</span> {q.yourResponse || "not answered"}
                      </p>
                      {q.gradedBy !== "LOCAL" && <Markdown bookId={bookId} className="[&_p]:m-0">{q.feedback}</Markdown>}
                      <div>
                        <span className="font-medium">Model answer: </span>
                        <Markdown bookId={bookId} className="inline [&_p]:inline">{q.answer}</Markdown>
                      </div>
                    </>
                  )}
                  {q.steps.length > 0 && (
                    <ol className="list-decimal pl-6">
                      {q.steps.map((s, j) => (
                        <li key={j}>
                          <Markdown className="[&_p]:m-0">{s}</Markdown>
                        </li>
                      ))}
                    </ol>
                  )}
                  {q.explanation && (
                    <div>
                      <span className="font-medium">Why: </span>
                      <Markdown bookId={bookId} className="inline [&_p]:inline">{q.explanation}</Markdown>
                    </div>
                  )}
                  {q.pageRefs.length > 0 && (
                    <p className="flex flex-wrap gap-1 text-xs text-muted">
                      In the {sourceNoun(kind)}:
                      {q.pageRefs.map((p) => (
                        <a key={p} href={bookPageHref(bookId, p)} target="_blank" rel="noopener" className="rounded bg-surface px-1.5 tabular-nums hover:underline">
                          {kind === "SLIDES" ? "slide" : "p."} {p}
                        </a>
                      ))}
                    </p>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
      <p className="text-center text-sm">
        <Link href={backHref} className="text-primary hover:underline">
          ← Back
        </Link>
      </p>
    </div>
  );
}
