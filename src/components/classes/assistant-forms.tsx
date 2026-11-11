"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Markdown } from "@/components/lesson/markdown";
import {
  approveDraftItemsAction,
  approveLessonAction,
  askAction,
  deleteLessonAction,
  draftLessonAction,
  draftQuestionsAction,
  generateSummaryAction,
  importCurriculumAction,
  publishCurriculumAction,
  setCalendarAction,
  suggestionAction,
  updateLessonAction,
  updateUnitAction,
} from "@/server/actions/assistant";
import { DOMAINS, SECTIONS, domainById } from "@/lib/sat/domains";

const select = "h-11 rounded-lg border border-border bg-surface px-3 text-sm";

function DomainSelect({ value, onChange, allowed }: { value: string; onChange: (v: string) => void; allowed: string[] | null }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">Domain</span>
      <select className={select} value={value} onChange={(e) => onChange(e.target.value)}>
        {SECTIONS.map((s) => (
          <optgroup key={s.id} label={s.name}>
            {DOMAINS.filter((d) => d.section === s.id && (!allowed || allowed.includes(d.id))).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

// ─── Curriculum ──

export function CurriculumImport({ classId }: { classId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (template: boolean) =>
    start(async () => {
      const r = await importCurriculumAction(classId, template ? { template: true } : { text });
      if (!r.ok) return setError(r.error);
      setError(null);
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Paste your syllabus or outline</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder={"Week 1: Diagnostic\nWeeks 2–3: Linear equations and functions\n…"} />
      </label>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending || text.trim().length < 40} onClick={() => go(false)}>
          {pending ? "Reading…" : "Turn it into units"}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => go(true)}>
          Start from the SAT template
        </Button>
      </div>
      <p className="text-xs text-muted">Claude reads pasted text once (about 5 cents). The template uses no AI. Either way you get a draft to edit; students only see it once you publish.</p>
    </div>
  );
}

export function UnitRow({ classId, unit, canEdit }: { classId: string; unit: { id: string; title: string; domains: string[]; startsOn: string; endsOn: string; notes: string }; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(unit);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <span className="font-medium">{unit.title}</span>
          <span className="ml-2 text-sm text-muted">
            {fmt(unit.startsOn)}–{fmt(unit.endsOn)}
            {unit.domains.length > 0 && ` · ${unit.domains.map((d) => domainById(d)?.name).join(", ")}`}
          </span>
        </span>
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
            Edit
          </Button>
        )}
      </div>
      {unit.notes && !open && <p className="text-sm text-muted">{unit.notes}</p>}
      {open && (
        <form
          className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await updateUnitAction(classId, unit.id, { title: f.title, startsOn: f.startsOn, endsOn: f.endsOn, notes: f.notes });
              if (!r.ok) return setError(r.error);
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <Field label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="sm:col-span-3" />
          <Field label="Starts" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
          <Field label="Ends" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
          <label className="flex flex-col gap-1.5 text-sm sm:col-span-3">
            <span className="font-medium">Notes</span>
            <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} className="rounded-lg border border-border bg-surface px-3 py-2" />
          </label>
          {error && <Alert tone="error" className="sm:col-span-3">{error}</Alert>}
          <div>
            <Button size="sm" type="submit" disabled={pending}>
              Save
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

export function PublishCurriculumButton({ classId, curriculumId }: { classId: string; curriculumId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button disabled={pending} onClick={() => start(async () => { await publishCurriculumAction(classId, curriculumId); router.refresh(); })}>
      Publish to students
    </Button>
  );
}

export function SuggestionCard({ classId, s }: { classId: string; s: { key: string; text: string } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (accept: boolean) => start(async () => { await suggestionAction(classId, s.key, accept); router.refresh(); });
  return (
    <Alert tone="info">
      <p>{s.text}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => act(true)}>
          Add the week
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(false)}>
          Not now
        </Button>
      </div>
    </Alert>
  );
}

export function CalendarForm({ programId, termStart, termEnd, closedDates }: { programId: string; termStart: string | null; termEnd: string | null; closedDates: string[] }) {
  const router = useRouter();
  const [f, setF] = useState({ termStart: termStart ?? "", termEnd: termEnd ?? "", closed: closedDates.join("\n") });
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setCalendarAction(programId, { termStart: f.termStart || null, termEnd: f.termEnd || null, closedDates: f.closed.split(/[\s,]+/).filter(Boolean) });
          setMsg(r.ok ? { tone: "success", text: "Saved." } : { tone: "error", text: r.error });
          router.refresh();
        });
      }}
    >
      <Field label="Term starts" type="date" value={f.termStart} onChange={(e) => setF({ ...f, termStart: e.target.value })} />
      <Field label="Term ends" type="date" value={f.termEnd} onChange={(e) => setF({ ...f, termEnd: e.target.value })} />
      <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
        <span className="font-medium">Days with no sessions (one per line, like 2026-11-26)</span>
        <textarea value={f.closed} onChange={(e) => setF({ ...f, closed: e.target.value })} rows={4} className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm" />
      </label>
      <div className="flex flex-col gap-2 sm:col-span-2">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            Save calendar
          </Button>
        </div>
      </div>
    </form>
  );
}

// ─── Assistant ──

export function AskForm({ classId }: { classId: string }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ text: string; lookups: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await askAction(classId, q);
          if (!r.ok) return setError(r.error);
          setError(null);
          setAnswer({ text: r.answer, lookups: r.lookups });
        });
      }}
    >
      <Field label="Ask about your class" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="e.g. Who is weakest in Advanced Math? Who missed 2+ sessions and dropped?" />
      <div>
        <Button type="submit" disabled={pending || q.trim().length < 5}>
          {pending ? "Looking…" : "Ask"}
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {answer && (
        <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm" aria-live="polite">
          <Markdown className="[&_p]:m-0">{answer.text}</Markdown>
          {answer.lookups.length > 0 && <p className="mt-2 text-xs text-muted">Looked at: {[...new Set(answer.lookups)].join(", ").replace(/_/g, " ")}</p>}
        </div>
      )}
    </form>
  );
}

export function SummaryButton({ classId, groups }: { classId: string; groups: { id: string; name: string }[] }) {
  const router = useRouter();
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-2">
      {groups.length > 0 && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">For</span>
          <select className={select} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">The whole class</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await generateSummaryAction(classId, groupId || null); if (!r.ok) setError(r.error); else setError(null); router.refresh(); })}>
        {pending ? "Writing…" : "Write this week's summary"}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

export function DraftQuestionsForm({ classId, allowed }: { classId: string; allowed: string[] | null }) {
  const router = useRouter();
  const first = DOMAINS.find((d) => !allowed || allowed.includes(d.id))?.id ?? "algebra";
  const [domain, setDomain] = useState(first);
  const [skill, setSkill] = useState("");
  const [difficulty, setDifficulty] = useState<"EASY" | "MEDIUM" | "HARD">("MEDIUM");
  const [count, setCount] = useState("5");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await draftQuestionsAction(classId, { domain, skill: skill || undefined, difficulty, count: Number(count) });
          if (!r.ok) return setError(r.error);
          setError(null);
          setDone(r.worksheetId);
          router.refresh();
        });
      }}
    >
      <DomainSelect value={domain} onChange={(v) => (setDomain(v), setSkill(""))} allowed={allowed} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Skill</span>
        <select className={select} value={skill} onChange={(e) => setSkill(e.target.value)}>
          <option value="">Any</option>
          {domainById(domain)?.skills.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Difficulty</span>
        <select className={select} value={difficulty} onChange={(e) => setDifficulty(e.target.value as "EASY")}>
          <option value="EASY">Easy</option>
          <option value="MEDIUM">Medium</option>
          <option value="HARD">Hard</option>
        </select>
      </label>
      <Field label="How many" type="number" min={1} max={10} value={count} onChange={(e) => setCount(e.target.value)} />
      <div className="flex flex-col gap-2 sm:col-span-4">
        {error && <Alert tone="error">{error}</Alert>}
        {done && (
          <Alert tone="success">
            Drafted. <Link href={`/teach/worksheets/${done}`} className="font-semibold underline">Review and approve them</Link> before assigning.
          </Alert>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Drafting…" : "Draft questions"}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function DraftLessonForm({ classId, allowed }: { classId: string; allowed: string[] | null }) {
  const router = useRouter();
  const [domain, setDomain] = useState(DOMAINS.find((d) => !allowed || allowed.includes(d.id))?.id ?? "algebra");
  const [skill, setSkill] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await draftLessonAction(classId, { domain, skill: skill || undefined });
          if (!r.ok) return setError(r.error);
          setError(null);
          router.refresh();
        });
      }}
    >
      <DomainSelect value={domain} onChange={(v) => (setDomain(v), setSkill(""))} allowed={allowed} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Skill</span>
        <select className={select} value={skill} onChange={(e) => setSkill(e.target.value)}>
          <option value="">The whole domain</option>
          {domainById(domain)?.skills.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Drafting…" : "Draft a lesson"}
        </Button>
      </div>
      {error && <Alert tone="error" className="sm:col-span-3">{error}</Alert>}
    </form>
  );
}

export function LessonReview({ classId, lesson }: { classId: string; lesson: { id: string; title: string; content: string; approved: boolean } }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ title: lesson.title, content: lesson.content });
  const [pending, start] = useTransition();
  const refresh = () => router.refresh();
  return (
    <div className="flex flex-col gap-3">
      {editing ? (
        <>
          <Field label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Lesson (Markdown)</span>
            <textarea value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} rows={12} className="rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm" />
          </label>
        </>
      ) : (
        <Markdown>{lesson.content}</Markdown>
      )}
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <Button size="sm" disabled={pending} onClick={() => start(async () => { await updateLessonAction(classId, lesson.id, f); setEditing(false); refresh(); })}>
            Save
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        <Button size="sm" variant={lesson.approved ? "ghost" : "primary"} disabled={pending} onClick={() => start(async () => { await approveLessonAction(classId, lesson.id, !lesson.approved); refresh(); })}>
          {lesson.approved ? "Hide from students" : "Approve: show to students"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Delete this lesson?") && start(async () => { await deleteLessonAction(classId, lesson.id); refresh(); })}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export function ApproveDraftButtons({ worksheetId, itemId, pendingCount }: { worksheetId: string; itemId?: string; pendingCount?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant={itemId ? "secondary" : "primary"} disabled={pending} onClick={() => start(async () => { await approveDraftItemsAction(worksheetId, itemId ? [itemId] : "all"); router.refresh(); })}>
      {itemId ? "Approve this question" : `Approve all ${pendingCount}`}
    </Button>
  );
}
