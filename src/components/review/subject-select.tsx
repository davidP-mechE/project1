"use client";

import { useState, useTransition } from "react";
import { setSubjectAction } from "@/server/actions/hub";
import { SUBJECTS } from "@/lib/subjects";

/** Change which subject a course counts toward on the Mastery page. */
export function SubjectSelect({ courseId, subject, title }: { courseId: string; subject: string; title: string }) {
  const [value, setValue] = useState(subject);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label={`Subject for ${title}`}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          const before = value;
          setValue(next);
          setError(null);
          start(async () => {
            const r = await setSubjectAction(courseId, next);
            if (!r.ok) {
              setValue(before);
              setError(r.error);
            }
          });
        }}
        className="h-8 rounded-lg border border-border bg-surface px-2 text-sm"
      >
        {SUBJECTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
