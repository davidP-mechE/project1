"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { assignExternalAction, recordExternalAction } from "@/server/actions/scores";
import { DOMAINS, SECTIONS, domainName } from "@/lib/sat/domains";
import { MISS_REASONS, REASON_LABEL } from "@/lib/sat/scores";
import { cn } from "@/lib/utils";
import { TargetPicker, type TargetOptions, type TargetValue } from "./target-picker";

type Row = { questionId: string; url: string; domain: string };
const small = "h-9 rounded-lg border border-border bg-surface px-2 text-sm";

/** Attach College Board Question Bank questions by link and ID. Nothing from the question itself is saved. */
export function ExternalAssignForm({ classId, targetOptions }: { classId: string; targetOptions?: TargetOptions }) {
  const [targets, setTargets] = useState<TargetValue>({ groupIds: [], studentIds: [] });
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [rows, setRows] = useState<Row[]>([{ questionId: "", url: "", domain: "algebra" }]);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await assignExternalAction(classId, { title, items: rows, dueAt: due ? new Date(due).toISOString() : null, targets });
          if (!res.ok) return setMsg({ tone: "error", text: res.error });
          setMsg({ tone: "success", text: `Assigned ${rows.length} College Board question${rows.length === 1 ? "" : "s"}.` });
          setTitle("");
          setRows([{ questionId: "", url: "", domain: "algebra" }]);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assignment title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder="e.g. Question Bank: linear equations" />
        <Field label="Due (optional)" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
      {targetOptions && <TargetPicker options={targetOptions} value={targets} onChange={setTargets} />}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Questions</legend>
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2">
            <label className="flex flex-col gap-1 text-xs">
              Question ID
              <input className={cn(small, "w-28")} value={r.questionId} onChange={(e) => set(i, { questionId: e.target.value })} required placeholder="a1b2c3d4" />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
              Link
              <input className={small} type="url" value={r.url} onChange={(e) => set(i, { url: e.target.value })} required placeholder="https://satsuitequestionbank.collegeboard.org/…" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Domain
              <select className={small} value={r.domain} onChange={(e) => set(i, { domain: e.target.value })}>
                {SECTIONS.map((s) => (
                  <optgroup key={s.id} label={s.name}>
                    {DOMAINS.filter((d) => d.section === s.id).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {rows.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove question ${i + 1}`}>
                Remove
              </Button>
            )}
          </div>
        ))}
        <div>
          <Button size="sm" variant="secondary" onClick={() => setRows([...rows, { questionId: "", url: "", domain: rows.at(-1)?.domain ?? "algebra" }])}>
            Add a question
          </Button>
        </div>
      </fieldset>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div>
        <Button type="submit" disabled={pending}>
          Assign
        </Button>
      </div>
    </form>
  );
}

type Item = { key: string; number: number; questionId: string; url: string; domain: string; result: { result: string; reason: string | null } | null };

/** The student's list: open each question on College Board, then record how it went. */
export function ExternalSet({ assignmentId, items }: { assignmentId: string; items: Item[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((i) => (
        <ExternalItemRow key={i.key} assignmentId={assignmentId} item={i} />
      ))}
    </ol>
  );
}

function ExternalItemRow({ assignmentId, item }: { assignmentId: string; item: Item }) {
  const router = useRouter();
  const [result, setResult] = useState(item.result?.result ?? "");
  const [reason, setReason] = useState(item.result?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (r: string, why: string) =>
    start(async () => {
      const res = await recordExternalAction(assignmentId, item.key, { result: r, reason: r === "INCORRECT" && why ? why : null });
      if (!res.ok) return setError(res.error);
      setError(null);
      router.refresh();
    });
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {item.number}. Question {item.questionId} <span className="text-sm font-normal text-muted">· {domainName(item.domain)}</span>
        </span>
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline">
          Open on College Board<span className="sr-only"> (opens in a new tab)</span> ↗
        </a>
      </div>
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="sr-only">How did question {item.questionId} go?</legend>
        {[
          ["CORRECT", "Got it right"],
          ["INCORRECT", "Got it wrong"],
          ["SKIPPED", "Skipped"],
        ].map(([v, label]) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`r-${item.key}`}
              value={v}
              checked={result === v}
              disabled={pending}
              onChange={() => {
                setResult(v);
                if (v !== "INCORRECT") save(v, "");
              }}
              className="size-4 accent-[var(--primary)]"
            />
            {label}
          </label>
        ))}
      </fieldset>
      {result === "INCORRECT" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            Why? (optional)
            <select className={small} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">(not sure)</option>
              {MISS_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" disabled={pending} onClick={() => save("INCORRECT", reason)}>
            Save
          </Button>
        </div>
      )}
      {item.result && <p className="text-xs text-success">Recorded.</p>}
      {error && <Alert tone="error">{error}</Alert>}
    </li>
  );
}
