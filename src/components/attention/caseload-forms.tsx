"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { assignTutorAction, assignTutorToClassAction, importCaseloadAction, setInactiveDaysAction } from "@/server/actions/attention";

type Tutor = { id: string; name: string };
type Klass = { id: string; name: string; groups: { id: string; name: string }[] };

/** Give everyone in a class, or one of its groups, the same primary tutor. */
export function BulkAssignForm({ programId, classes, tutors }: { programId: string; classes: Klass[]; tutors: Tutor[] }) {
  const router = useRouter();
  const [target, setTarget] = useState(classes[0] ? `c:${classes[0].id}` : "");
  const [tutorId, setTutorId] = useState(tutors[0]?.id ?? "");
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "warning"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const t = useId();
  const w = useId();
  if (!classes.length) return <p className="text-sm text-muted">No classes yet.</p>;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const [kind, id] = target.split(":");
        const classId = kind === "c" ? id : classes.find((c) => c.groups.some((g) => g.id === id))!.id;
        start(async () => {
          const r = await assignTutorToClassAction(programId, { classId, groupId: kind === "g" ? id : null, tutorId: tutorId || null });
          if (!r.ok) return setMsg({ tone: "error", text: r.error });
          setMsg({ tone: r.skipped ? "warning" : "success", text: `${r.assigned} student${r.assigned === 1 ? "" : "s"} updated.${r.skipped ? ` ${r.skipped} skipped: that tutor doesn't teach them.` : ""}` });
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={w} className="text-sm font-medium">Who</label>
        <select id={w} value={target} onChange={(e) => setTarget(e.target.value)} className={`${inputClasses} w-64`}>
          {classes.map((c) => (
            <optgroup key={c.id} label={c.name}>
              <option value={`c:${c.id}`}>Everyone in {c.name}</option>
              {c.groups.map((g) => (
                <option key={g.id} value={`g:${g.id}`}>Group {g.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={t} className="text-sm font-medium">Primary tutor</label>
        <select id={t} value={tutorId} onChange={(e) => setTutorId(e.target.value)} className={`${inputClasses} w-56`}>
          {tutors.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
          <option value="">No tutor (take them off caseloads)</option>
        </select>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Assign"}</Button>
      {msg && <Alert tone={msg.tone} className="basis-full">{msg.text}</Alert>}
    </form>
  );
}

/** Change one student's primary tutor. */
export function TutorSelect({ programId, studentId, studentName, tutorId, tutors }: { programId: string; studentId: string; studentName: string; tutorId: string | null; tutors: Tutor[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-col gap-1">
      <select
        aria-label={`Primary tutor for ${studentName}`}
        value={tutorId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value || null;
          start(async () => {
            const r = await assignTutorAction(programId, [studentId], next);
            if (!r.ok) return setError(r.error);
            if (r.skipped) return setError("That tutor doesn't teach this student.");
            setError(null);
            router.refresh();
          });
        }}
        className={`${inputClasses} h-9 w-48`}
      >
        <option value="">No tutor</option>
        {tutors.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      {error && <span className="text-xs text-danger" role="alert">{error}</span>}
    </span>
  );
}

type CsvRow = { line: number; studentEmail: string; tutorEmail: string; ok: boolean; problem: string | null };

/** Paste or upload student_email,tutor_email; check every row, then apply the good ones. */
export function CaseloadImport({ programId }: { programId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const fileId = useId();
  const textId = useId();
  const ready = rows?.filter((r) => r.ok).length ?? 0;
  const run = (commit: boolean) =>
    start(async () => {
      const r = await importCaseloadAction(programId, text, commit);
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setRows(r.rows);
      setMsg(commit ? { tone: "success", text: `${r.assigned} student${r.assigned === 1 ? "" : "s"} assigned.` } : null);
      if (commit) router.refresh();
    });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Two columns: <code>student_email, tutor_email</code>. A header row is optional. The tutor must teach the student (as a teacher, or a specialist whose groups include them).
      </p>
      <div className="flex flex-col gap-1.5 text-sm">
        <label htmlFor={fileId} className="font-medium">CSV file</label>
        <input id={fileId} type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); setRows(null); } }} className="text-sm" />
      </div>
      <div className="flex flex-col gap-1.5 text-sm">
        <label htmlFor={textId} className="font-medium">Or paste it</label>
        <textarea id={textId} value={text} onChange={(e) => (setText(e.target.value), setRows(null))} rows={4} className="rounded-md border-[1.5px] border-border-strong bg-surface px-3 py-2 font-mono text-xs" placeholder={"student_email,tutor_email\nana@school.org,ms.lee@school.org"} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={pending || !text.trim()} onClick={() => run(false)}>Check the file</Button>
        {rows && ready > 0 && (
          <Button disabled={pending} onClick={() => run(true)}>
            Assign {ready} student{ready === 1 ? "" : "s"}
          </Button>
        )}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {rows && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[32rem] text-sm">
            <caption className="sr-only">Rows in the file</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Tutor</th>
                <th className="px-3 py-2">Check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line} className="border-t border-border">
                  <td className="px-3 py-2 tabular-nums">{r.line}</td>
                  <td className="px-3 py-2">{r.studentEmail || "–"}</td>
                  <td className="px-3 py-2">{r.tutorEmail || "–"}</td>
                  <td className={r.ok ? "px-3 py-2 text-success" : "px-3 py-2 text-danger"}>{r.ok ? "OK" : r.problem}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Program setting: days without a login or practice before a student counts as inactive. */
export function InactiveDaysForm({ programId, days }: { programId: string; days: number }) {
  const router = useRouter();
  const [value, setValue] = useState(days);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setInactiveDaysAction(programId, value);
          setMsg(r.ok ? { tone: "success", text: "Saved." } : { tone: "error", text: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      <div className="flex w-44 flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">Inactive after (days)</label>
        <input id={id} type="number" min={2} max={60} value={value} onChange={(e) => setValue(Number(e.target.value))} className={inputClasses} aria-describedby={`${id}-hint`} />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>Save</Button>
      <p id={`${id}-hint`} className="basis-full text-xs text-muted">Students with no login and no practice for this many days appear on everyone&apos;s needs-attention list.</p>
      {msg && <Alert tone={msg.tone} className="basis-full">{msg.text}</Alert>}
    </form>
  );
}
