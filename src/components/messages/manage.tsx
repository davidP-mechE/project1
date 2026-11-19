"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Card } from "@/components/ui/misc";
import { cancelScheduledAction, createSavedReplyAction, deleteSavedReplyAction, updateSavedReplyAction, updateScheduledAction } from "@/server/actions/comms";
import { PlaceholderHint } from "./compose-tools";

const area = "min-h-28 w-full rounded-lg border border-border bg-surface p-3 text-sm text-text focus-visible:border-focus";

type Reply = { id: string; title: string; body: string; programId: string | null; programName: string | null; canEdit: boolean; ownerName: string };

/** Write or edit a saved reply: a name, the text, and personal or shared with a program. */
function ReplyEditor({ programs, initial, onDone }: { programs: { id: string; name: string }[]; initial?: Reply; onDone: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [share, setShare] = useState(initial?.programId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const t = useId();
  const b = useId();
  const s = useId();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const input = { title, body, programId: share || null };
          const r = initial ? await updateSavedReplyAction(initial.id, input) : await createSavedReplyAction(input);
          if (!r.ok) return setError(r.error);
          setError(null);
          if (!initial) {
            setTitle("");
            setBody("");
          }
          router.refresh();
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={t} className="text-sm font-medium">Name</label>
          <input id={t} required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClasses} placeholder="e.g. Missing work nudge" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={s} className="text-sm font-medium">Who can use it</label>
          <select id={s} value={share} onChange={(e) => setShare(e.target.value)} className={inputClasses}>
            <option value="">Only me</option>
            {programs.map((p) => <option key={p.id} value={p.id}>Shared with {p.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={b} className="text-sm font-medium">Text</label>
        <textarea id={b} required maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} className={area} placeholder="Hi {first_name}, just a reminder that your {class} work is due {due_date}." />
        <PlaceholderHint />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{initial ? "Save changes" : "Save reply"}</Button>
        {initial && <Button variant="ghost" onClick={onDone}>Cancel</Button>}
      </div>
    </form>
  );
}

export function NewReply({ programs }: { programs: { id: string; name: string }[] }) {
  return <ReplyEditor programs={programs} onDone={() => {}} />;
}

export function ReplyRow({ reply, programs }: { reply: Reply; programs: { id: string; name: string }[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (editing) return <ReplyEditor programs={programs} initial={reply} onDone={() => setEditing(false)} />;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">{reply.title}</h3>
        <span className="text-xs text-muted">{reply.programName ? `Shared with ${reply.programName} · by ${reply.ownerName}` : "Only you"}</span>
        {reply.canEdit && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await deleteSavedReplyAction(reply.id); if (!r.ok) return setError(r.error); router.refresh(); })}>Delete</Button>
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm text-muted">{reply.body}</p>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

type Scheduled = { id: string; kind: string; title: string | null; body: string; sendAtLocal: string; sendAtText: string; status: string; className: string; error: string | null; reached: number | null; audience: string };

const STATUS: Record<string, string> = { PENDING: "Waiting", SENDING: "Sending now", SENT: "Sent", CANCELLED: "Cancelled", FAILED: "Not sent" };

/** One scheduled item: shows when and to whom; while waiting it can be edited or cancelled. */
export function ScheduledCard({ item }: { item: Scheduled }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title ?? "");
  const [body, setBody] = useState(item.body);
  const [when, setWhen] = useState(item.sendAtLocal);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const t = useId();
  const b = useId();
  const w = useId();
  const waiting = item.status === "PENDING";
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-semibold">{item.kind === "ANNOUNCEMENT" ? `Announcement: ${item.title}` : "Message"}</h2>
        <span className="text-sm text-muted">{item.className} · {item.audience}</span>
        <span className={item.status === "FAILED" ? "text-sm font-semibold text-danger" : item.status === "SENT" ? "text-sm font-semibold text-success" : "text-sm font-semibold"}>
          {STATUS[item.status] ?? item.status}
          {item.status === "SENT" && item.reached !== null ? ` to ${item.reached}` : ""}
        </span>
        <span className="text-sm">{waiting ? `Sends ${item.sendAtText}` : item.sendAtText}</span>
      </div>
      {item.error && <Alert tone="error">{item.error}</Alert>}
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await updateScheduledAction(item.id, { body, ...(item.kind === "ANNOUNCEMENT" ? { title } : {}), sendAt: new Date(when).toISOString() });
              if (!r.ok) return setError(r.error);
              setError(null);
              setEditing(false);
              router.refresh();
            });
          }}
        >
          {item.kind === "ANNOUNCEMENT" && (
            <div className="flex flex-col gap-1">
              <label htmlFor={t} className="text-sm font-medium">Title</label>
              <input id={t} required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClasses} />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor={b} className="text-sm font-medium">Text</label>
            <textarea id={b} required maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} className={area} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={w} className="text-sm font-medium">Send at</label>
            <input id={w} type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} className={`${inputClasses} w-60`} />
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm text-muted">{item.body}</p>
          {waiting && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await cancelScheduledAction(item.id); if (!r.ok) return setError(r.error); router.refresh(); })}>Cancel sending</Button>
            </div>
          )}
          {error && !editing && <Alert tone="error">{error}</Alert>}
        </>
      )}
    </Card>
  );
}
