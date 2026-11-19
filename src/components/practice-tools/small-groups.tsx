"use client";

import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Card } from "@/components/ui/misc";
import { assignSmallGroupAction, messageSmallGroupAction, sessionForSmallGroupAction } from "@/server/actions/practice-tools";

type Group = {
  skillId: string;
  skill: string;
  accuracy: number | null;
  students: { id: string; name: string; classId: string; className: string; accuracy: number | null }[];
  sets: { id: string; title: string; onSkill: number }[];
};

const pct = (x: number | null) => (x === null ? "no answers yet" : `${Math.round(x * 100)}% correct`);

/** One suggested group, with its three one-click actions. */
export function SmallGroupCard({ group, canTeach, canSession, showClass }: { group: Group; canTeach: boolean; canSession: boolean; showClass?: boolean }) {
  const [open, setOpen] = useState<"message" | "assign" | "session" | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const panelId = useId();
  const classIds = [...new Set(group.students.map((s) => s.classId))];
  const studentIds = group.students.map((s) => s.id);
  const done = (text: string) => (setOpen(null), setMsg({ tone: "success", text }));
  const fail = (text: string) => setMsg({ tone: "error", text });
  const toggle = (p: "message" | "assign" | "session") => (setMsg(null), setOpen((x) => (x === p ? null : p)));
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">
          {group.students.length} student{group.students.length === 1 ? "" : "s"}: {group.skill}
        </h2>
        <span className="text-sm text-muted">Average on this skill: {pct(group.accuracy)}</span>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={`Students weakest on ${group.skill}`}>
        {group.students.map((s) => (
          <li key={s.id}>
            {s.name}
            <span className="text-muted">
              {" "}
              ({pct(s.accuracy)}
              {showClass ? `, ${s.className}` : ""})
            </span>
          </li>
        ))}
      </ul>
      {canTeach && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" aria-expanded={open === "message"} aria-controls={panelId} onClick={() => toggle("message")}>Message the group</Button>
          <Button size="sm" variant="secondary" aria-expanded={open === "assign"} aria-controls={panelId} onClick={() => toggle("assign")}>Assign a set</Button>
          {canSession && classIds.length === 1 && (
            <Button size="sm" variant="secondary" aria-expanded={open === "session"} aria-controls={panelId} onClick={() => toggle("session")}>Create a session</Button>
          )}
        </div>
      )}
      <div id={panelId}>
        {open === "message" && <MessageForm onSend={async (body) => { const r = await messageSmallGroupAction({ classIds, studentIds, body }); if (!r.ok) return fail(r.error); done(`Sent to ${r.sent} student${r.sent === 1 ? "" : "s"}, each in their own conversation.`); }} />}
        {open === "assign" && <AssignForm sets={group.sets} skill={group.skill} onAssign={async (setId, dueAt) => { const r = await assignSmallGroupAction({ classIds, studentIds, setId, dueAt }); if (!r.ok) return fail(r.error); done(`Assigned to ${r.assigned} student${r.assigned === 1 ? "" : "s"}.`); }} />}
        {open === "session" && <SessionForm onCreate={async (startsAt, minutes) => { const r = await sessionForSmallGroupAction({ classId: classIds[0], studentIds, skill: group.skill, startsAt, minutes }); if (!r.ok) return fail(r.error); done("Session created, with a group for these students. Take attendance from the class's Attendance tab."); }} />}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </Card>
  );
}

function MessageForm({ onSend }: { onSend: (body: string) => Promise<void> }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const id = useId();
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); start(() => onSend(body)); }}>
      <label htmlFor={id} className="text-sm font-medium">Message (each student gets a private copy)</label>
      <textarea id={id} autoFocus required maxLength={4000} rows={3} value={body} onChange={(e) => setBody(e.target.value)} className="rounded-md border-[1.5px] border-border-strong bg-surface px-3 py-2 text-sm" />
      <div><Button type="submit" size="sm" disabled={pending || !body.trim()}>{pending ? "Sending…" : "Send"}</Button></div>
    </form>
  );
}

function AssignForm({ sets, skill, onAssign }: { sets: Group["sets"]; skill: string; onAssign: (setId: string, dueAt: string | null) => Promise<void> }) {
  const [setId, setSetId] = useState(sets[0]?.id ?? "");
  const [due, setDue] = useState("");
  const [pending, start] = useTransition();
  const s = useId();
  const d = useId();
  if (!sets.length) return <p className="text-sm text-muted">No published set has questions on {skill} yet. Build one in the question bank.</p>;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(() => onAssign(setId, due ? new Date(due).toISOString() : null)); }}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={s} className="text-sm font-medium">Set for {skill}</label>
        <select id={s} autoFocus value={setId} onChange={(e) => setSetId(e.target.value)} className={inputClasses}>
          {sets.map((x) => <option key={x.id} value={x.id}>{x.title} ({x.onSkill} on this skill)</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={d} className="text-sm font-medium">Due (optional)</label>
        <input id={d} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={`${inputClasses} w-56`} />
      </div>
      <Button type="submit" size="sm" disabled={pending || !setId}>{pending ? "Assigning…" : "Assign"}</Button>
    </form>
  );
}

function SessionForm({ onCreate }: { onCreate: (startsAt: string, minutes: number) => Promise<void> }) {
  const [when, setWhen] = useState("");
  const [minutes, setMinutes] = useState(45);
  const [pending, start] = useTransition();
  const w = useId();
  const m = useId();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(() => onCreate(new Date(when).toISOString(), minutes)); }}>
      <div className="flex flex-col gap-1">
        <label htmlFor={w} className="text-sm font-medium">Starts</label>
        <input id={w} autoFocus required type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={`${inputClasses} w-56`} />
      </div>
      <div className="flex w-28 flex-col gap-1">
        <label htmlFor={m} className="text-sm font-medium">Minutes</label>
        <input id={m} type="number" min={10} max={480} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 45)} className={inputClasses} />
      </div>
      <Button type="submit" size="sm" disabled={pending || !when}>{pending ? "Creating…" : "Create session"}</Button>
    </form>
  );
}
