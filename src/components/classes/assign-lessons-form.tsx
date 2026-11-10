"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { assignLessonsAction } from "@/server/actions/classes";
import { DOMAINS, SECTIONS } from "@/lib/sat/domains";
import { TargetPicker, type TargetOptions, type TargetValue } from "./target-picker";

type Course = { id: string; title: string; units: { id: string; title: string; lessons: { id: string; title: string; status: string }[] }[] };

/** Pick a course, then the whole course or some of its lessons, a due date and a note. */
export function AssignLessonsForm({ classId, courses, targetOptions }: { classId: string; courses: Course[]; targetOptions?: TargetOptions }) {
  const [targets, setTargets] = useState<TargetValue>({ groupIds: [], studentIds: [] });
  const router = useRouter();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [whole, setWhole] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const course = useMemo(() => courses.find((c) => c.id === courseId), [courses, courseId]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!whole && picked.length === 0) return setError("Choose some lessons, or assign the whole course.");
        start(async () => {
          const res = await assignLessonsAction(classId, { courseId, lessonIds: whole ? [] : picked, title: title || undefined, note: note || undefined, dueAt: due ? new Date(due).toISOString() : null, subject: subject || null, targets });
          if (!res.ok) return setError(res.error);
          router.push(`/teach/${classId}`);
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Course</span>
        <select
          value={courseId}
          onChange={(e) => {
            setCourseId(e.target.value);
            setPicked([]);
          }}
          className="h-10 rounded-lg border border-border bg-surface px-3"
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">What to assign</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          The whole course
        </label>
        {!whole && course && (
          <div className="flex max-h-96 flex-col gap-3 overflow-y-auto rounded-lg border border-border p-3">
            {course.units.map((u) => (
              <div key={u.id}>
                <p className="mb-1 text-sm font-semibold">{u.title}</p>
                <ul className="flex flex-col gap-1">
                  {u.lessons.map((l) => (
                    <li key={l.id}>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={picked.includes(l.id)} onChange={() => toggle(l.id)} className="size-4 accent-[var(--primary)]" />
                        <span>{l.title}</span>
                        {l.status !== "READY" && <span className="text-xs text-muted">(not written yet)</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">SAT subject</span>
          <select value={subject} onChange={(e) => setSubject(e.target.value)} className="h-11 rounded-lg border border-border bg-surface px-3">
            <option value="">Not tagged</option>
            {SECTIONS.map((s) => (
              <optgroup key={s.id} label={s.name}>
                <option value={s.id}>All of {s.name}</option>
                {DOMAINS.filter((d) => d.section === s.id).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="text-xs text-muted">Specialists only see work in their subjects, so tag it if specialists help with this class.</span>
        </label>
        {targetOptions && <TargetPicker options={targetOptions} value={targets} onChange={setTargets} />}
        <Field label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Named after the lessons if left empty" />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Due (optional)</span>
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="h-10 rounded-lg border border-border bg-surface px-3" />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Note to students (optional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className="rounded-lg border border-border bg-surface px-3 py-2" />
      </label>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button type="submit" disabled={pending || !courseId}>
          Assign {whole ? "the course" : picked.length ? `${picked.length} ${picked.length === 1 ? "lesson" : "lessons"}` : "lessons"}
        </Button>
      </div>
    </form>
  );
}
