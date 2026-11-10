"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { inputClasses } from "@/components/ui/field";
import { TargetPicker, type TargetValue } from "@/components/classes/target-picker";
import { bulkMessageAction, createAnnouncementAction, deleteAnnouncementAction, markNotificationsReadAction, sendMessageAction, startThreadAction, updateAnnouncementAction } from "@/server/actions/messages";

const area = "min-h-28 w-full rounded-lg border border-border bg-surface p-3 text-sm text-text placeholder:text-muted focus-visible:border-focus";
const MAX = 4000;

function Counter({ n }: { n: number }) {
  return <span className={n > MAX ? "text-danger" : "text-muted"}>{n.toLocaleString("en-US")} / {MAX.toLocaleString("en-US")}</span>;
}

/** Reply box at the bottom of a conversation. */
export function ReplyForm({ threadId }: { threadId: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await sendMessageAction(threadId, body);
          if (!r.ok) return setError(r.error);
          setBody("");
          setError(null);
          router.refresh();
        });
      }}
    >
      <label htmlFor="reply" className="text-sm font-medium">
        Reply
      </label>
      <textarea id="reply" value={body} onChange={(e) => setBody(e.target.value)} className={area} required maxLength={MAX + 100} />
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex items-center justify-between text-xs">
        <Counter n={body.length} />
        <Button type="submit" disabled={pending || !body.trim() || body.length > MAX}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

type Contacts = {
  tutors: { classId: string; className: string; staffId: string; name: string; role: string }[];
  staffClasses: { id: string; name: string; groups: { id: string; name: string }[]; students: { id: string; name: string }[] }[];
};

/** Start a conversation: students pick a tutor; staff pick one student, or send to many. */
export function NewMessageForm({ contacts }: { contacts: Contacts }) {
  const router = useRouter();
  const isStaff = contacts.staffClasses.length > 0;
  const [to, setTo] = useState<"tutor" | "student" | "many">(isStaff ? "student" : "tutor");
  const [classId, setClassId] = useState(contacts.staffClasses[0]?.id ?? "");
  const [studentId, setStudentId] = useState("");
  const [tutor, setTutor] = useState("");
  const [targets, setTargets] = useState<TargetValue>({ groupIds: [], studentIds: [] });
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cls = contacts.staffClasses.find((c) => c.id === classId);

  if (!isStaff && !contacts.tutors.length) return <p className="text-sm text-muted">Once you join a class, you can message its tutors here.</p>;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setDone(null);
        start(async () => {
          if (to === "many") {
            const r = await bulkMessageAction(classId, { ...targets, body });
            if (!r.ok) return setError(r.error);
            setBody("");
            setDone(`Sent to ${r.sent} student${r.sent === 1 ? "" : "s"}, each in their own conversation.`);
            return router.refresh();
          }
          const [tClass, staffId] = tutor.split("|");
          const r = to === "tutor" ? await startThreadAction({ classId: tClass, staffId, body }) : await startThreadAction({ classId, studentId, body });
          if (!r.ok) return setError(r.error);
          router.push(`/messages/${r.threadId}`);
        });
      }}
    >
      {isStaff && (
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1 font-medium">Send to</legend>
          <label className="flex items-center gap-2">
            <input type="radio" checked={to === "student"} onChange={() => setTo("student")} className="size-4 accent-[var(--primary)]" /> One student
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={to === "many"} onChange={() => setTo("many")} className="size-4 accent-[var(--primary)]" /> A class, group or several students
          </label>
        </fieldset>
      )}
      {to === "tutor" ? (
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Tutor
          <select required value={tutor} onChange={(e) => setTutor(e.target.value)} className={inputClasses}>
            <option value="">Choose a tutor…</option>
            {contacts.tutors.map((t) => (
              <option key={`${t.classId}|${t.staffId}`} value={`${t.classId}|${t.staffId}`}>
                {t.name} ({t.role === "TEACHER" ? "teacher" : "tutor"}, {t.className})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Class
            <select value={classId} onChange={(e) => (setClassId(e.target.value), setStudentId(""), setTargets({ groupIds: [], studentIds: [] }))} className={inputClasses}>
              {contacts.staffClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {to === "student" ? (
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Student
              <select required value={studentId} onChange={(e) => setStudentId(e.target.value)} className={inputClasses}>
                <option value="">Choose a student…</option>
                {cls?.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            cls && <TargetPicker key={cls.id} options={{ groups: cls.groups, students: cls.students }} value={targets} onChange={setTargets} />
          )}
        </>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-message" className="text-sm font-medium">
          Message
        </label>
        <textarea id="new-message" required value={body} onChange={(e) => setBody(e.target.value)} className={area} maxLength={MAX + 100} />
        <p className="text-xs">
          <Counter n={body.length} />
        </p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}
      <div>
        <Button type="submit" disabled={pending || !body.trim() || body.length > MAX}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

/** A notification row: opening it marks it read. */
export function NotificationLink({ id, href, unread, children }: { id: string; href: string; unread: boolean; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <a
      href={href}
      onClick={(e) => {
        if (!unread || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        void markNotificationsReadAction(id).finally(() => router.push(href as never));
      }}
      className="block rounded-lg px-3 py-3 hover:bg-surface-2"
    >
      {children}
    </a>
  );
}

export function MarkAllRead() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" size="sm" disabled={pending} onClick={() => start(async () => void (await markNotificationsReadAction("all"), router.refresh()))}>
      Mark all read
    </Button>
  );
}

/** Post an announcement to the class or one group. */
export function AnnouncementForm({ classId, groups, groupOnly }: { classId: string; groups: { id: string; name: string }[]; groupOnly: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [groupId, setGroupId] = useState(groupOnly ? (groups[0]?.id ?? "") : "");
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createAnnouncementAction(classId, { title, body, groupId: groupId || null, pinned });
          if (!r.ok) return setError(r.error);
          setTitle("");
          setBody("");
          setPinned(false);
          setError(null);
          router.refresh();
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Title
        <input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClasses} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Announcement
        <textarea required value={body} onChange={(e) => setBody(e.target.value)} className={area} maxLength={MAX + 100} />
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          For
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputClasses}>
            {!groupOnly && <option value="">The whole class</option>}
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="size-4 accent-[var(--primary)]" /> Pin to the top
        </label>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Posting…" : "Post announcement"}
        </Button>
      </div>
    </form>
  );
}

export function AnnouncementActions({ classId, id, pinned, title, body }: { classId: string; id: string; pinned: boolean; title: string; body: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [t, setT] = useState(title);
  const [b, setB] = useState(body);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong.");
      setEditing(false);
      setError(null);
      router.refresh();
    });
  if (editing)
    return (
      <div className="mt-3 flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Title
          <input value={t} onChange={(e) => setT(e.target.value)} className={inputClasses} maxLength={120} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Announcement
          <textarea value={b} onChange={(e) => setB(e.target.value)} className={area} />
        </label>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => act(() => updateAnnouncementAction(classId, id, { title: t, body: b }))}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(true)}>
        Edit<span className="sr-only"> {title}</span>
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => updateAnnouncementAction(classId, id, { pinned: !pinned }))}>
        {pinned ? "Unpin" : "Pin"}
        <span className="sr-only"> {title}</span>
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm("Delete this announcement?") && act(() => deleteAnnouncementAction(classId, id))}>
        Delete<span className="sr-only"> {title}</span>
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
