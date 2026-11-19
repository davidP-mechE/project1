"use client";

import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { reportQuestionAction } from "@/server/actions/question-quality";

const REASONS = [
  ["WRONG_KEY", "The answer key looks wrong"],
  ["TYPO", "There's a typo"],
  ["CONFUSING", "It's confusing"],
  ["FIGURE_MISSING", "A figure is missing"],
  ["OTHER", "Something else"],
] as const;

type Target = { kind: "bank"; sessionId: string; questionId: string } | { kind: "item"; assignmentId: string; itemId: string };

/** "Report this question": a reason and an optional note, sent to whoever writes the question. */
export function ReportQuestion({ target, number }: { target: Target; number: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const panel = useId();
  const noteId = useId();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={panel} onClick={() => (setOpen((o) => !o), setMsg(null))}>
          Report this question
        </Button>
      </div>
      {open && (
        <form
          id={panel}
          className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await reportQuestionAction(target, { reason, note: note || undefined });
              if (!r.ok) return setMsg({ tone: "error", text: r.error });
              setOpen(false);
              setNote("");
              setReason("");
              setMsg({ tone: "success", text: "Thanks. Whoever wrote this question will take a look." });
            });
          }}
        >
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 font-medium">What&apos;s wrong with question {number}?</legend>
            {REASONS.map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name={`${panel}-reason`} value={value} checked={reason === value} onChange={() => setReason(value)} required /> {label}
              </label>
            ))}
          </fieldset>
          <label htmlFor={noteId} className="font-medium">Anything else? (optional)</label>
          <textarea id={noteId} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="rounded-md border-[1.5px] border-border-strong bg-surface px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || !reason}>{pending ? "Sending…" : "Send report"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  );
}
