"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Markdown } from "@/components/lesson/markdown";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, ProgressBar } from "@/components/ui/misc";
import { inputClasses } from "@/components/ui/field";
import { answerPracticeAction, finishPracticeAction, startPracticeAction } from "@/server/actions/bank";
import { cn } from "@/lib/utils";
import { CalculatorPanel } from "@/components/desmos/calculator-panel";
import { QuestionDesmosCheck } from "@/components/desmos/desmos-check";

export type Feedback = {
  given: string;
  correct: boolean;
  likelyMistake: string | null;
  correctAnswer: string;
  explanation: string;
  desmosState: object | null;
  desmosTechnique: string | null;
  toolkitLesson: { title: string; href: string } | null;
};
export type PlayerQuestion = { id: string; type: "mcq" | "grid_in"; section: string; stem: string; choices: string[]; imageUrl: string | null; skill: string | null; difficulty: number };
export type PlayerState = {
  sessionId: string;
  setId: string;
  title: string;
  calculator: "ALLOWED" | "BY_HAND";
  assignmentId: string | null;
  endsAt: string | null;
  finishedAt: string | null;
  isAuthor: boolean;
  questions: PlayerQuestion[];
  answers: Record<string, Feedback>;
};

const LETTERS = ["A", "B", "C", "D"];

function useClock(endsAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000));
}

/** Start a set, timed or untimed. */
export function StartPractice({ setId, assignmentId, hasLimit, forcedTimed }: { setId: string; assignmentId: string | null; hasLimit: boolean; forcedTimed: boolean }) {
  const router = useRouter();
  const [timed, setTimed] = useState(forcedTimed);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      {!forcedTimed && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> Timed{hasLimit ? "" : " (about 1.6 minutes a question, like the SAT)"}
        </label>
      )}
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await startPracticeAction(setId, { assignmentId, timed });
              if (!r.ok) return setError(r.error);
              router.push(`/practice/play/${r.sessionId}`);
            })
          }
        >
          Start
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/**
 * The practice player: one question at a time, instant feedback with the
 * explanation, and "Likely mistake" when a wrong answer matches a distractor.
 * `calculator` and `desmosCheck` are slots for the Desmos panel and check graph.
 */
export function PracticePlayer({ state, desmosKey }: { state: PlayerState; desmosKey: string | null }) {
  // One calculator per sitting (kept between questions); none on "by hand" assignments or R&W-only sets.
  const calculator = state.questions.some((x) => x.section === "math") ? <CalculatorPanel apiKey={desmosKey} storageKey={state.sessionId} byHand={state.calculator === "BY_HAND"} /> : null;
  const desmosCheck = (s: object) => <QuestionDesmosCheck apiKey={desmosKey} state={s} />;
  const router = useRouter();
  const [i, setI] = useState(() => Math.max(0, state.questions.findIndex((q) => !state.answers[q.id])));
  const [answers, setAnswers] = useState<Record<string, Feedback>>(state.answers);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<{ correct: number; answered: number } | null>(state.finishedAt ? summary(state.answers) : null);
  const [pending, start] = useTransition();
  const shownAt = useRef(0);
  const left = useClock(finished ? null : state.endsAt);
  const timeUp = left === 0;
  const q = state.questions[i];
  const fb = q ? answers[q.id] : undefined;
  const answeredCount = Object.keys(answers).length;

  useEffect(() => {
    shownAt.current = Date.now();
  }, [i]);

  function summary(a: Record<string, Feedback>) {
    const list = Object.values(a);
    return { correct: list.filter((x) => x.correct).length, answered: list.length };
  }

  const check = () => {
    if (!q) return;
    const given = (draft[q.id] ?? "").trim();
    if (!given) return setError(q.type === "mcq" ? "Pick an answer first." : "Type an answer first.");
    setError(null);
    start(async () => {
      const r = await answerPracticeAction(state.sessionId, q.id, given, (Date.now() - shownAt.current) / 1000);
      if (!r.ok) return setError(r.error);
      setAnswers((a) => ({ ...a, [q.id]: r.feedback }));
    });
  };
  const finish = () =>
    start(async () => {
      const r = await finishPracticeAction(state.sessionId);
      if (!r.ok) return setError(r.error);
      setFinished(r.result);
      router.refresh();
    });

  if (state.questions.length === 0) return <Alert tone="info">This set has no published questions yet.</Alert>;

  if (finished) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <h2 className="text-xl font-semibold">
          {finished.correct} of {state.questions.length} correct
        </h2>
        <p className="text-sm text-muted">{finished.answered < state.questions.length ? `You answered ${finished.answered} of ${state.questions.length}. ` : ""}These results count toward your Coursebook practice on the insights page.</p>
        <ul className="w-full divide-y divide-border rounded border border-border text-sm">
          {state.questions.map((x, n) => (
            <li key={x.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-8 tabular-nums text-muted">{n + 1}.</span>
              <span className={cn("font-semibold", answers[x.id] ? (answers[x.id].correct ? "text-success" : "text-danger") : "text-muted")}>{answers[x.id] ? (answers[x.id].correct ? "Correct" : "Incorrect") : "Not answered"}</span>
              <span className="text-muted">{x.skill}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/practice/${state.setId}${state.assignmentId ? `?assignment=${state.assignmentId}` : ""}`} variant="secondary">Practise again</ButtonLink>
          <ButtonLink href={state.assignmentId ? "/classes" : "/practice"}>Done</ButtonLink>
        </div>
      </Card>
    );
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ProgressBar value={(answeredCount / state.questions.length) * 100} label={`${answeredCount} of ${state.questions.length} answered`} className="min-w-40 flex-1" />
        <span className="text-sm tabular-nums text-muted">
          {answeredCount}/{state.questions.length}
        </span>
        {left !== null && (
          <span role="timer" aria-live="off" className={cn("rounded px-2 py-1 text-sm font-semibold tabular-nums", left < 60 ? "bg-danger-bg text-danger" : "bg-surface-2")}>
            {fmt(left)}
          </span>
        )}
        {calculator}
      </div>
      {timeUp && <Alert tone="warning">Time&apos;s up. Finish the set to see your results.</Alert>}
      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            Question {i + 1} of {state.questions.length}
          </span>
          <span>
            {q.skill} · difficulty {q.difficulty}
          </span>
        </div>
        <div className="overflow-x-auto">
          <Markdown>{q.stem}</Markdown>
        </div>
        {q.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.imageUrl} alt="Figure for this question" className="max-h-80 max-w-full rounded border border-border" />
        )}
        {q.type === "mcq" ? (
          <fieldset className="flex flex-col gap-2" disabled={Boolean(fb) || timeUp}>
            <legend className="sr-only">Choices</legend>
            {q.choices.map((c, n) => {
              const L = LETTERS[n];
              const picked = (fb?.given ?? draft[q.id]) === L;
              const isRight = fb && fb.correctAnswer.startsWith(L);
              return (
                <label
                  key={L}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border-[1.5px] px-3 py-2 text-sm",
                    fb && isRight ? "border-success bg-success-bg" : fb && picked ? "border-danger bg-danger-bg" : picked ? "border-focus bg-surface-2" : "border-border",
                  )}
                >
                  <input type="radio" name={`q-${q.id}`} value={L} checked={picked} onChange={() => setDraft({ ...draft, [q.id]: L })} className="mt-1" />
                  <span className="font-semibold">{L}.</span>
                  <span className="min-w-0 flex-1">
                    <Markdown>{c}</Markdown>
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : (
          <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
            Your answer
            <input
              className={inputClasses}
              inputMode="text"
              autoComplete="off"
              value={fb?.given ?? draft[q.id] ?? ""}
              disabled={Boolean(fb) || timeUp}
              onChange={(e) => setDraft({ ...draft, [q.id]: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && check()}
              placeholder="e.g. 3/4 or 0.75"
            />
            <span className="text-xs font-normal text-muted">Fractions or decimals. For a decimal that doesn&apos;t end, use at least 3 places.</span>
          </label>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {fb ? (
          <div className={cn("flex flex-col gap-2 rounded-lg border-[1.5px] p-3", fb.correct ? "border-success bg-success-bg" : "border-danger bg-danger-bg")} role="status">
            <p className={cn("font-semibold", fb.correct ? "text-success" : "text-danger")}>{fb.correct ? "Correct" : `Not quite. The answer is ${fb.correctAnswer}.`}</p>
            {fb.likelyMistake && (
              <p className="text-sm text-text">
                <span className="font-semibold">Likely mistake:</span> {fb.likelyMistake}
              </p>
            )}
            {fb.explanation && (
              <div className="text-sm text-text">
                <Markdown>{fb.explanation}</Markdown>
              </div>
            )}
            {fb.desmosState && desmosCheck(fb.desmosState)}
            {fb.desmosTechnique && (
              <p className="text-sm text-text">
                Desmos technique: <span className="font-semibold">{fb.desmosTechnique}</span>
                {fb.toolkitLesson && (
                  <>
                    {" · "}
                    <a href={fb.toolkitLesson.href} className="underline">
                      {fb.toolkitLesson.title} (Desmos Toolkit)
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
        ) : (
          <div>
            <Button onClick={check} disabled={pending || timeUp}>
              Check
            </Button>
          </div>
        )}
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={i === 0} onClick={() => setI(i - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={i === state.questions.length - 1} onClick={() => setI(i + 1)}>
          Next
        </Button>
        <Button className="ml-auto" disabled={pending} onClick={() => (answeredCount < state.questions.length && !timeUp ? confirm(`Finish with ${state.questions.length - answeredCount} unanswered?`) && finish() : finish())}>
          Finish
        </Button>
      </div>
      <nav aria-label="Questions" className="flex flex-wrap gap-1">
        {state.questions.map((x, n) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setI(n)}
            aria-current={n === i ? "step" : undefined}
            aria-label={`Question ${n + 1}${answers[x.id] ? (answers[x.id].correct ? ", correct" : ", incorrect") : ""}`}
            className={cn(
              "h-9 w-9 rounded border text-xs tabular-nums",
              n === i ? "border-focus font-bold" : "border-border",
              answers[x.id] ? (answers[x.id].correct ? "bg-success-bg text-success" : "bg-danger-bg text-danger") : "bg-surface",
            )}
          >
            {n + 1}
          </button>
        ))}
      </nav>
    </div>
  );
}
