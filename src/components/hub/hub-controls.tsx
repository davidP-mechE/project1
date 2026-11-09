"use client";

import { useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { publishAction, setPublishedAction } from "@/server/actions/hub";
import { SUBJECTS } from "@/lib/subjects";

/** "Add to my library": copying a big course takes a moment, so show it. */
export function EnrollButton({ title }: { title: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Adding…" : "Add to my library"}
      <span className="sr-only">: {title}</span>
    </Button>
  );
}

export function PublishToggle({ entryId, published }: { entryId: string; published: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => setMsg((await setPublishedAction(entryId, !published)).ok ? null : "Couldn't change it."))}>
        {published ? "Hide from Hub" : "Show in Hub"}
      </Button>
      {msg && <span className="text-xs text-danger">{msg}</span>}
    </span>
  );
}

type Initial = { description: string; subject: string; license: string; attribution: string; sourceUrl: string | null } | null;

/** Admins, on a course page: publish it to the Hub as a provided course (e.g. an OpenStax book). */
export function PublishForm({ courseId, title, subject, initial, students }: { courseId: string; title: string; subject: string; initial: Initial; students: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState({
    description: initial?.description ?? "",
    subject: initial?.subject ?? subject,
    license: initial?.license ?? "CC BY 4.0",
    attribution:
      initial?.attribution ??
      `"${title}" by OpenStax, Rice University, licensed under CC BY 4.0. Download for free at https://openstax.org. Lessons, questions and flashcards were generated from the book by Coursebook.`,
    sourceUrl: initial?.sourceUrl ?? "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await publishAction(courseId, f);
          setResult(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error });
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">Description</span>
        <textarea required value={f.description} onChange={set("description")} rows={3} maxLength={600} className={`${inputClasses} h-auto py-2`} placeholder="What this course covers and who it's for." />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">Subject</span>
          <select value={f.subject} onChange={set("subject")} className={inputClasses}>
            {SUBJECTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">License</span>
          <input value={f.license} onChange={set("license")} maxLength={80} className={inputClasses} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">Attribution (shown to students)</span>
        <textarea required value={f.attribution} onChange={set("attribution")} rows={3} maxLength={600} className={`${inputClasses} h-auto py-2`} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">Link to the original (optional)</span>
        <input type="url" value={f.sourceUrl} onChange={set("sourceUrl")} placeholder="https://openstax.org/details/books/…" className={inputClasses} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Publishing…" : initial ? "Update Hub listing" : "Publish to the Hub"}
        </Button>
        {initial && <span className="text-sm text-muted">{students} {students === 1 ? "student has" : "students have"} added it.</span>}
        {result && (
          <span role="status" className={result.ok ? "text-sm text-success" : "text-sm text-danger"}>
            {result.text}
          </span>
        )}
      </div>
    </form>
  );
}
