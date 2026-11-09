"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveOutlineAction } from "@/server/actions/outline";
import * as ops from "@/lib/outline/edit";
import type { EditableOutline, OutlineIssue } from "@/lib/outline/edit";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DotsIcon, Menu } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { LessonRow } from "./lesson-row";

type Props = { courseId: string; pageCount: number; initial: EditableOutline; detected: EditableOutline | null };

const MAX_HISTORY = 100;

export function OutlineEditor({ courseId, pageCount, initial, detected }: Props) {
  const router = useRouter();
  // `history` holds past versions for Undo; the last one is what's on screen.
  const [history, setHistory] = useState<EditableOutline[]>([initial]);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [announcement, setAnnouncement] = useState("");
  const [serverIssues, setServerIssues] = useState<OutlineIssue[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const lastCoalesce = useRef<string | null>(null);
  const resetDialog = useRef<HTMLDialogElement>(null);

  const outline = history.at(-1)!;
  const dirty = JSON.stringify(outline) !== saved;
  const check = useMemo(() => ops.validateOutline(outline, pageCount), [outline, pageCount]);
  const errorKeys = new Set(check.errors.map((e) => e.lessonKey ?? e.unitKey));

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /**
   * Apply an edit. Edits with the same `coalesce` key in a row (typing in one
   * title box) count as a single step for Undo.
   */
  function apply(fn: (o: EditableOutline) => EditableOutline, message?: string, coalesce?: string) {
    let next: EditableOutline;
    try {
      next = fn(outline);
    } catch (err) {
      setAnnouncement(err instanceof Error ? err.message : "That didn't work.");
      return;
    }
    if (next === outline) return;
    setJustSaved(false);
    setServerIssues(null);
    setHistory((h) => {
      const replace = coalesce !== undefined && lastCoalesce.current === coalesce;
      const base = replace ? h.slice(0, -1) : h;
      return [...base, next].slice(-MAX_HISTORY);
    });
    lastCoalesce.current = coalesce ?? null;
    if (message) setAnnouncement(message);
  }

  function undo() {
    if (history.length < 2) return;
    lastCoalesce.current = null;
    setHistory((h) => h.slice(0, -1));
    setAnnouncement("Undone.");
  }

  function save() {
    startTransition(async () => {
      setSaveError(null);
      const res = await saveOutlineAction(courseId, outline);
      if (!res.ok) {
        setSaveError(res.error);
        setServerIssues(res.issues ?? null);
        return;
      }
      lastCoalesce.current = null;
      setHistory([res.outline]);
      setSaved(JSON.stringify(res.outline));
      setJustSaved(true);
      setAnnouncement("Outline saved.");
      router.refresh();
    });
  }

  const lessonsTotal = outline.units.reduce((n, u) => n + u.lessons.length, 0);
  const included = outline.units.reduce((n, u) => n + u.lessons.filter((l) => !l.skip).length, 0);
  // Position of each unit's first lesson in the whole course (for "first"/"last" checks).
  const unitOffsets = outline.units.map((_, ui) => outline.units.slice(0, ui).reduce((n, u) => n + u.lessons.length, 0));

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="sticky top-14 z-10 -mx-4 flex flex-wrap items-center gap-2 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <p className="mr-auto text-sm" aria-live="polite">
          {pending ? "Saving…" : dirty ? <span className="font-medium text-warning">Unsaved changes</span> : justSaved ? <span className="text-success">All changes saved</span> : <span className="text-muted">{included} of {lessonsTotal} lessons included</span>}
        </p>
        <Button variant="ghost" size="sm" onClick={undo} disabled={history.length < 2 || pending}>
          Undo
        </Button>
        {detected && (
          <Button variant="ghost" size="sm" onClick={() => resetDialog.current?.showModal()} disabled={pending}>
            Reset to detected
          </Button>
        )}
        <Button size="sm" onClick={save} disabled={!dirty || pending || check.errors.length > 0}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {saveError && (
        <Alert tone="error">
          {saveError}
          {serverIssues && serverIssues.length > 1 && (
            <ul className="mt-1 list-disc pl-5">
              {serverIssues.slice(1, 6).map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {check.errors.length > 0 && (
        <Alert tone="error">
          <p className="font-medium">Fix {check.errors.length === 1 ? "this" : "these"} before saving:</p>
          <ul className="mt-1 list-disc pl-5">
            {check.errors.slice(0, 6).map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </Alert>
      )}
      {check.warnings.length > 0 && (
        <Alert tone="warning">
          <ul className="list-disc pl-5">
            {check.warnings.slice(0, 6).map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <ol className="flex flex-col gap-5">
        {outline.units.map((unit, ui) => {
          const unitSkipped = ops.isUnitSkipped(unit);
          const unitTitle = unit.title || "Untitled unit";
          return (
            <li key={unit.key} className={cn("rounded-xl border bg-surface-2/40 p-3 sm:p-4", errorKeys.has(unit.key) ? "border-danger" : "border-border")}>
              <div className="mb-3 flex items-center gap-2">
                <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted">Unit {ui + 1}</span>
                <input
                  value={unit.title}
                  onChange={(e) => apply((o) => ops.renameUnit(o, ui, e.target.value), undefined, `unit-title-${unit.key}`)}
                  aria-label={`Unit ${ui + 1} title`}
                  aria-invalid={!unit.title.trim() || undefined}
                  maxLength={200}
                  className={cn(
                    "h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 font-semibold hover:border-border focus-visible:border-focus",
                    unitSkipped && "text-muted",
                  )}
                />
                {unitSkipped && <span className="hidden rounded-full bg-surface px-2 py-0.5 text-xs text-muted sm:inline">Skipped</span>}
                <Menu
                  label={`Actions for unit ${unitTitle}`}
                  items={[
                    { label: "Move unit up", onSelect: () => apply((o) => ops.moveUnit(o, ui, -1), `Moved ${unitTitle} up.`), disabled: ui === 0 },
                    { label: "Move unit down", onSelect: () => apply((o) => ops.moveUnit(o, ui, 1), `Moved ${unitTitle} down.`), disabled: ui === outline.units.length - 1 },
                    { label: "Add a lesson to this unit", onSelect: () => apply((o) => ops.addLesson(o, ui, unit.lessons.length - 1, pageCount), "Added a lesson.") },
                    { label: "Merge with next unit", onSelect: () => apply((o) => ops.mergeUnitWithNext(o, ui), `Merged ${unitTitle} with the next unit.`), disabled: ui === outline.units.length - 1 },
                    {
                      label: unitSkipped ? "Include whole unit" : "Skip whole unit",
                      onSelect: () => apply((o) => ops.setUnitSkip(o, ui, !unitSkipped), unitSkipped ? `Included ${unitTitle}.` : `Skipped ${unitTitle}.`),
                    },
                    { label: "Add a unit after this one", onSelect: () => apply((o) => ops.addUnit(o, ui, pageCount), "Added a unit.") },
                    { label: "Delete unit and its lessons", onSelect: () => apply((o) => ops.deleteUnit(o, ui), `Deleted ${unitTitle}.`), danger: true },
                  ]}
                >
                  <DotsIcon />
                </Menu>
              </div>
              <ol className="flex flex-col gap-2">
                {unit.lessons.map((lesson, li) => {
                  const flatIndex = unitOffsets[ui] + li;
                  const title = lesson.title || "Untitled lesson";
                  return (
                    <LessonRow
                      key={lesson.key}
                      courseId={courseId}
                      lesson={lesson}
                      number={`${ui + 1}.${li + 1}`}
                      pageCount={pageCount}
                      isFirst={flatIndex === 0}
                      isLast={flatIndex === lessonsTotal - 1}
                      isFirstInUnit={li === 0}
                      isLastInUnit={li === unit.lessons.length - 1}
                      hasError={errorKeys.has(lesson.key)}
                      actions={{
                        rename: (t) => apply((o) => ops.renameLesson(o, ui, li, t), undefined, `lesson-title-${lesson.key}`),
                        setRange: (s, e) => apply((o) => ops.setLessonRange(o, ui, li, s, e), `${title} now covers pages ${s} to ${e}.`),
                        moveUp: () => apply((o) => ops.moveLesson(o, ui, li, -1), `Moved ${title} up.`),
                        moveDown: () => apply((o) => ops.moveLesson(o, ui, li, 1), `Moved ${title} down.`),
                        mergeNext: () => apply((o) => ops.mergeLessonWithNext(o, ui, li), `Merged ${title} with the next lesson.`),
                        split: (p) => apply((o) => ops.splitLesson(o, ui, li, p), `Split ${title} at page ${p}.`),
                        newUnitHere: () => apply((o) => ops.splitUnitAt(o, ui, li), `Started a new unit at ${title}.`),
                        toggleSkip: () => apply((o) => ops.setLessonSkip(o, ui, li, !lesson.skip), lesson.skip ? `Included ${title}.` : `Skipped ${title}.`),
                        remove: () => apply((o) => ops.deleteLesson(o, ui, li), `Deleted ${title}.`),
                      }}
                    />
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>

      <div>
        <Button variant="secondary" onClick={() => apply((o) => ops.addUnit(o, o.units.length - 1, pageCount), "Added a unit at the end.")}>
          Add a unit
        </Button>
      </div>

      {detected && (
        <dialog ref={resetDialog} aria-labelledby="reset-title" className="m-auto w-full max-w-sm rounded-xl border border-border bg-surface p-6 text-text backdrop:bg-black/50">
          <h2 id="reset-title" className="text-lg font-semibold">
            Reset to the detected outline?
          </h2>
          <p className="mt-2 text-sm text-muted">
            This replaces your edits with the outline Coursebook first found in the book. Nothing is saved until you click
            &ldquo;Save changes&rdquo;, and you can Undo.
          </p>
          <form method="dialog" className="mt-6 flex justify-end gap-2">
            <Button type="submit" variant="secondary">
              Cancel
            </Button>
            <Button
              onClick={() => {
                resetDialog.current?.close();
                apply(() => structuredClone(detected), "Reset to the detected outline.");
              }}
            >
              Reset
            </Button>
          </form>
        </dialog>
      )}
    </div>
  );
}
