"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { assignPracticeAction, markAttentionAction, practiceOptionsAction, reopenAttentionAction } from "@/server/actions/attention";
import { startThreadAction } from "@/server/actions/messages";

type Item = { classId: string; studentId: string; name: string; reason: string; skill: { id: string; name: string } | null };

/**
 * Quick actions on one needs-attention item: message the student, assign a
 * practice set, mark handled, or snooze. One panel opens at a time; focus
 * moves into it and back to its button when it closes.
 */
export function AttentionActions({ item }: { item: Item }) {
  const router = useRouter();
  const [open, setOpen] = useState<"message" | "practice" | "snooze" | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const panelId = useId();
  const toggle = (p: "message" | "practice" | "snooze") => {
    setMsg(null);
    setOpen((x) => (x === p ? null : p));
  };
  const mark = (action: "HANDLED" | "SNOOZED", days?: number) =>
    start(async () => {
      const r = await markAttentionAction({ classId: item.classId, studentId: item.studentId, reason: item.reason, action, days });
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" aria-expanded={open === "message"} aria-controls={panelId} onClick={() => toggle("message")}>
          Message
        </Button>
        <Button size="sm" variant="secondary" aria-expanded={open === "practice"} aria-controls={panelId} onClick={() => toggle("practice")}>
          Assign practice
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => mark("HANDLED")}>
          Mark handled
        </Button>
        <Button size="sm" variant="ghost" aria-expanded={open === "snooze"} aria-controls={panelId} onClick={() => toggle("snooze")}>
          Snooze…
        </Button>
      </div>
      <div id={panelId}>
        {open === "message" && <MessagePanel item={item} onDone={(text) => (setOpen(null), setMsg({ tone: "success", text }))} />}
        {open === "practice" && <PracticePanel item={item} onDone={(text) => (setOpen(null), setMsg({ tone: "success", text }), router.refresh())} />}
        {open === "snooze" && (
          <div role="group" aria-label={`Snooze ${item.name}`} className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-muted">Hide for</span>
            {[1, 3, 7, 14, 30].map((d) => (
              <Button key={d} size="sm" variant="secondary" disabled={pending} onClick={() => mark("SNOOZED", d)}>
                {d === 1 ? "1 day" : `${d} days`}
              </Button>
            ))}
          </div>
        )}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  );
}

function MessagePanel({ item, onDone }: { item: Item; onDone: (text: string) => void }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await startThreadAction({ classId: item.classId, studentId: item.studentId, body });
          if (!r.ok) return setError(r.error);
          onDone(`Message sent to ${item.name}.`);
        });
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        Message to {item.name}
      </label>
      <textarea id={id} autoFocus required maxLength={4000} rows={3} value={body} onChange={(e) => setBody(e.target.value)} className="rounded-md border-[1.5px] border-border-strong bg-surface px-3 py-2 text-sm" />
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

function PracticePanel({ item, onDone }: { item: Item; onDone: (text: string) => void }) {
  const [sets, setSets] = useState<{ id: string; title: string; onSkill: number }[] | null>(null);
  const [setId, setSetId] = useState("");
  const [days, setDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const selectId = useId();
  const daysId = useId();
  const skillId = item.skill?.id ?? null;
  useEffect(() => {
    let live = true;
    void practiceOptionsAction(skillId).then((r) => {
      if (!live) return;
      if (!r.ok) return setError(r.error);
      setSets(r.sets);
      setSetId(r.sets[0]?.id ?? "");
    });
    return () => {
      live = false;
    };
  }, [skillId]);
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!sets) return <p className="text-sm text-muted" role="status">Finding practice sets…</p>;
  if (!sets.length) return <p className="text-sm text-muted">No published question sets yet. Publish one from the question bank first.</p>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await assignPracticeAction({ classId: item.classId, studentId: item.studentId, setId, days });
          if (!r.ok) return setError(r.error);
          onDone(`Assigned to ${item.name}, due in ${days} day${days === 1 ? "" : "s"}.`);
        });
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={selectId} className="text-sm font-medium">
          {item.skill ? `Practice set for ${item.skill.name}` : "Practice set"}
        </label>
        <select id={selectId} autoFocus value={setId} onChange={(e) => setSetId(e.target.value)} className={inputClasses}>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
              {item.skill && s.onSkill ? ` (${s.onSkill} on this skill)` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex w-28 flex-col gap-1">
        <label htmlFor={daysId} className="text-sm font-medium">
          Due in (days)
        </label>
        <input id={daysId} type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value) || 7)} className={inputClasses} />
      </div>
      <Button type="submit" size="sm" disabled={pending || !setId}>
        {pending ? "Assigning…" : "Assign"}
      </Button>
    </form>
  );
}

/** Bring back a handled or snoozed item. */
export function ReopenButton({ item }: { item: Omit<Item, "skill" | "name"> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await reopenAttentionAction(item); router.refresh(); })}>
      Show again
    </Button>
  );
}
