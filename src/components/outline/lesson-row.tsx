"use client";

import { useState } from "react";
import type { EditableLesson } from "@/lib/outline/edit";
import { Button } from "@/components/ui/button";
import { DotsIcon, Menu } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import { PagePreview } from "./page-preview";

/** A number box that only commits a value when it's a whole number in range (on blur or Enter). */
function PageInput({
  value,
  min,
  max,
  label,
  onCommit,
  invalid,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onCommit: (n: number) => void;
  invalid?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  // Keep the box in sync when the value changes from outside (undo, merge…).
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value));
  }
  const commit = () => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < min || n > max) setText(String(value));
    else if (n !== value) onCommit(n); // leaving the box without changing it isn't an edit
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      aria-label={label}
      aria-invalid={invalid || undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={cn(
        "h-8 w-16 rounded-md border bg-surface px-2 text-sm tabular-nums",
        invalid ? "border-danger" : "border-border",
      )}
    />
  );
}

export type LessonActions = {
  rename: (title: string) => void;
  setRange: (start: number, end: number) => void;
  moveUp: () => void;
  moveDown: () => void;
  mergeNext: () => void;
  split: (atPage: number) => void;
  newUnitHere: () => void;
  toggleSkip: () => void;
  remove: () => void;
};

export function LessonRow({
  courseId,
  lesson,
  number,
  pageCount,
  isFirst,
  isLast,
  isLastInUnit,
  isFirstInUnit,
  hasError,
  actions,
}: {
  courseId: string;
  lesson: EditableLesson;
  number: string;
  pageCount: number;
  isFirst: boolean;
  isLast: boolean;
  isFirstInUnit: boolean;
  isLastInUnit: boolean;
  hasError: boolean;
  actions: LessonActions;
}) {
  const [open, setOpen] = useState(false);
  const [splitAt, setSplitAt] = useState(Math.min(lesson.pageEnd, lesson.pageStart + 1));
  const canSplit = lesson.pageEnd > lesson.pageStart;
  const title = lesson.title || "Untitled lesson";

  return (
    <li
      className={cn(
        "rounded-lg border bg-surface p-2 sm:p-3",
        hasError ? "border-danger" : "border-border",
        lesson.skip && "bg-surface-2/60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-8 shrink-0 text-xs tabular-nums text-muted" aria-hidden>
          {number}
        </span>
        <input
          value={lesson.title}
          onChange={(e) => actions.rename(e.target.value)}
          aria-label={`Lesson ${number} title`}
          aria-invalid={!lesson.title.trim() || undefined}
          maxLength={200}
          className={cn(
            "h-8 min-w-0 flex-1 basis-48 rounded-md border border-transparent bg-transparent px-2 text-sm hover:border-border focus-visible:border-focus",
            lesson.skip && "text-muted line-through decoration-muted/60",
          )}
        />
        <div className="flex items-center gap-1 text-sm text-muted">
          <span className="sr-only">Pages</span>
          <span aria-hidden>pp.</span>
          <PageInput
            value={lesson.pageStart}
            min={1}
            max={pageCount}
            label={`First page of ${title}`}
            invalid={hasError && lesson.pageStart > lesson.pageEnd}
            onCommit={(n) => actions.setRange(n, Math.max(n, lesson.pageEnd))}
          />
          <span aria-hidden>–</span>
          <PageInput
            value={lesson.pageEnd}
            min={1}
            max={pageCount}
            label={`Last page of ${title}`}
            invalid={hasError && lesson.pageStart > lesson.pageEnd}
            onCommit={(n) => actions.setRange(Math.min(n, lesson.pageStart), n)}
          />
        </div>
        <div className="flex items-center">
          {lesson.skip && <span className="mr-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">Skipped</span>}
          <button
            type="button"
            onClick={actions.moveUp}
            disabled={isFirst}
            aria-label={`Move ${title} up`}
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30"
          >
            <span aria-hidden>↑</span>
          </button>
          <button
            type="button"
            onClick={actions.moveDown}
            disabled={isLast}
            aria-label={`Move ${title} down`}
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30"
          >
            <span aria-hidden>↓</span>
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} page preview for ${title}`}
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
          >
            <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          </button>
          <Menu
            label={`More actions for ${title}`}
            items={[
              { label: "Split into two lessons…", onSelect: () => setOpen(true), disabled: !canSplit },
              { label: "Merge with next lesson", onSelect: actions.mergeNext, disabled: isLastInUnit },
              { label: "Start a new unit here", onSelect: actions.newUnitHere, disabled: isFirstInUnit },
              { label: lesson.skip ? "Include this lesson" : "Skip this lesson", onSelect: actions.toggleSkip },
              { label: "Delete lesson", onSelect: actions.remove, danger: true },
            ]}
          >
            <DotsIcon />
          </Menu>
        </div>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3 sm:pl-10">
          <div className="grid gap-2 sm:grid-cols-2">
            <PagePreview courseId={courseId} page={lesson.pageStart} which="start" />
            <PagePreview courseId={courseId} page={lesson.pageEnd} which="end" />
          </div>
          {canSplit && (
            <form
              className="flex flex-wrap items-center gap-2 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                actions.split(splitAt);
                setOpen(false);
              }}
            >
              <label htmlFor={`split-${lesson.key}`}>Split so the second lesson starts on page</label>
              <input
                id={`split-${lesson.key}`}
                type="number"
                min={lesson.pageStart + 1}
                max={lesson.pageEnd}
                value={splitAt}
                onChange={(e) => setSplitAt(Number(e.target.value))}
                className="h-8 w-20 rounded-md border border-border bg-surface px-2 tabular-nums"
              />
              <Button type="submit" size="sm" variant="secondary" disabled={!(splitAt > lesson.pageStart && splitAt <= lesson.pageEnd)}>
                Split
              </Button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}
