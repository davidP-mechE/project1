"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { PLACEHOLDERS } from "@/lib/messaging/placeholders";

export type SavedReplyOption = { id: string; title: string; body: string; programName: string | null };

/** Insert a saved reply into the text being written (added at the end). */
export function SavedReplyPicker({ replies, onInsert }: { replies: SavedReplyOption[]; onInsert: (body: string) => void }) {
  const [pick, setPick] = useState("");
  const id = useId();
  if (!replies.length) {
    return (
      <p className="text-xs text-muted">
        <Link href="/messages/replies" className="underline">Save replies</Link> you send often, then insert them here.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-xs font-medium">Saved reply</label>
        <select id={id} value={pick} onChange={(e) => setPick(e.target.value)} className={`${inputClasses} h-9 w-60`}>
          <option value="">Choose one…</option>
          {replies.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
              {r.programName ? ` (shared: ${r.programName})` : ""}
            </option>
          ))}
        </select>
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={!pick}
        onClick={() => {
          const r = replies.find((x) => x.id === pick);
          if (r) onInsert(r.body);
          setPick("");
        }}
      >
        Insert
      </Button>
      <Link href="/messages/replies" className="h-8 content-center text-xs text-muted underline underline-offset-2">Manage</Link>
    </div>
  );
}

/** "Send later": off sends now; on, a date and time (in the viewer's own zone, as the browser shows it). */
export function SendLater({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={value !== null} onChange={(e) => onChange(e.target.checked ? "" : null)} className="size-4 accent-[var(--primary)]" /> Send later
      </label>
      {value !== null && (
        <>
          <label htmlFor={id} className="sr-only">Send at</label>
          <input id={id} type="datetime-local" required value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClasses} h-9 w-56`} />
          <Link href="/messages/scheduled" className="text-xs text-muted underline underline-offset-2">Scheduled sends</Link>
        </>
      )}
    </div>
  );
}

/** A one-line reminder of the placeholders. */
export function PlaceholderHint({ announcement }: { announcement?: boolean }) {
  return (
    <p className="text-xs text-muted">
      Placeholders: {PLACEHOLDERS.map((p) => <code key={p.token} className="mx-0.5">{p.token}</code>)}
      {announcement ? " (in announcements, {first_name} reads “everyone” and {due_date} “soon”)." : " are filled in for each student."}
    </p>
  );
}
