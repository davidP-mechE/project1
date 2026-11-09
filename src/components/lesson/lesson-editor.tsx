"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { saveLessonEditsAction } from "@/server/actions/generation";
import type { LessonContent, LessonEdit, StoredFlashcard, StoredQuestion } from "@/lib/ai/lesson-schema";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

/**
 * Hand-edit everything in a lesson. Text fields accept Markdown and LaTeX
 * math ($...$). Saving marks the lesson as edited, so regenerating the course
 * won't overwrite it unless you ask.
 */

const textareaClasses = cn(inputClasses, "h-auto min-h-20 py-2 font-mono text-sm leading-relaxed");
const pagesToText = (p: number[]) => p.join(", ");
const textToPages = (s: string) =>
  s
    .split(/[,\s]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
const linesToList = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

function Text({ label, value, onChange, rows = 3, mono = true, hint }: { label: string; value: string; onChange: (v: string) => void; rows?: number; mono?: boolean; hint?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={cn(textareaClasses, !mono && "font-sans")} />
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Line({ label, value, onChange, className }: { label: string; value: string; onChange: (v: string) => void; className?: string }) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputClasses} />
    </div>
  );
}

/** A page-number list typed as "4, 5". Keeps its own text while typing. */
function Pages({ value, onChange }: { value: number[]; onChange: (p: number[]) => void }) {
  const [text, setText] = useState(pagesToText(value));
  return <Line label="Book pages" value={text} onChange={(v) => { setText(v); onChange(textToPages(v)); }} className="sm:w-40" />;
}

/** A list of items with add / remove / move buttons. */
function ListEditor<T>({ title, items, onChange, make, render, itemLabel }: { title: string; items: T[]; onChange: (items: T[]) => void; make: () => T; render: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode; itemLabel: string }) {
  const update = (i: number, patch: Partial<T>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-lg font-semibold">
        {title} <span className="text-sm font-normal text-muted">({items.length})</span>
      </legend>
      {items.map((item, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-muted">
              {itemLabel} {i + 1}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${itemLabel} ${i + 1} up`}>
                ↑
              </Button>
              <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Move ${itemLabel} ${i + 1} down`}>
                ↓
              </Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Delete ${itemLabel} ${i + 1}`}>
                Delete
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-3">{render(item, (p) => update(i, p), i)}</div>
        </div>
      ))}
      <div>
        <Button variant="secondary" size="sm" onClick={() => onChange([...items, make()])}>
          Add {itemLabel.toLowerCase()}
        </Button>
      </div>
    </fieldset>
  );
}

type Props = { courseId: string; lessonId: string; pageStart: number; initial: LessonEdit };

export function LessonEditor({ courseId, lessonId, pageStart, initial }: Props) {
  const router = useRouter();
  const [content, setContent] = useState<LessonContent>(initial.content);
  const [questions, setQuestions] = useState<StoredQuestion[]>(initial.questions);
  const [flashcards, setFlashcards] = useState<StoredFlashcard[]>(initial.flashcards);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [initialJson] = useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify({ content, questions, flashcards }) !== initialJson;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await saveLessonEditsAction(courseId, lessonId, { content, questions, flashcards });
      if (!res.ok) {
        setError(res.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      router.push(`/courses/${courseId}/lessons/${lessonId}`);
      router.refresh();
    });

  return (
    <form
      className="flex flex-col gap-10"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}

      <Text
        label="Learning objectives (one per line)"
        value={content.objectives.join("\n")}
        onChange={(v) => setContent({ ...content, objectives: linesToList(v) })}
        rows={4}
        mono={false}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold">Explanation</span>
          <div role="tablist" aria-label="Explanation view" className="flex gap-1 rounded-lg bg-surface-2 p-1 text-sm">
            {(["Write", "Preview"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={(t === "Preview") === preview}
                onClick={() => setPreview(t === "Preview")}
                className={cn("rounded-md px-3 py-1", (t === "Preview") === preview ? "bg-surface font-medium shadow-sm" : "text-muted")}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        {preview ? (
          <div className="min-h-40 rounded-lg border border-border bg-surface p-4">
            <Markdown>{content.explanation || "_Nothing yet._"}</Markdown>
          </div>
        ) : (
          <Text
            label="Explanation text"
            value={content.explanation}
            onChange={(v) => setContent({ ...content, explanation: v })}
            rows={18}
            hint="Markdown: ### for subheadings, **bold**, - for lists. Math: $x^2$ inline, $$E = mc^2$$ on its own line."
          />
        )}
      </div>

      <ListEditor
        title="Worked examples"
        itemLabel="Example"
        items={content.workedExamples}
        onChange={(workedExamples) => setContent({ ...content, workedExamples })}
        make={() => ({ title: "Example", problem: "", steps: [], answer: "", pageRefs: [pageStart] })}
        render={(w, up) => (
          <>
            <Line label="Title" value={w.title} onChange={(title) => up({ title })} />
            <Text label="Problem" value={w.problem} onChange={(problem) => up({ problem })} />
            <Text label="Solution steps (one per line)" value={w.steps.join("\n")} onChange={(v) => up({ steps: linesToList(v) })} rows={5} />
            <Line label="Answer" value={w.answer} onChange={(answer) => up({ answer })} />
            <Pages value={w.pageRefs} onChange={(pageRefs) => up({ pageRefs })} />
          </>
        )}
      />

      <ListEditor
        title="Key terms"
        itemLabel="Term"
        items={content.keyTerms}
        onChange={(keyTerms) => setContent({ ...content, keyTerms })}
        make={() => ({ term: "", definition: "", pageRefs: [pageStart] })}
        render={(k, up) => (
          <>
            <Line label="Term" value={k.term} onChange={(term) => up({ term })} />
            <Text label="Definition" value={k.definition} onChange={(definition) => up({ definition })} rows={2} mono={false} />
            <Pages value={k.pageRefs} onChange={(pageRefs) => up({ pageRefs })} />
          </>
        )}
      />

      <ListEditor
        title="Practice questions"
        itemLabel="Question"
        items={questions}
        onChange={setQuestions}
        make={(): StoredQuestion => ({ type: "SHORT_ANSWER", prompt: "", choices: [], correctChoice: null, answer: "", explanation: "", steps: [], pageRefs: [pageStart], topic: "" })}
        render={(q, up, i) => (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor={`qtype-${i}`} className="text-sm font-medium">
                Type
              </label>
              <select
                id={`qtype-${i}`}
                value={q.type}
                onChange={(e) => {
                  const type = e.target.value as StoredQuestion["type"];
                  up(type === "MULTIPLE_CHOICE" ? { type, choices: q.choices.length >= 2 ? q.choices : ["", "", "", ""], correctChoice: q.correctChoice ?? 0 } : { type });
                }}
                className={cn(inputClasses, "sm:w-64")}
              >
                <option value="MULTIPLE_CHOICE">Multiple choice</option>
                <option value="SHORT_ANSWER">Short answer</option>
                <option value="STEP_BY_STEP">Step-by-step problem</option>
              </select>
            </div>
            <Text label="Question" value={q.prompt} onChange={(prompt) => up({ prompt })} />
            {q.type === "MULTIPLE_CHOICE" && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">Choices (select the correct one)</legend>
                {q.choices.map((c, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`correct-${i}`}
                      checked={q.correctChoice === j}
                      onChange={() => up({ correctChoice: j })}
                      aria-label={`Choice ${String.fromCharCode(65 + j)} is correct`}
                      className="size-4 accent-[var(--primary)]"
                    />
                    <input
                      value={c}
                      onChange={(e) => up({ choices: q.choices.map((x, k) => (k === j ? e.target.value : x)) })}
                      aria-label={`Choice ${String.fromCharCode(65 + j)}`}
                      className={inputClasses}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const choices = q.choices.filter((_, k) => k !== j);
                        const correct = q.correctChoice === null ? null : q.correctChoice === j ? 0 : q.correctChoice > j ? q.correctChoice - 1 : q.correctChoice;
                        up({ choices, correctChoice: correct });
                      }}
                      disabled={q.choices.length <= 2}
                      aria-label={`Remove choice ${String.fromCharCode(65 + j)}`}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
                {q.choices.length < 6 && (
                  <div>
                    <Button size="sm" variant="ghost" onClick={() => up({ choices: [...q.choices, ""] })}>
                      Add choice
                    </Button>
                  </div>
                )}
              </fieldset>
            )}
            {q.type !== "MULTIPLE_CHOICE" && <Text label={q.type === "STEP_BY_STEP" ? "Final answer" : "Model answer"} value={q.answer} onChange={(answer) => up({ answer })} rows={2} />}
            {q.type === "STEP_BY_STEP" && (
              <Text label="Solution steps (one per line)" value={q.steps.join("\n")} onChange={(v) => up({ steps: linesToList(v) })} rows={5} />
            )}
            <Text label="Explanation (why this is the answer)" value={q.explanation} onChange={(explanation) => up({ explanation })} rows={2} />
            <div className="flex flex-col gap-3 sm:flex-row">
              <Line label="Topic" value={q.topic} onChange={(topic) => up({ topic })} className="flex-1" />
              <Pages value={q.pageRefs} onChange={(pageRefs) => up({ pageRefs })} />
            </div>
          </>
        )}
      />

      <ListEditor
        title="Flashcards"
        itemLabel="Card"
        items={flashcards}
        onChange={setFlashcards}
        make={() => ({ front: "", back: "", pageRefs: [pageStart] })}
        render={(f, up) => (
          <>
            <Text label="Front" value={f.front} onChange={(front) => up({ front })} rows={2} mono={false} />
            <Text label="Back" value={f.back} onChange={(back) => up({ back })} rows={2} mono={false} />
            <Pages value={f.pageRefs} onChange={(pageRefs) => up({ pageRefs })} />
          </>
        )}
      />

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <Button type="submit" disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save lesson"}
        </Button>
        <Button variant="ghost" onClick={() => router.push(`/courses/${courseId}/lessons/${lessonId}`)}>
          Cancel
        </Button>
        {dirty && <span className="text-sm text-warning">Unsaved changes</span>}
      </div>
    </form>
  );
}
