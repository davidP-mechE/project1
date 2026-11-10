"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Markdown } from "@/components/lesson/markdown";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { DesmosButton } from "./desmos";
import { answerMistakeAction } from "@/server/actions/practice";
import { cn } from "@/lib/utils";

export type Practice =
  | { kind: "question"; mistakeId: string; label: string; domain: string; question: { id: string; type: string; prompt: string; choices: string[]; section: string | null; similar: boolean } }
  | { kind: "external"; mistakeId: string; label: string; domain: string; url: string; questionId: string }
  | { kind: "self"; mistakeId: string; label: string; domain: string };

const letter = (i: number) => String.fromCharCode(65 + i);

/** One mistake to practise: answer it (checked here) or retry it on College Board and say how it went. */
export function MistakeReview({ p, desmosKey }: { p: Practice; desmosKey: string | null }) {
  const router = useRouter();
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ correct: boolean; retired: boolean; due: string; feedback: { correctChoice: number | null; answer: string; explanation: string } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = (input: Parameters<typeof answerMistakeAction>[1]) =>
    start(async () => {
      const r = await answerMistakeAction(p.mistakeId, input);
      if (!r.ok) return setError(r.error);
      setError(null);
      setResult(r);
    });

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted">
        {p.label} · {p.domain}
      </p>
      {p.kind === "question" && (
        <>
          {p.question.similar && <p className="text-xs text-muted">A similar question on the same skill:</p>}
          <Markdown>{p.question.prompt}</Markdown>
          {p.question.section === "MATH" && <DesmosButton apiKey={desmosKey} onUse={() => {}} />}
          {p.question.type === "MULTIPLE_CHOICE" ? (
            <fieldset className="flex flex-col gap-2" disabled={Boolean(result)}>
              <legend className="sr-only">Choices</legend>
              {p.question.choices.map((c, k) => (
                <label key={k} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm", result?.feedback?.correctChoice === k ? "border-success bg-success-bg" : choice === k ? "border-primary bg-primary/10" : "border-border")}>
                  <input type="radio" name={`m-${p.mistakeId}`} checked={choice === k} onChange={() => setChoice(k)} className="mt-1 size-4 accent-[var(--primary)]" />
                  <span className="font-semibold text-muted">{letter(k)}.</span>
                  <Markdown className="flex-1 [&_p]:m-0">{c}</Markdown>
                </label>
              ))}
            </fieldset>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Your answer</span>
              <input value={text} onChange={(e) => setText(e.target.value)} disabled={Boolean(result)} className="h-11 rounded-lg border border-border bg-surface px-3" />
            </label>
          )}
          {!result && (
            <div>
              <Button disabled={pending || (p.question.type === "MULTIPLE_CHOICE" ? choice === null : !text.trim())} onClick={() => send({ practiceItemId: p.question.id, ...(p.question.type === "MULTIPLE_CHOICE" ? { choice: choice! } : { response: text }) })}>
                Check
              </Button>
            </div>
          )}
        </>
      )}
      {p.kind === "external" && (
        <>
          <p className="text-sm">
            Try College Board question {p.questionId} again:{" "}
            <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
              open it on College Board<span className="sr-only"> (new tab)</span> ↗
            </a>
          </p>
          {!result && <SelfReport pending={pending} onReport={(r) => send({ selfReport: r })} />}
        </>
      )}
      {p.kind === "self" && (
        <>
          <p className="text-sm">There&apos;s no question on this skill in your program&apos;s bank yet. Review the topic in your notes or with your tutor, then say how confident you feel.</p>
          {!result && <SelfReport pending={pending} onReport={(r) => send({ selfReport: r })} />}
        </>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {result && (
        <Alert tone={result.correct ? "success" : "warning"}>
          <p className="font-medium">{result.correct ? (result.retired ? "Right again: this one's cleared from your log." : "Right!") : "Not quite."} Next review: {new Date(result.due).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}.</p>
          {result.feedback && (
            <p className="mt-1">
              Answer: {result.feedback.correctChoice !== null ? letter(result.feedback.correctChoice) : result.feedback.answer}. {result.feedback.explanation}
            </p>
          )}
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => router.refresh()}>
            Next
          </Button>
        </Alert>
      )}
    </Card>
  );
}

function SelfReport({ pending, onReport }: { pending: boolean; onReport: (r: "CORRECT" | "INCORRECT") => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={pending} onClick={() => onReport("CORRECT")}>
        Got it right
      </Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => onReport("INCORRECT")}>
        Still getting it wrong
      </Button>
    </div>
  );
}
