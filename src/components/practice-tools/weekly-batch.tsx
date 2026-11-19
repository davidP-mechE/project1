"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Card } from "@/components/ui/misc";
import { autoApproveAction, autoBuildNowAction, autoRemoveQuestionAction, autoSetRemovedAction, autoSwapQuestionAction } from "@/server/actions/practice-tools";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  student: { id: string; name: string };
  status: "PENDING" | "APPROVED" | "REMOVED";
  canAct: boolean;
  skills: string[];
  questions: { id: string; stem: string; skill: string; difficulty: number; published: boolean }[];
  count: number;
};

const DIFF = ["", "Easy", "Medium", "Hard"];

/** The weekly batch: one row per student; expand to remove or swap questions; approve everything at once. */
export function WeeklyBatch({ classId, batchId, items, defaultDue }: { classId: string; batchId: string; items: Item[]; defaultDue: string }) {
  const router = useRouter();
  const [due, setDue] = useState(defaultDue);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dueId = useId();
  const ready = items.filter((i) => i.status === "PENDING" && i.canAct).length;
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={dueId} className="text-sm font-medium">Due</label>
          <input id={dueId} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={`${inputClasses} w-60`} />
        </div>
        <Button
          disabled={pending || ready === 0 || !due}
          onClick={() =>
            start(async () => {
              const r = await autoApproveAction(classId, batchId, new Date(due).toISOString());
              setMsg(r.ok ? { tone: "success", text: `Assigned ${r.approved} set${r.approved === 1 ? "" : "s"}. Each student sees theirs under Classes.` } : { tone: "error", text: r.error });
              router.refresh();
            })
          }
        >
          {pending ? "Approving…" : `Approve all ${ready}`}
        </Button>
        <span className="text-sm text-muted">{ready ? "Each set becomes that student's own assignment." : "Nothing waiting for you to approve."}</span>
        {msg && <Alert tone={msg.tone} className="basis-full">{msg.text}</Alert>}
      </Card>
      <ul className="flex flex-col gap-3">
        {items.map((i) => (
          <li key={i.id}>
            <ItemCard classId={classId} item={i} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ItemCard({ classId, item }: { classId: string; item: Item }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const listId = useId();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.ok ? null : (r.error ?? "Something went wrong."));
      router.refresh();
    });
  const editable = item.canAct && item.status === "PENDING";
  return (
    <Card className={cn("flex flex-col gap-2", item.status === "REMOVED" && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="font-semibold">{item.student.name}</h3>
        <span className="text-sm text-muted">
          {item.count} question{item.count === 1 ? "" : "s"} · {item.skills.join(", ")}
        </span>
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", item.status === "APPROVED" ? "bg-success-bg text-success" : item.status === "REMOVED" ? "bg-surface-2 text-muted" : "bg-warning-bg text-warning")}>
          {item.status === "APPROVED" ? "Assigned" : item.status === "REMOVED" ? "Taken out" : "Waiting"}
        </span>
        <span className="ml-auto flex gap-1.5">
          {item.canAct && item.questions.length > 0 && (
            <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
              {open ? "Hide questions" : "Questions"}
            </Button>
          )}
          {item.canAct && item.status !== "APPROVED" && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => autoSetRemovedAction(classId, item.id, item.status !== "REMOVED"))}>
              {item.status === "REMOVED" ? "Put back" : "Take out"}
            </Button>
          )}
        </span>
      </div>
      {!item.canAct && <p className="text-xs text-muted">Outside your subjects: a teacher or another specialist reviews this one.</p>}
      {error && <Alert tone="error">{error}</Alert>}
      {open && (
        <ol id={listId} className="flex flex-col divide-y divide-border text-sm">
          {item.questions.map((q, n) => (
            <li key={q.id} className="flex flex-wrap items-start gap-2 py-2">
              <span className="w-6 shrink-0 tabular-nums text-muted">{n + 1}.</span>
              <span className="min-w-0 flex-1">
                {q.stem}
                <span className="block text-xs text-muted">
                  {q.skill} · {DIFF[q.difficulty]}
                  {!q.published && " · no longer published (left out when approved)"}
                </span>
              </span>
              {editable && (
                <span className="flex gap-1">
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => autoSwapQuestionAction(classId, item.id, q.id))} aria-label={`Swap question ${n + 1}`}>
                    Swap
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending || item.questions.length <= 1} onClick={() => act(() => autoRemoveQuestionAction(classId, item.id, q.id))} aria-label={`Remove question ${n + 1}`}>
                    Remove
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** Build (or rebuild the waiting part of) this week's batch now. */
export function BuildNowButton({ classId, hasBatch }: { classId: string; hasBatch: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant={hasBatch ? "secondary" : "primary"}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await autoBuildNowAction(classId);
              setMsg(r.ok ? { tone: "success", text: `${r.made} set${r.made === 1 ? "" : "s"} built${r.skipped ? `, ${r.skipped} student${r.skipped === 1 ? "" : "s"} left out (see below)` : ""}.` } : { tone: "error", text: r.error });
              router.refresh();
            })
          }
        >
          {pending ? "Building…" : hasBatch ? "Rebuild waiting sets" : "Build this week's sets now"}
        </Button>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  );
}
