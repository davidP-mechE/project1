"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { assignDiagnosticAction, createDiagnosticAction, deleteDiagnosticAction, grantRetakeAction, publishDiagnosticAction } from "@/server/actions/practice";

const select = "h-11 rounded-lg border border-border bg-surface px-3 text-sm";

/** Build a diagnostic from the program's tagged questions (the server picks them, spread across domains). */
export function BuildDiagnosticForm({ programs }: { programs: { id: string; name: string }[] }) {
  const router = useRouter();
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [sections, setSections] = useState<("RW" | "MATH")[]>(["RW", "MATH"]);
  const [n, setN] = useState({ m1Count: "10", m2Count: "10", m1Minutes: "15", m2Minutes: "15" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (s: "RW" | "MATH") => setSections(sections.includes(s) ? sections.filter((x) => x !== s) : [...sections, s]);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createDiagnosticAction(programId, { title, sections, m1Count: Number(n.m1Count), m2Count: Number(n.m2Count), m1Minutes: Number(n.m1Minutes), m2Minutes: Number(n.m2Minutes) });
          if (!r.ok) return setError(r.error);
          router.push(`/teach/diagnostics/${r.diagnosticId}`);
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder="e.g. Fall diagnostic" />
        {programs.length > 1 && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Program</span>
            <select className={select} value={programId} onChange={(e) => setProgramId(e.target.value)}>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 font-medium">Sections</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={sections.includes("RW")} onChange={() => toggle("RW")} className="size-4 accent-[var(--primary)]" />
          Reading and Writing
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={sections.includes("MATH")} onChange={() => toggle("MATH")} className="size-4 accent-[var(--primary)]" />
          Math
        </label>
      </fieldset>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Module 1 questions" type="number" min={2} max={40} value={n.m1Count} onChange={(e) => setN({ ...n, m1Count: e.target.value })} />
        <Field label="Module 1 minutes" type="number" min={1} max={120} value={n.m1Minutes} onChange={(e) => setN({ ...n, m1Minutes: e.target.value })} />
        <Field label="Module 2 questions" type="number" min={2} max={40} value={n.m2Count} onChange={(e) => setN({ ...n, m2Count: e.target.value })} />
        <Field label="Module 2 minutes" type="number" min={1} max={120} value={n.m2Minutes} onChange={(e) => setN({ ...n, m2Minutes: e.target.value })} />
      </div>
      <p className="text-xs text-muted">The real digital SAT has 27 R&amp;W questions in 32 minutes and 22 Math questions in 35 minutes per module. Questions come from your program&apos;s worksheets with confirmed tags; module 2 is built twice, harder and easier.</p>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button type="submit" disabled={pending || sections.length === 0}>
          Build diagnostic
        </Button>
      </div>
    </form>
  );
}

export function PublishDiagnosticButtons({ diagnosticId, published, assigned }: { diagnosticId: string; published: boolean; assigned: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {!published && (
          <Button disabled={pending} onClick={() => start(async () => { const r = await publishDiagnosticAction(diagnosticId); if (!r.ok) setError(r.error); router.refresh(); })}>
            Publish
          </Button>
        )}
        {assigned === 0 && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Delete this diagnostic?")) return;
              start(async () => {
                const r = await deleteDiagnosticAction(diagnosticId);
                if (!r.ok) return setError(r.error);
                router.push("/teach/diagnostics");
              });
            }}
          >
            Delete
          </Button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

export function AssignDiagnosticForm({ classId, diagnostics }: { classId: string; diagnostics: { id: string; title: string }[] }) {
  const router = useRouter();
  const [diagnosticId, setDiagnosticId] = useState(diagnostics[0]?.id ?? "");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (diagnostics.length === 0) return <p className="text-sm text-muted">No published diagnostics yet. Build one under Teaching → Diagnostics.</p>;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await assignDiagnosticAction(classId, { diagnosticId, opensAt: opensAt ? new Date(opensAt).toISOString() : null, closesAt: closesAt ? new Date(closesAt).toISOString() : null });
          setMsg(r.ok ? { tone: "success", text: "Assigned." } : { tone: "error", text: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Diagnostic</span>
          <select className={select} value={diagnosticId} onChange={(e) => setDiagnosticId(e.target.value)}>
            {diagnostics.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
        <Field label="Opens (optional)" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
        <Field label="Closes (optional)" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} hint="Answers and explanations show after it closes." />
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div>
        <Button type="submit" disabled={pending}>
          Assign diagnostic
        </Button>
      </div>
    </form>
  );
}

export function RetakeButton({ classId, assignmentId, studentId, name }: { classId: string; assignmentId: string; studentId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending || done}
      onClick={() => {
        if (!window.confirm(`Let ${name} take this diagnostic again?`)) return;
        start(async () => {
          const r = await grantRetakeAction(classId, assignmentId, studentId);
          if (r.ok) setDone(true);
          router.refresh();
        });
      }}
    >
      {done ? "Retake allowed" : "Allow a retake"}
    </Button>
  );
}
