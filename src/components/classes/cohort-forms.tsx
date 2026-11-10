"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  addGuardianAction,
  createSessionsAction,
  deleteSessionAction,
  dismissAlertAction,
  importRosterAction,
  markAttendanceAction,
  previewRosterAction,
  removeGuardianAction,
  setGuardianSummariesAction,
} from "@/server/actions/cohort";
import { cn } from "@/lib/utils";

const select = "h-11 rounded-lg border border-border bg-surface px-3 text-sm";

export function SessionForm({ classId, groups, mustPickGroup }: { classId: string; groups: { id: string; name: string }[]; mustPickGroup: boolean }) {
  const router = useRouter();
  const [startsAt, setStartsAt] = useState("");
  const [minutes, setMinutes] = useState("60");
  const [weeks, setWeeks] = useState("1");
  const [groupId, setGroupId] = useState(mustPickGroup ? (groups[0]?.id ?? "") : "");
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createSessionsAction(classId, { startsAt: new Date(startsAt).toISOString(), minutes: Number(minutes), weeks: Number(weeks), groupId: groupId || null, title });
          setMsg(r.ok ? { tone: "success", text: `Added ${r.created} ${r.created === 1 ? "session" : "sessions"}.` } : { tone: "error", text: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      <Field label="Starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
      <Field label="Minutes" type="number" min={10} max={480} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      <Field label="Repeat weekly (number of weeks)" type="number" min={1} max={20} value={weeks} onChange={(e) => setWeeks(e.target.value)} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">For</span>
        <select className={select} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {!mustPickGroup && <option value="">The whole class</option>}
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <Field label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Math review" className="sm:col-span-2" />
      <div className="flex flex-col gap-2 sm:col-span-2">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div>
          <Button type="submit" disabled={pending}>
            Add session
          </Button>
        </div>
      </div>
    </form>
  );
}

export function DeleteSessionButton({ classId, sessionId }: { classId: string; sessionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Delete this session and its attendance?") && start(async () => { await deleteSessionAction(classId, sessionId); router.refresh(); })}>
      Delete
    </Button>
  );
}

const MARKS = [
  ["PRESENT", "Present"],
  ["LATE", "Late"],
  ["ABSENT", "Absent"],
  ["EXCUSED", "Excused"],
] as const;

/** One student's row in the register: four big buttons, easy on a phone. */
export function AttendanceRow({ classId, sessionId, student, initial, canMark }: { classId: string; sessionId: string; student: { id: string; name: string }; initial: string | null; canMark: boolean }) {
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="font-medium">{student.name || "Student"}</span>
      <span role="group" aria-label={`Attendance for ${student.name}`} className="grid grid-cols-4 gap-1.5">
        {MARKS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            disabled={!canMark || pending}
            aria-pressed={status === v}
            onClick={() =>
              start(async () => {
                const prev = status;
                setStatus(v);
                const r = await markAttendanceAction(classId, sessionId, student.id, v);
                if (!r.ok) {
                  setStatus(prev);
                  setError(r.error);
                } else setError(null);
              })
            }
            className={cn(
              "min-h-11 rounded-lg border px-2 text-sm font-semibold",
              status === v ? (v === "ABSENT" ? "border-danger bg-danger-bg text-danger" : v === "PRESENT" ? "border-success bg-success-bg text-success" : "border-primary bg-primary/10 text-primary") : "border-border bg-surface hover:bg-surface-2",
            )}
          >
            {label}
          </button>
        ))}
      </span>
      {error && <span className="text-xs text-danger">{error}</span>}
    </li>
  );
}

export function AlertActions({ classId, studentId, kind }: { classId: string; studentId: string; kind: "MISSING_WORK" | "DROPPING" | "INACTIVE" | "ABSENCES" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (days: number | null) => start(async () => { await dismissAlertAction(classId, studentId, kind, days); router.refresh(); });
  return (
    <span className="flex gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(7)}>
        Snooze a week
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(null)}>
        Dismiss
      </Button>
    </span>
  );
}

/** Upload or paste a roster CSV, check every row, then invite everyone. */
export function RosterImport({ classId }: { classId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<{ line: number; name: string; email: string; group: string; target: number | null; baseline: number | null; errors: string[]; alreadyIn: boolean }[] | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const bad = rows?.filter((r) => r.errors.length).length ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Columns: <code>name, email, group, target, baseline, baseline_date</code> (only email is required). Students get an invite email; their group, goal and baseline are set when they join.
      </p>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">CSV file</span>
        <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); setRows(null); } }} className="text-sm" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Or paste it</span>
        <textarea value={text} onChange={(e) => (setText(e.target.value), setRows(null))} rows={4} className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" placeholder={"name,email,group,target\nAna Diaz,ana@school.org,Tuesday,1200"} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={pending || !text.trim()} onClick={() => start(async () => { const r = await previewRosterAction(classId, text); if (!r.ok) return setMsg({ tone: "error", text: r.error }); setMsg(null); setRows(r.rows); })}>
          Check the file
        </Button>
        {rows && (
          <Button disabled={pending || bad > 0} onClick={() => start(async () => { const r = await importRosterAction(classId, text); setMsg(r.ok ? { tone: "success", text: `Invited ${r.invited}${r.alreadyIn ? `; ${r.alreadyIn} were already in the class` : ""}.` } : { tone: "error", text: r.error }); if (r.ok) { setRows(null); setText(""); router.refresh(); } })}>
            Invite {rows.filter((r) => !r.alreadyIn).length} students
          </Button>
        )}
      </div>
      {rows && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Roster preview</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">Line</th>
                <th scope="col" className="py-1 pr-2 font-medium">Name</th>
                <th scope="col" className="py-1 pr-2 font-medium">Email</th>
                <th scope="col" className="py-1 pr-2 font-medium">Group</th>
                <th scope="col" className="py-1 pr-2 font-medium">Goal</th>
                <th scope="col" className="py-1 font-medium">Check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.line}>
                  <td className="py-1 pr-2 tabular-nums text-muted">{r.line}</td>
                  <th scope="row" className="py-1 pr-2 font-normal">{r.name || "–"}</th>
                  <td className="py-1 pr-2">{r.email}</td>
                  <td className="py-1 pr-2">{r.group || "–"}</td>
                  <td className="py-1 pr-2 tabular-nums">{r.target ?? "–"}</td>
                  <td className={cn("py-1", r.errors.length ? "text-danger" : "text-success")}>{r.errors.length ? r.errors.join("; ") : r.alreadyIn ? "Already in the class" : "OK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {bad > 0 && <Alert tone="error">Fix the {bad} {bad === 1 ? "row" : "rows"} in red; nothing is sent until every row is OK.</Alert>}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  );
}

export function GuardianSummariesToggle({ classId, on }: { classId: string; on: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" defaultChecked={on} disabled={pending} onChange={(e) => start(async () => { await setGuardianSummariesAction(classId, e.target.checked); router.refresh(); })} className="mt-0.5 size-4 accent-[var(--primary)]" />
      <span>
        Send a weekly progress email to guardians who agreed to it (Sunday evening). Add guardians on each student&apos;s page.
      </span>
    </label>
  );
}

export function GuardianForm({ classId, studentId, guardians }: { classId: string; studentId: string; guardians: { id: string; name: string; email: string; relationship: string; unsubscribedAt: Date | null }[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", relationship: "", consent: false });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      {guardians.length > 0 && (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {guardians.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {g.name}
                {g.relationship && ` (${g.relationship})`} · {g.email}
                {g.unsubscribedAt && <span className="ml-2 text-xs text-muted">unsubscribed</span>}
              </span>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await removeGuardianAction(classId, studentId, g.id); router.refresh(); })}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await addGuardianAction(classId, studentId, form);
            if (!r.ok) return setError(r.error);
            setError(null);
            setForm({ name: "", email: "", relationship: "", consent: false });
            router.refresh();
          });
        }}
      >
        <Field label="Guardian's name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Field label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <Field label="Relationship (optional)" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} placeholder="e.g. Mother" />
        <label className="flex items-start gap-2 text-sm sm:col-span-3">
          <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-0.5 size-4 accent-[var(--primary)]" required />
          The student and this guardian agreed to weekly progress emails. (Required; recorded with your name and the date.)
        </label>
        {error && <Alert tone="error" className="sm:col-span-3">{error}</Alert>}
        <div className="sm:col-span-3">
          <Button type="submit" variant="secondary" disabled={pending}>
            Add guardian
          </Button>
        </div>
      </form>
    </div>
  );
}
