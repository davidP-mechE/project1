"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Markdown } from "@/components/lesson/markdown";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { Field } from "@/components/ui/field";
import { assignQuestionsAction, deleteItemAction, retryWorksheetAction, updateItemAction } from "@/server/actions/classes";
import { cn } from "@/lib/utils";
import { TagEditor, type Tags } from "./tag-editor";

type ItemType = "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "STEP_BY_STEP";
export type EditorItem = { id: string; label: string; type: ItemType; prompt: string; choices: string[]; correctChoice: number | null; answer: string; explanation: string; steps: string[]; topic: string; answerSource: string; tags: Tags; version: number; answered: number };

const letter = (i: number) => String.fromCharCode(65 + i);
const TYPE_LABEL: Record<ItemType, string> = { MULTIPLE_CHOICE: "Multiple choice", SHORT_ANSWER: "Short answer", STEP_BY_STEP: "Step by step" };
const SOURCE: Record<string, { label: string; tone: string }> = {
  WORKSHEET: { label: "Answer from the worksheet", tone: "bg-success-bg text-success" },
  TEACHER: { label: "Answer checked by you", tone: "bg-success-bg text-success" },
  CLAUDE: { label: "Answer worked out by Claude: check it", tone: "bg-warning-bg text-warning" },
};

/** While Claude reads the worksheet, check back every few seconds. */
export function ReadingPoller() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

export function RetryWorksheetButton({ worksheetId }: { worksheetId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await retryWorksheetAction(worksheetId);
            if (!res.ok) setError(res.error);
            router.refresh();
          })
        }
      >
        Try reading it again
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/** One question: shown as students will see it, with its answer; Edit to fix it. */
export function ItemCard({ worksheetId, item, number }: { worksheetId: string; item: EditorItem; number: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(item);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const source = SOURCE[item.answerSource] ?? SOURCE.CLAUDE;

  const save = () =>
    start(async () => {
      const res = await updateItemAction(worksheetId, item.id, { type: form.type, prompt: form.prompt, choices: form.choices, correctChoice: form.correctChoice, answer: form.answer, explanation: form.explanation, topic: form.topic });
      if (!res.ok) return setError(res.error);
      setEditing(false);
      setError(null);
      router.refresh();
    });

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted">
          {number}. #{item.label} · {TYPE_LABEL[item.type]} · {item.topic}
          {item.version > 1 && ` · version ${item.version}`}
        </span>
        <span className={cn("rounded px-1.5 py-0.5 font-medium", source.tone)}>{source.label}</span>
      </div>
      {!editing ? (
        <>
          <Markdown>{item.prompt}</Markdown>
          {item.choices.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {item.choices.map((c, k) => (
                <li key={k} className={cn("flex gap-2 rounded-lg border px-3 py-1.5", k === item.correctChoice ? "border-success bg-success-bg" : "border-border")}>
                  <span className="font-semibold text-muted">{letter(k)}.</span>
                  <Markdown className="flex-1 [&_p]:m-0">{c}</Markdown>
                  {k === item.correctChoice && <span className="text-success" aria-label="correct answer">✓</span>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm">
              <Markdown className="[&_p]:m-0">{`**Answer:** ${item.answer || "_(none yet)_"}`}</Markdown>
            </div>
          )}
          {item.explanation && <p className="text-sm text-muted">{item.explanation}</p>}
          <TagEditor worksheetId={worksheetId} itemId={item.id} tags={item.tags} />
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Delete this question from the worksheet?")) return;
                start(async () => {
                  const res = await deleteItemAction(worksheetId, item.id);
                  if (!res.ok) setError(res.error);
                  router.refresh();
                });
              }}
            >
              Delete
            </Button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Type</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ItemType, choices: e.target.value === "MULTIPLE_CHOICE" && form.choices.length < 2 ? ["", "", "", ""] : form.choices })} className="h-10 rounded-lg border border-border bg-surface px-3">
              {(Object.keys(TYPE_LABEL) as ItemType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Question (Markdown; math as $x^2$)</span>
            <textarea value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} rows={4} className="rounded-lg border border-border bg-surface px-3 py-2" required />
          </label>
          {form.type === "MULTIPLE_CHOICE" ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Choices (select the right one)</legend>
              {form.choices.map((c, k) => (
                <div key={k} className="flex items-center gap-2">
                  <input type="radio" name={`correct-${item.id}`} checked={form.correctChoice === k} onChange={() => setForm({ ...form, correctChoice: k })} aria-label={`Choice ${letter(k)} is correct`} className="size-4 accent-[var(--primary)]" />
                  <span className="w-5 font-semibold text-muted">{letter(k)}.</span>
                  <input
                    value={c}
                    onChange={(e) => setForm({ ...form, choices: form.choices.map((x, j) => (j === k ? e.target.value : x)) })}
                    aria-label={`Choice ${letter(k)}`}
                    className="h-9 flex-1 rounded-lg border border-border bg-surface px-3 text-sm"
                  />
                </div>
              ))}
              {form.choices.length < 8 && (
                <div>
                  <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, choices: [...form.choices, ""] })}>
                    Add a choice
                  </Button>
                </div>
              )}
            </fieldset>
          ) : (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Answer</span>
              <textarea value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} rows={2} className="rounded-lg border border-border bg-surface px-3 py-2" required />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Explanation (shown after answering)</span>
            <textarea value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} rows={2} className="rounded-lg border border-border bg-surface px-3 py-2" />
          </label>
          {item.answered > 0 && <Alert tone="info">Students have answered this question. Saving a change makes version {item.version + 1}; their earlier answers keep their grades unless you re-grade them from the assignment&apos;s report.</Alert>}
          <Field label="Skill" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} maxLength={60} />
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setForm(item);
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && !editing && <Alert tone="error">{error}</Alert>}
    </Card>
  );
}

/** Parse "1-5, 8, 10-12" (question numbers in this worksheet's order). */
export function parseRanges(text: string, count: number): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b) && n <= count; n++) if (n >= 1) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

/** Turn some or all of the questions into an assignment for one or more classes (run it again to split a worksheet into several). */
export function AssignQuestionsForm({
  worksheetId,
  worksheetTitle,
  items,
  classes,
  courses,
}: {
  worksheetId: string;
  worksheetTitle: string;
  items: { id: string; label: string; topic: string; prompt: string; answerSource: string }[];
  classes: { id: string; name: string }[];
  courses: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(items.map((i) => i.id));
  const [range, setRange] = useState("");
  const [title, setTitle] = useState(worksheetTitle);
  const [classIds, setClassIds] = useState<string[]>(classes.length === 1 ? [classes[0].id] : []);
  const [courseId, setCourseId] = useState("");
  const [due, setDue] = useState("");
  const [timed, setTimed] = useState(false);
  const [minutes, setMinutes] = useState(25);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const unchecked = items.filter((i) => picked.includes(i.id) && i.answerSource === "CLAUDE").length;

  if (classes.length === 0) {
    return <p className="text-sm text-muted">Create a class under My classes first; then you can assign these questions to it.</p>;
  }
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (picked.length === 0) return setMsg({ tone: "error", text: "Choose at least one question." });
        if (classIds.length === 0) return setMsg({ tone: "error", text: "Choose at least one class." });
        start(async () => {
          const res = await assignQuestionsAction({
            classIds,
            worksheetId,
            itemIds: picked,
            title,
            courseId: courseId || null,
            note: note || undefined,
            dueAt: due ? new Date(due).toISOString() : null,
            timeLimitMin: timed ? minutes : null,
          });
          if (!res.ok) return setMsg({ tone: "error", text: res.error });
          setMsg({ tone: "success", text: `Assigned to ${res.count} ${res.count === 1 ? "class" : "classes"}. Pick other questions to make another assignment.` });
          router.refresh();
        });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          Questions ({picked.length} of {items.length})
        </legend>
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPicked(items.map((i) => i.id))}>
            All
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
            None
          </Button>
          <Field label="Pick by number" value={range} onChange={(e) => setRange(e.target.value)} placeholder="e.g. 1-10, 14" className="w-40" />
          <Button size="sm" variant="secondary" onClick={() => setPicked(parseRanges(range, items.length).map((n) => items[n - 1].id))} disabled={!range.trim()}>
            Select
          </Button>
        </div>
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
          {items.map((i, n) => (
            <li key={i.id}>
              <label className="flex items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-surface-2">
                <input type="checkbox" checked={picked.includes(i.id)} onChange={() => setPicked((p) => (p.includes(i.id) ? p.filter((x) => x !== i.id) : [...p, i.id]))} className="mt-0.5 size-4 accent-[var(--primary)]" />
                <span className="w-8 shrink-0 tabular-nums text-muted">{n + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{i.prompt.replace(/\s+/g, " ").slice(0, 120)}</span>
                <span className="shrink-0 text-xs text-muted">{i.topic}</span>
              </label>
            </li>
          ))}
        </ul>
        {unchecked > 0 && <p className="text-xs text-warning">{unchecked} of the chosen questions have an answer Claude worked out. Check them above before students answer.</p>}
      </fieldset>

      <Field label="Assignment title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">Classes</legend>
        {classes.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={classIds.includes(c.id)} onChange={() => setClassIds((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} className="size-4 accent-[var(--primary)]" />
            {c.name}
          </label>
        ))}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">File under a course (optional)</span>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className="h-10 rounded-lg border border-border bg-surface px-3">
            <option value="">None</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Due (optional)</span>
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="h-10 rounded-lg border border-border bg-surface px-3" />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Timed (results show after handing in)
        </label>
        {timed && (
          <label className="flex items-center gap-2 text-sm">
            <span>Minutes</span>
            <input type="number" min={1} max={300} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="h-9 w-20 rounded-lg border border-border bg-surface px-2" />
          </label>
        )}
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Note to students (optional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className="rounded-lg border border-border bg-surface px-3 py-2" />
      </label>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div>
        <Button type="submit" disabled={pending}>
          Assign {picked.length} {picked.length === 1 ? "question" : "questions"}
        </Button>
      </div>
    </form>
  );
}
