"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Markdown } from "@/components/lesson/markdown";
import { DesmosGraph, type DesmosHandle } from "@/components/desmos/desmos-graph";
import { DESMOS_TECHNIQUES } from "@/lib/bank/import";
import * as A from "@/server/actions/studio";
import { cn } from "@/lib/utils";

type Res = { ok: true } | { ok: false; error: string };

function useAct() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<Res>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error);
      after?.();
      router.refresh();
    });
  return { error, pending, act, setError };
}

export function StatusPill({ status }: { status: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", status === "published" ? "bg-success-bg text-success" : status === "archived" ? "bg-surface-2 text-muted" : "bg-warning-bg text-warning")}>{status === "published" ? "Published" : status === "archived" ? "Archived" : "Draft"}</span>;
}

export function NewCourseForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [section, setSection] = useState("math");
  const { error, pending, setError } = useAct();
  const [busy, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await A.createCourseAction({ title, section });
          if (!r.ok) return setError(r.error);
          router.push(`/studio/courses/${r.courseId}`);
        });
      }}
    >
      <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
        Title
        <input className={inputClasses} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Section
        <select className={inputClasses} value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="math">Math</option>
          <option value="ebrw">EBRW</option>
          <option value="other">Other</option>
        </select>
      </label>
      <Button type="submit" disabled={pending || busy}>New course</Button>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}

/** Title, section, description; publish (with a typed confirmation), unpublish, archive, delete. */
export function CourseSettings({ course }: { course: { id: string; title: string; section: string; description: string; status: string; slug: string } }) {
  const router = useRouter();
  const [v, setV] = useState({ title: course.title, section: course.section, description: course.description });
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const { error, pending, act } = useAct();
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Title
          <input className={inputClasses} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={160} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Section
          <select className={inputClasses} value={v.section} onChange={(e) => setV({ ...v, section: e.target.value })}>
            <option value="math">Math</option>
            <option value="ebrw">EBRW</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          Description
          <textarea className={cn(inputClasses, "h-20 py-2")} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} maxLength={4000} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={pending} onClick={() => act(() => A.updateCourseAction(course.id, v))}>Save details</Button>
        <ButtonLink href={`/studio/courses/${course.id}/preview`} variant="secondary">Preview as student</ButtonLink>
        {course.status === "published" ? (
          <Button variant="secondary" disabled={pending} onClick={() => confirm("Unpublish? Students will no longer see this course.") && act(() => A.unpublishCourseAction(course.id))}>Unpublish</Button>
        ) : (
          <Button disabled={pending} onClick={() => setConfirming(true)}>Publish…</Button>
        )}
        {course.status === "draft" && <Button variant="ghost" disabled={pending} onClick={() => act(() => A.archiveCourseAction(course.id))}>Archive</Button>}
        {course.status === "archived" && <Button variant="ghost" disabled={pending} onClick={() => act(() => A.unpublishCourseAction(course.id))}>Restore to draft</Button>}
        {course.status !== "published" && (
          <Button variant="danger" className="ml-auto" disabled={pending} onClick={() => confirm("Delete this course and all its lessons and files? This can't be undone.") && act(() => A.deleteCourseAction(course.id), () => router.push("/studio"))}>
            Delete
          </Button>
        )}
      </div>
      {confirming && (
        <div role="dialog" aria-label="Confirm publishing" className="flex flex-col gap-3 rounded-lg border-[1.5px] border-warning bg-warning-bg p-4 text-sm">
          <p className="font-semibold text-text">Publish &ldquo;{course.title}&rdquo;?</p>
          <p className="text-text">It becomes public: every signed-in student can find it in Courses and open its lessons and files. Draft question sets inside it stay hidden until you publish them.</p>
          <label className="flex flex-col gap-1 font-medium text-text">
            Type the course title to confirm
            <input className={inputClasses} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button disabled={pending || typed.trim() !== course.title} onClick={() => act(() => A.publishCourseAction(course.id, typed), () => setConfirming(false))}>Publish now</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/** Units and lessons: add, rename, reorder, delete. */
export function CourseOutlineEditor({ courseId, units }: { courseId: string; units: { id: string; title: string; lessons: { id: string; title: string; desmosTechnique: string | null; _count: { blocks: number } }[] }[] }) {
  const { error, pending, act } = useAct();
  const [unitTitle, setUnitTitle] = useState("");
  return (
    <div className="flex flex-col gap-4">
      {units.map((u, ui) => (
        <UnitRow key={u.id} unit={u} first={ui === 0} last={ui === units.length - 1} />
      ))}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
          New unit
          <input className={inputClasses} value={unitTitle} onChange={(e) => setUnitTitle(e.target.value)} maxLength={160} />
        </label>
        <Button variant="secondary" disabled={pending} onClick={() => act(() => A.addUnitAction(courseId, unitTitle), () => setUnitTitle(""))}>Add unit</Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

function UnitRow({ unit, first, last }: { unit: { id: string; title: string; lessons: { id: string; title: string; desmosTechnique: string | null; _count: { blocks: number } }[] }; first: boolean; last: boolean }) {
  const { error, pending, act } = useAct();
  const [title, setTitle] = useState(unit.title);
  const [lesson, setLesson] = useState("");
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
          Unit title
          <input className={inputClasses} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== unit.title && act(() => A.renameUnitAction(unit.id, title))} maxLength={160} />
        </label>
        <Button size="sm" variant="ghost" disabled={pending || first} aria-label={`Move ${unit.title} up`} onClick={() => act(() => A.moveUnitAction(unit.id, -1))}>↑</Button>
        <Button size="sm" variant="ghost" disabled={pending || last} aria-label={`Move ${unit.title} down`} onClick={() => act(() => A.moveUnitAction(unit.id, 1))}>↓</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm(`Delete "${unit.title}" and its lessons?`) && act(() => A.deleteUnitAction(unit.id))}>Delete</Button>
      </div>
      <ol className="flex flex-col divide-y divide-border">
        {unit.lessons.map((l, i) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 py-2">
            <Link href={`/studio/lessons/${l.id}`} className="flex-1 underline-offset-2 hover:underline">
              {i + 1}. {l.title}
            </Link>
            <span className="text-xs text-muted">
              {l._count.blocks} block{l._count.blocks === 1 ? "" : "s"}
              {l.desmosTechnique ? ` · Toolkit: ${l.desmosTechnique.replace(/_/g, "-")}` : ""}
            </span>
            <Button size="sm" variant="ghost" disabled={pending || i === 0} aria-label={`Move ${l.title} up`} onClick={() => act(() => A.moveLessonAction(l.id, -1))}>↑</Button>
            <Button size="sm" variant="ghost" disabled={pending || i === unit.lessons.length - 1} aria-label={`Move ${l.title} down`} onClick={() => act(() => A.moveLessonAction(l.id, 1))}>↓</Button>
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <input className={inputClasses} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="New lesson title" aria-label={`New lesson in ${unit.title}`} maxLength={160} />
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => A.addLessonAction(unit.id, lesson), () => setLesson(""))}>Add lesson</Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

type Block = { id: string; kind: "markdown" | "file" | "desmos" | "question_set"; data: Record<string, unknown> };

/** A lesson's title, Desmos Toolkit tag, uploads and content blocks. */
export function LessonEditor({ lesson, blocks, files, sets, desmosKey }: { lesson: { id: string; title: string; desmosTechnique: string | null; courseId: string }; blocks: Block[]; files: { id: string; name: string; contentType: string }[]; sets: { id: string; title: string; status: string }[]; desmosKey: string | null }) {
  const router = useRouter();
  const { error, pending, act } = useAct();
  const [title, setTitle] = useState(lesson.title);
  const [tech, setTech] = useState(lesson.desmosTechnique?.replace(/_/g, "-") ?? "");
  const [uploads, setUploads] = useState<{ name: string; ok: boolean; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<null | "markdown" | "desmos" | "question_set">(null);
  const fileName = new Map(files.map((f) => [f.id, f]));

  async function upload(list: FileList) {
    setBusy(true);
    const out: typeof uploads = [];
    for (const f of Array.from(list)) {
      const body = new FormData();
      body.set("file", f);
      try {
        const res = await fetch(`/api/studio/lessons/${lesson.id}/upload`, { method: "POST", body });
        const j = (await res.json()) as { error?: string; kind?: string; imported?: number; failed?: number; skipped?: number; problems?: { row: number; errors: string[] }[] };
        if (!res.ok) out.push({ name: f.name, ok: false, text: j.error ?? "Upload failed." });
        else if (j.kind === "question_set")
          out.push({ name: f.name, ok: !j.failed, text: `Imported ${j.imported} questions as drafts in a new draft set${j.skipped ? ` (${j.skipped} were already in the bank)` : ""}.${j.failed ? ` ${j.failed} bad rows: ${j.problems!.slice(0, 5).map((p) => `row ${p.row}: ${p.errors.join(" ")}`).join("; ")}` : ""}` });
        else out.push({ name: f.name, ok: true, text: "Added." });
      } catch {
        out.push({ name: f.name, ok: false, text: "Upload failed." });
      }
    }
    setUploads(out);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Lesson title
          <input className={inputClasses} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Desmos Toolkit technique
          <select className={inputClasses} value={tech} onChange={(e) => setTech(e.target.value)}>
            <option value="">None</option>
            {DESMOS_TECHNIQUES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <Button variant="secondary" disabled={pending} onClick={() => act(() => A.updateLessonAction(lesson.id, { title, desmosTechnique: tech || null }))}>Save</Button>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
        <label className="text-sm font-medium" htmlFor={`up-${lesson.id}`}>
          Upload files: PDF (25 MB), images (5 MB), Markdown (1 MB) or question-set JSON in the import format (5 MB)
        </label>
        <input id={`up-${lesson.id}`} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.md,.markdown,.json" disabled={busy} onChange={(e) => e.target.files?.length && upload(e.target.files)} className="text-sm" />
        {busy && <p className="text-sm text-muted">Uploading…</p>}
        {uploads.map((u) => (
          <Alert key={u.name} tone={u.ok ? "success" : "error"}>
            {u.name}: {u.text}
          </Alert>
        ))}
      </div>

      <ol className="flex flex-col gap-3">
        {blocks.map((b, i) => (
          <li key={b.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow flex-1">{b.kind === "question_set" ? "Question set" : b.kind === "desmos" ? "Desmos check" : b.kind === "file" ? "File" : "Text"}</span>
              <Button size="sm" variant="ghost" disabled={pending || i === 0} aria-label="Move block up" onClick={() => act(() => A.moveBlockAction(b.id, -1))}>↑</Button>
              <Button size="sm" variant="ghost" disabled={pending || i === blocks.length - 1} aria-label="Move block down" onClick={() => act(() => A.moveBlockAction(b.id, 1))}>↓</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm("Delete this block?") && act(() => A.deleteBlockAction(b.id))}>Delete</Button>
            </div>
            {b.kind === "markdown" && <MarkdownBlock blockId={b.id} text={String(b.data.text ?? "")} />}
            {b.kind === "file" && <p className="text-sm">{fileName.get(String(b.data.fileId))?.name ?? "File"} · <a className="underline" href={`/api/studio/files/${String(b.data.fileId)}`} target="_blank" rel="noopener">open</a></p>}
            {b.kind === "desmos" && <DesmosBlockEditor desmosKey={desmosKey} blockId={b.id} initial={b.data as { state: object; interactive: boolean; title?: string }} />}
            {b.kind === "question_set" && <p className="text-sm">{sets.find((s) => s.id === b.data.setId)?.title ?? "A set"} ({sets.find((s) => s.id === b.data.setId)?.status ?? "missing"}) · <Link className="underline" href={`/bank/sets/${String(b.data.setId)}`}>edit set</Link></p>}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setAdding("markdown")}>Add text</Button>
        <Button variant="secondary" onClick={() => setAdding("desmos")}>Add Desmos check</Button>
        <Button variant="secondary" onClick={() => setAdding("question_set")}>Add question set</Button>
      </div>
      {adding === "markdown" && <MarkdownBlock lessonId={lesson.id} text="" onDone={() => setAdding(null)} />}
      {adding === "desmos" && <DesmosBlockEditor desmosKey={desmosKey} lessonId={lesson.id} onDone={() => setAdding(null)} />}
      {adding === "question_set" && <SetPicker lessonId={lesson.id} sets={sets} onDone={() => setAdding(null)} />}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

function MarkdownBlock({ blockId, lessonId, text, onDone }: { blockId?: string; lessonId?: string; text: string; onDone?: () => void }) {
  const [v, setV] = useState(text);
  const { error, pending, act } = useAct();
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <textarea className={cn(inputClasses, "h-48 py-2 font-mono")} value={v} onChange={(e) => setV(e.target.value)} aria-label="Lesson text (Markdown and LaTeX)" />
      <div className="max-h-96 overflow-auto rounded border border-border bg-surface-2 p-3">{v.trim() ? <Markdown>{v}</Markdown> : <p className="text-sm text-muted">Preview</p>}</div>
      <div className="flex gap-2 lg:col-span-2">
        <Button size="sm" disabled={pending} onClick={() => act(() => (blockId ? A.updateBlockAction(blockId, { kind: "markdown", text: v }) : A.addBlockAction(lessonId!, { kind: "markdown", text: v })), onDone)}>
          {blockId ? "Save text" : "Add"}
        </Button>
        {onDone && <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

function DesmosBlockEditor({ desmosKey, blockId, lessonId, initial, onDone }: { desmosKey: string | null; blockId?: string; lessonId?: string; initial?: { state: object; interactive: boolean; title?: string }; onDone?: () => void }) {
  const g = useRef<DesmosHandle>(null);
  const [interactive, setInteractive] = useState(initial?.interactive ?? true);
  const [title, setTitle] = useState(initial?.title ?? "");
  const { error, pending, act, setError } = useAct();
  const save = () => {
    const state = g.current?.getState();
    if (!state) return setError("The calculator hasn't loaded, so there's no graph to save.");
    const input = { kind: "desmos" as const, state: state as Record<string, unknown>, interactive, title };
    act(() => (blockId ? A.updateBlockAction(blockId, input) : A.addBlockAction(lessonId!, input)), onDone);
  };
  return (
    <div className="flex flex-col gap-2">
      <input className={inputClasses} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" aria-label="Desmos check title" maxLength={160} />
      <DesmosGraph ref={g} apiKey={desmosKey} initialState={initial?.state ?? null} className="h-96" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={interactive} onChange={(e) => setInteractive(e.target.checked)} /> Students can change the graph (otherwise it&apos;s locked)
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !desmosKey} onClick={save}>{blockId ? "Save graph" : "Add Desmos check"}</Button>
        {onDone && <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

function SetPicker({ lessonId, sets, onDone }: { lessonId: string; sets: { id: string; title: string; status: string }[]; onDone: () => void }): ReactNode {
  const [setId, setSetId] = useState(sets[0]?.id ?? "");
  const { error, pending, act } = useAct();
  if (!sets.length) return <p className="text-sm text-muted">No sets yet. Make one in the question bank, or upload question-set JSON above.</p>;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
        Question set
        <select className={inputClasses} value={setId} onChange={(e) => setSetId(e.target.value)}>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} ({s.status})
            </option>
          ))}
        </select>
      </label>
      <Button disabled={pending} onClick={() => act(() => A.addBlockAction(lessonId, { kind: "question_set", setId }), onDone)}>Add</Button>
      <Button variant="ghost" onClick={onDone}>Cancel</Button>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
