"use client";

import Link from "next/link";
import { useEffect } from "react";

/** On-screen controls for the printable study guide (hidden when printing). Opens the print dialog automatically if asked. */
export function PrintToolbar({ courseId, answers, flashcards, autoPrint }: { courseId: string; answers: boolean; flashcards: boolean; autoPrint: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    let cancelled = false;
    // Wait for fonts (KaTeX) so math is laid out before printing.
    document.fonts.ready.then(() => setTimeout(() => !cancelled && window.print(), 300));
    return () => {
      cancelled = true;
    };
  }, [autoPrint]);
  const href = (a: boolean, f: boolean) => `/print/courses/${courseId}?answers=${a ? 1 : 0}&flashcards=${f ? 1 : 0}`;
  return (
    <div className="no-print sticky top-0 z-10 mb-8 flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white/95 px-4 py-3 text-sm backdrop-blur">
      <Link href={`/courses/${courseId}/export`} className="text-neutral-600 hover:underline">
        ← Back
      </Link>
      <span className="mx-1 h-4 w-px bg-neutral-300" aria-hidden />
      <Link href={href(!answers, flashcards)} replace className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50" aria-pressed={answers}>
        {answers ? "☑" : "☐"} Answers
      </Link>
      <Link href={href(answers, !flashcards)} replace className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50" aria-pressed={flashcards}>
        {flashcards ? "☑" : "☐"} Flashcards
      </Link>
      <button type="button" onClick={() => window.print()} className="ml-auto rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white hover:bg-indigo-800">
        Print / Save as PDF
      </button>
    </div>
  );
}
