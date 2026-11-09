"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TutorChat } from "./tutor-chat";

/**
 * "Ask the book" from inside a lesson: a panel that slides in from the side,
 * with a conversation about this lesson (its pages are preferred).
 * Clicking a page reference in an answer closes the panel and opens the book.
 */
export function TutorDrawer({ courseId, bookId, lessonId, lessonTitle, disabledReason }: { courseId: string; bookId: string; lessonId: string; lessonTitle: string; disabledReason: string | null }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false); // keep the conversation while the panel is closed

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        className="press inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2"
        aria-expanded={open}
      >
        <span aria-hidden>💬</span> Ask the book
      </button>
      {mounted && (
        <div className={open ? "" : "hidden"}>
          <div className="fixed inset-0 z-40 bg-black/30 motion-safe:animate-[cb-fade-in_150ms_ease-out]" onClick={() => setOpen(false)} aria-hidden />
          <aside
            role="dialog"
            aria-label="Ask the book"
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-bg p-4 shadow-2xl motion-safe:animate-[cb-slide-in_220ms_cubic-bezier(0.2,0.8,0.2,1)] sm:w-[30rem] sm:border-l sm:border-border"
            onClickCapture={(e) => {
              // Opening the book from an answer: close the panel so the book is visible.
              if ((e.target as HTMLElement).closest("a[data-book-page]") && !e.metaKey && !e.ctrlKey) setOpen(false);
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-semibold">Ask the book</h2>
                <p className="truncate text-xs text-muted">About “{lessonTitle}”</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Link href={`/courses/${courseId}/tutor`} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text">
                  All conversations
                </Link>
                <button type="button" onClick={() => setOpen(false)} className="press rounded-lg px-2 py-1 text-sm hover:bg-surface-2" aria-label="Close">
                  ✕
                </button>
              </div>
            </div>
            <TutorChat courseId={courseId} bookId={bookId} lessonId={lessonId} lessonTitle={lessonTitle} disabledReason={disabledReason} className="flex-1" />
          </aside>
        </div>
      )}
    </>
  );
}
